import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { provisionSupportRuntimePrivileges } from "@/lib/support/runtime-privileges";
const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/lnx_financial_review_qa");
assert.equal(url.username, "qa_owner"); assert.equal(url.password, ""); assert.equal(process.env.NODE_ENV, "test");
const owner = new Client({ connectionString: url.toString() });
await owner.connect();
const passed: string[] = [];
try {
  assert.equal((await owner.query(`SELECT count(*)::int AS n FROM support_contributions WHERE "supporterEmail" IS NOT NULL OR "supporterMessage" IS NOT NULL`)).rows[0].n, 0);
  assert.equal((await owner.query(`SELECT count(*)::int AS n FROM support_notifications`)).rows[0].n, 0);
  passed.push("historical canaries NULL; no backfill or queued historical email");
  await provisionSupportRuntimePrivileges(owner, "qa_financial_runtime", true);
  await provisionSupportRuntimePrivileges(owner, "qa_financial_runtime", true);
  await owner.query(`GRANT SELECT ON notification_suppressions TO qa_financial_runtime`);
  url.username = "qa_financial_runtime"; process.env.DATABASE_URL = url.toString();
  Object.assign(process.env, { SUPPORT_TEST_MODE: "true", SUPPORT_ENABLED: "true", PAYMENT_DEPLOYMENT_ENV: "development",
    SITE_URL: "http://127.0.0.1:4183", NOTIFICATION_DEPLOYMENT_ENV: "development", NOTIFICATION_EMAIL_TRANSPORT: "capture",
    EMAIL_NOTIFICATIONS_ENABLED: "true", OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true", CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
    EMAIL_OWNER_RECIPIENT: "owner@example.invalid", NOTIFICATION_WORKER_ENABLED: "true", NOTIFICATION_WORKER_SECRET: "qa-local-only-secret-".repeat(3) });
  const { prisma } = await import("@/lib/prisma");
  const { createSupportCheckout, reconcileSupportEvidence, getSupportStatus } = await import("@/lib/support/service");
  const { dispatchSupportNotifications } = await import("@/lib/support/notifications");
  const runtime = new Client({ connectionString: url.toString() }); await runtime.connect();
  try {
    const fixture = async (contact: { email?: string; message?: string }, confirmed = true) => {
      const token = randomBytes(32).toString("hex");
      const gateway = { createCheckout: async (value: { id: string }) => ({ id: `cs_test_qa_${value.id.replaceAll("-", "")}`, url: "https://checkout.stripe.com/c/pay/qa" }),
        capture: async () => { throw new Error("No real capture"); } };
      const value = await createSupportCheckout({ provider: "STRIPE", amountCents: 300, idempotencyKey: randomUUID(), ownerToken: token, ...contact }, gateway);
      const row = await prisma.supportContribution.findUniqueOrThrow({ where: { id: value.contributionId } });
      const evidence = { mode: "TEST" as const, contributionId: row.id, provider: "STRIPE" as const, providerReference: row.providerReference!,
        paymentReference: `pi_test_qa_${row.id}`, amountCents: 300, currency: "EUR", status: "SUCCEEDED" as const };
      if (confirmed) await Promise.all(Array.from({ length: 6 }, () => reconcileSupportEvidence(evidence, `evt_qa_${row.id}`)));
      return { row, token };
    };
    const values = await Promise.all([fixture({}), fixture({ email: "qa@example.invalid" }), fixture({ message: "Merci LNX" }), fixture({ email: "both@example.invalid", message: "Un message\nSur deux lignes" })]);
    const pending = await fixture({ email: "pending@example.invalid" }, false);
    assert.equal(await prisma.supportNotification.count({ where: { contributionId: pending.row.id } }), 0);
    assert.equal(await prisma.supportNotification.count(), 6);
    passed.push("four contact combinations persisted; duplicate webhooks create one email per audience; no pending email");
    const status = await getSupportStatus(values[3].row.id, values[3].token);
    assert.equal(status.emailProvided, true); assert.equal(status.messageProvided, true);
    assert.equal("supporterEmail" in status, false); assert.equal("supporterMessage" in status, false);
    await assert.rejects(getSupportStatus(values[3].row.id, "f".repeat(64)));
    passed.push("owner-only status exposes booleans, never email/message; wrong owner rejected");
    const delivered = new Map<string,string>(); let requests = 0;
    const send = async (message: { idempotencyKey: string; audience: string; recipient: string; id: string }) => {
      requests++;
      if (message.audience === "ADMIN") assert.equal(message.recipient, "owner@example.invalid");
      const id = delivered.get(message.idempotencyKey) ?? `email_qa_${message.id}`;
      delivered.set(message.idempotencyKey, id); return id;
    };
    await Promise.all(Array.from({ length: 6 }, () => dispatchSupportNotifications(25, send)));
    assert.equal(requests, 6); assert.equal(delivered.size, 6);
    assert.equal(await prisma.supportNotification.count({ where: { status: "SENT" } }), 6);
    await dispatchSupportNotifications(25, send); assert.equal(requests, 6);
    passed.push("concurrent workers, supporter/Admin emails exactly once; already sent never retried");
    assert.equal((await getSupportStatus(values[1].row.id, values[1].token)).confirmationEmailStatus, "SENT");
    const retry = await fixture({ email: "retry@example.invalid" });
    const accepted = new Map<string,string>(); let first = true;
    const timeout = async (message: { idempotencyKey: string; id: string }) => {
      const id = accepted.get(message.idempotencyKey) ?? `retry_qa_${message.id}`;
      accepted.set(message.idempotencyKey,id);
      if (first) { first = false; throw new Error("Simulated timeout after provider acceptance"); }
      return id;
    };
    await dispatchSupportNotifications(25, timeout);
    await owner.query(`UPDATE support_notifications SET "availableAt"=now() WHERE "contributionId"=$1`, [retry.row.id]);
    await dispatchSupportNotifications(25, timeout);
    assert.equal(accepted.size, 2);
    assert.equal(await prisma.supportNotification.count({ where: { contributionId: retry.row.id, status: "SENT" } }), 2);
    passed.push("timeout after acceptance reuses persistent same key; safe retry without duplicate");
    const stale = await fixture({ email: "stale@example.invalid" });
    await owner.query(`UPDATE support_notifications SET status='PROCESSING',"firstAttemptAt"=now()-interval '25 hours',"leaseUntil"=now()-interval '1 minute' WHERE "contributionId"=$1`, [stale.row.id]);
    await dispatchSupportNotifications(25, async () => { throw new Error("must not send after idempotency window"); });
    assert.equal(await prisma.supportNotification.count({ where: { contributionId: stale.row.id, status: "REQUIRES_REVIEW" } }), 2);
    passed.push("expired ambiguous lease remains review; no blind resend outside provider window");
    await assert.rejects(runtime.query(`UPDATE support_contributions SET "supporterEmail"='hijack@example.invalid'`), { code: "42501" });
    await assert.rejects(runtime.query(`DELETE FROM support_notifications`), { code: "42501" });
    await assert.rejects(runtime.query(`UPDATE support_notifications SET "idempotencyKey"='hijack'`), { code: "42501" });
    await assert.rejects(runtime.query(`UPDATE support_contribution_events SET type=type`), { code: "42501" });
    passed.push("non-owner runtime positive writes; contact/key immutable; DELETE and audit UPDATE denied");
    assert.equal(await prisma.payment.count(), 1);
    assert.equal(await prisma.order.count(), 1);
    passed.push("no new Payment, Order, ShopOrder or stock from support/contact/emails");
    console.log(JSON.stringify({ status: "PASS", emailTransport: "injected capture doubles only", providerFinancialMutations: 0, checks: passed }));
  } finally { await runtime.end(); await prisma.$disconnect(); }
} finally { await owner.end(); }
