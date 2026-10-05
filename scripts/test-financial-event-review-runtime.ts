import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { provisionFinancialReviewPrivileges } from "@/lib/admin/financial-event-runtime-privileges";
import { adminPaymentReviewEventWhere, adminUncorrelatedPaymentReviewEventWhere } from "@/lib/admin/operation-queries";
import type { CheckoutReviewEvidence } from "@/lib/admin/financial-event-policy";

// Local disposable database only. No credentials, real checkout or network provider.
const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/lnx_financial_review_qa");
assert.equal(url.username, "qa_owner");
assert.equal(process.env.NODE_ENV, "test");
assert.equal(url.password, "");
const owner = new Client({ connectionString: url.toString() });
await owner.connect();
const runtimeRole = "qa_financial_runtime";
const actorId = randomUUID();
const memberId = randomUUID();
const contributionId = randomUUID();
const eventId = randomUUID();
const sessionId = "cs_test_financial_review_fixture";
const proof: CheckoutReviewEvidence = { sessionId, livemode: false, status: "expired", paymentStatus: "unpaid", paymentIntentId: null,
  amountCents: 2000, currency: "eur", contributionId, purpose: "SUPPORT_LNX_BEATS", expectedOrder: false };
try {
  await owner.query(`DO $roles$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lnx_creations_runtime') THEN
      CREATE ROLE lnx_creations_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qa_financial_runtime') THEN
      CREATE ROLE qa_financial_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
  END $roles$`);
  await owner.query(`GRANT lnx_creations_runtime TO ${runtimeRole}`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${runtimeRole}`);
  for (const table of ["users", "provider_events", "support_contributions", "payments", "payment_incidents", "orders", "shop_orders"]) {
    await owner.query(`GRANT SELECT ON TABLE "${table}" TO ${runtimeRole}`);
  }
  // Existing webhook runtime needs write permissions. Row locking here is the
  // sole reason for the test grant; the service never changes the receipt.
  await owner.query(`GRANT UPDATE ("id") ON TABLE provider_events TO ${runtimeRole}`);
  await provisionFinancialReviewPrivileges(owner, runtimeRole);
  await provisionFinancialReviewPrivileges(owner, runtimeRole);
  for (const [id, role] of [[actorId, "ADMIN"], [memberId, "MEMBER"]]) {
    await owner.query(`INSERT INTO users (id,email,role,status,"updatedAt") VALUES ($1,$2,$3,'ACTIVE',now())`, [id, `${id}@example.invalid`, role]);
  }
  await owner.query(`INSERT INTO support_contributions (id,"ownerHash","amountCents",currency,provider,mode,status,"idempotencyKey","providerReference","updatedAt")
    VALUES ($1,$2,2000,'EUR','STRIPE','TEST','FAILED',$3,$4,now())`, [contributionId, "a".repeat(64), "b".repeat(64), sessionId]);
  await owner.query(`INSERT INTO provider_events (id,provider,"providerEventId",type,livemode,"objectId",outcome,"processedAt")
    VALUES ($1,'STRIPE','evt_qa_financial_review','checkout.session.expired',false,$2,'REQUIRES_REVIEW',now())`, [eventId, sessionId]);
  const immutableBefore = await owner.query(`SELECT (SELECT row_to_json(e) FROM provider_events e WHERE id=$1) AS receipt,
    (SELECT row_to_json(c) FROM support_contributions c WHERE id=$2) AS support,
    (SELECT count(*)::int FROM payments) AS payments, (SELECT count(*)::int FROM orders) AS orders,
    (SELECT count(*)::int FROM shop_orders) AS shop_orders`, [eventId, contributionId]);
  url.username = runtimeRole;
  process.env.DATABASE_URL = url.toString();
  const { prisma } = await import("@/lib/prisma");
  const { resolveFinancialEventReview, getFinancialEventReview } = await import("@/lib/admin/financial-event-review");
  const runtime = new Client({ connectionString: url.toString() });
  await runtime.connect();
  const passed: string[] = [];
  const check = (name: string) => passed.push(name);
  try {
    assert.equal(await prisma.providerEvent.count({ where: adminUncorrelatedPaymentReviewEventWhere }), 1);
    check("unresolved cockpit counter");
    const detail = await getFinancialEventReview(eventId, async () => proof);
    assert.equal(detail?.row.id, eventId);
    assert.equal(detail?.classification.captured, "NO");
    assert.equal(detail?.classification.eligible, true);
    check("event detail binds safe live-equivalent QA state");
    await assert.rejects(resolveFinancialEventReview(eventId, memberId, async () => proof));
    check("non-Admin rejected");
    await assert.rejects(resolveFinancialEventReview(eventId, actorId, async () => null));
    await assert.rejects(resolveFinancialEventReview(eventId, actorId, async () => ({ ...proof, paymentStatus: "paid", paymentIntentId: "pi_qa" })));
    await assert.rejects(resolveFinancialEventReview(eventId, actorId, async () => ({ ...proof, expectedOrder: true })));
    await assert.rejects(resolveFinancialEventReview(eventId, actorId, async () => {
      await owner.query(`UPDATE support_contributions SET status='SUCCEEDED' WHERE id=$1`, [contributionId]);
      return proof;
    }));
    await owner.query(`UPDATE support_contributions SET status='FAILED' WHERE id=$1`, [contributionId]);
    assert.equal(await prisma.providerEventTechnicalReview.count(), 0);
    check("ambiguous/captured/expected-order fail closed; no audit write");
    const results = await Promise.all(Array.from({ length: 6 }, () => resolveFinancialEventReview(eventId, actorId, async () => proof)));
    assert.equal(results.filter(x => x === "REVIEWED").length, 1);
    assert.equal(results.filter(x => x === "ALREADY_REVIEWED").length, 5);
    check("six concurrent resolutions: one audit only");
    const review = await prisma.providerEventTechnicalReview.findUniqueOrThrow({ where: { eventId } });
    assert.equal(review.actorId, actorId);
    assert.equal(review.reason, "EXPIRED_UNPAID_SUPPORT_CHECKOUT");
    assert.equal((review.evidence as { sessionId: string }).sessionId, sessionId);
    check("persistent actor/evidence/time audit");
    assert.equal(await resolveFinancialEventReview(eventId, actorId, async () => { throw new Error("must not re-contact provider"); }), "ALREADY_REVIEWED");
    check("already classified idempotent");
    assert.equal(await prisma.providerEvent.count({ where: adminUncorrelatedPaymentReviewEventWhere }), 0);
    assert.equal(await prisma.providerEvent.count({ where: adminPaymentReviewEventWhere }), 0);
    const candidates = await runtime.query(`SELECT events.id FROM provider_events events WHERE events.outcome='REQUIRES_REVIEW'
      AND events."paymentId" IS NULL AND events."refundAttemptId" IS NULL AND events."incidentId" IS NULL
      AND NOT EXISTS (SELECT 1 FROM provider_event_technical_reviews review WHERE review."eventId"=events.id)`);
    assert.equal(candidates.rowCount, 0);
    check("cockpit/list counters and candidates exclude audited orphan");
    assert.equal(await prisma.providerEvent.count({ where: { technicalReview: { isNot: null } } }), 1);
    check("history remains accessible");
    const immutableAfter = await owner.query(`SELECT (SELECT row_to_json(e) FROM provider_events e WHERE id=$1) AS receipt,
      (SELECT row_to_json(c) FROM support_contributions c WHERE id=$2) AS support,
      (SELECT count(*)::int FROM payments) AS payments, (SELECT count(*)::int FROM orders) AS orders,
      (SELECT count(*)::int FROM shop_orders) AS shop_orders`, [eventId, contributionId]);
    assert.deepEqual(immutableAfter.rows, immutableBefore.rows);
    check("signed receipt, contribution, orders and payments unchanged");
    await assert.rejects(runtime.query(`UPDATE provider_event_technical_reviews SET reason=reason`), { code: "42501" });
    await assert.rejects(runtime.query(`DELETE FROM provider_event_technical_reviews`), { code: "42501" });
    await assert.rejects(runtime.query(`TRUNCATE provider_event_technical_reviews`), { code: "42501" });
    await assert.rejects(runtime.query(`ALTER TABLE provider_event_technical_reviews ADD COLUMN forbidden text`), { code: "42501" });
    check("runtime SELECT/INSERT positive, UPDATE/DELETE/TRUNCATE/DDL denied");
    // A later correlated financial obligation must resurface, not be hidden by an audit.
    const orderId = randomUUID();
    await owner.query(`INSERT INTO orders (id,"orderNumber","customerEmail",brief,"updatedAt")
      VALUES ($1,'LNX-2099-990001','financial-qa@example.invalid','Synthetic financial review fixture',now())`, [orderId]);
    const payment = await owner.query<{ id: string }>(`INSERT INTO payments (id,"orderId",provider,mode,status,"amountCents",currency,"pricingVersion","idempotencyKey","providerCheckoutId","updatedAt")
      VALUES ($1,$4,'STRIPE','TEST','REQUIRES_REVIEW',2000,'EUR','qa',$2,$3,now()) RETURNING id`, [randomUUID(), randomUUID(), sessionId, orderId]);
    await owner.query(`UPDATE provider_events SET "paymentId"=$2 WHERE id=$1`, [eventId, payment.rows[0].id]);
    assert.equal(await prisma.providerEvent.count({ where: adminPaymentReviewEventWhere }), 1);
    check("new correlated financial obligation resurfaces despite audit");
    console.log(JSON.stringify({ status: "PASS", database: "isolated PostgreSQL 18", runtime: "non-owner", provider: "read-only double; no network", checks: passed }));
  } finally { await runtime.end(); await prisma.$disconnect(); }
} finally { await owner.end(); }
