/** REAL local PostgreSQL, FAKE providers. Never a provider sandbox claim. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Client } from "pg";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { provisionCreationsRuntimePrivileges, provisionAdminOrderVisibilityAuditPrivileges } from "@/lib/database/creations-runtime-privileges";
import { provisionSupportRuntimePrivileges } from "@/lib/support/runtime-privileges";
import type { SupportEvidence, SupportRecovery, SupportSnapshot } from "@/lib/support/providers";
const url = assertSafeLocalPostgresUrl(process.env.MIGRATION_DATABASE_URL ?? "");
assert.equal(url.pathname, "/lnx_vfinal_support_test");
const owner = new Client({ connectionString: url.toString() }); await owner.connect();
await owner.query("TRUNCATE support_contribution_events, support_contribution_attempts, support_contributions");
let checks = 0; const results: string[] = [];
const check = async (name: string, f: () => Promise<void>) => { await f(); checks++; results.push(name); };
const roles = ["support_runtime_a", "support_runtime_b"];
for (const role of roles) {
  if (!(await owner.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rowCount) await owner.query(`CREATE ROLE ${role} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await provisionCreationsRuntimePrivileges(owner, role);
  await provisionAdminOrderVisibilityAuditPrivileges(owner);
}
const historical = async () => (await owner.query("SELECT relname,relacl::text FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname NOT LIKE 'support_%' ORDER BY relname")).rows;
const before = await historical();
for (const role of roles) {
  await provisionSupportRuntimePrivileges(owner, role, true); await provisionSupportRuntimePrivileges(owner, role, true);
  const u = new URL(url); u.username = role; u.password = "";
  const db = new Client({ connectionString: u.toString() }); await db.connect();
  await check(`ACL positive/negative ${role}`, async () => {
    for (const table of ["support_contributions", "support_contribution_attempts", "support_contribution_events"]) {
      await db.query(`SELECT * FROM ${table} LIMIT 0`);
      for (const op of [`DELETE FROM ${table} WHERE false`, `TRUNCATE ${table}`, `ALTER TABLE ${table} ADD COLUMN bad int`]) await assert.rejects(db.query(op), { code: "42501" });
    }
    await db.query("UPDATE support_contributions SET status=status WHERE false");
    await db.query("UPDATE support_contribution_attempts SET status=status WHERE false");
    await assert.rejects(db.query('UPDATE support_contributions SET "amountCents"=100 WHERE false'), { code: "42501" });
    await assert.rejects(db.query("UPDATE support_contribution_events SET type='bad' WHERE false"), { code: "42501" });
    await assert.rejects(db.query("CREATE TABLE public.bad_support(id int)"), { code: "42501" });
    await assert.rejects(db.query("SELECT * FROM _prisma_migrations LIMIT 0"), { code: "42501" });
  });
  await db.end();
}
assert.deepEqual(await historical(), before);
const runtime = new URL(url); runtime.username = roles[1]; runtime.password = "";
process.env.DATABASE_URL = runtime.toString();
Object.assign(process.env, { SUPPORT_ENABLED: "true", SUPPORT_TEST_MODE: "true", SITE_URL: "http://127.0.0.1:3117", PAYMENT_DEPLOYMENT_ENV: "development" });
delete process.env.RAILWAY_ENVIRONMENT_NAME;
const { prisma } = await import("@/lib/prisma");
const { createSupportCheckout, captureSupportContribution, getSupportStatus, reconcileSupportContribution, reconcileSupportEvidence, runSupportOperation } = await import("@/lib/support/service");
const remote = new Map<string, SupportRecovery>(); let posts = 0, reads = 0, timeout = false;
const gateway = {
  async createCheckout(v: SupportSnapshot) { posts++; const checkout = { id: `qa_${v.id}`, url: `https://checkout.stripe.com/c/test_${v.id}` }; remote.set(v.id + ":CHECKOUT", { checkout }); if (timeout) { timeout = false; throw Error("synthetic timeout"); } return checkout; },
  async capture(v: SupportSnapshot): Promise<SupportEvidence> { posts++; const evidence: SupportEvidence = { contributionId: v.id, provider: "PAYPAL", providerReference: v.providerReference!, paymentReference: `qa_capture_${v.id}`, amountCents: v.amountCents, currency: "EUR", status: "SUCCEEDED" }; remote.set(v.id + ":CAPTURE", { evidence }); if (timeout) { timeout = false; throw Error("synthetic timeout"); } return evidence; },
  async recover(v: SupportSnapshot, op: string) { reads++; return remote.get(v.id + ":" + op) ?? null; },
  async refund(v: SupportSnapshot) { posts++; const refund = { id: `qa_refund_${v.id}`, status: "REFUNDED" }; remote.set(v.id + ":REFUND", { refund }); if (timeout) { timeout = false; throw Error("synthetic timeout"); } return refund; },
};
const input = (provider = "STRIPE") => ({ provider, amountCents: 500, idempotencyKey: randomUUID(), ownerToken: randomBytes(32).toString("hex") });
try {
  await check("double click: 10 concurrent requests, one provider POST", async () => {
    const i = input(), n = posts; const r = await Promise.all(Array.from({ length: 10 }, () => createSupportCheckout(i, gateway)));
    assert.equal(new Set(r.map(x => x.contributionId)).size, 1); assert.equal(posts - n, 1);
  });
  await check("cross-provider concurrent requests fenced; distinct intentional support allowed", async () => {
    const i = input(); const r = await Promise.allSettled([createSupportCheckout(i, gateway), createSupportCheckout({ ...i, provider: "PAYPAL", idempotencyKey: randomUUID() }, gateway)]);
    assert.equal(r.filter(x => x.status === "fulfilled").length, 1);
    await assert.rejects(createSupportCheckout({ ...i, provider: "PAYPAL" }, gateway), { code: "CONFLICT" });
    await createSupportCheckout({ ...i, idempotencyKey: randomUUID(), newContribution: true }, gateway);
  });
  await check("checkout timeout after success: GET recovers, no repeated POST", async () => {
    const i = input(); timeout = true; const r = await createSupportCheckout(i, gateway); const n = posts;
    assert.equal(r.checkoutUrl, null); await reconcileSupportContribution(r.contributionId, gateway);
    assert.ok((await createSupportCheckout(i, gateway)).checkoutUrl); assert.equal(posts, n);
  });
  await check("immutable amount and opaque owner authorization", async () => {
    const i = input("PAYPAL"), r = await createSupportCheckout(i, gateway);
    await assert.rejects(createSupportCheckout({ ...i, amountCents: 1000 }, gateway), { code: "CONFLICT" });
    const token = randomBytes(32).toString("hex");
    await assert.rejects(getSupportStatus(r.contributionId, token), { code: "NOT_FOUND" });
    await assert.rejects(captureSupportContribution(r.contributionId, token, gateway), { code: "NOT_FOUND" });
  });
  await check("confirmed PENDING capture is GET-only on later attempts", async () => {
    const i = input("PAYPAL"), r = await createSupportCheckout(i, gateway);
    const pending = { ...gateway, async capture(v: SupportSnapshot) {
      const e = { ...await gateway.capture(v), status: "PENDING" as const }; remote.set(v.id + ":CAPTURE", { evidence: e }); return e;
    } };
    await captureSupportContribution(r.contributionId, i.ownerToken, pending); const n = posts;
    for (let c = 0; c < 3; c++) await captureSupportContribution(r.contributionId, i.ownerToken, gateway);
    assert.equal(posts, n); assert.equal((await getSupportStatus(r.contributionId, i.ownerToken)).status, "PENDING");
  });
  await check("timeout before provider result stays unknown and does not recreate", async () => {
    const i = input(); const unavailable = { ...gateway, async createCheckout() { posts++; throw Error("timeout before response"); } };
    const r = await createSupportCheckout(i, unavailable), n = posts;
    await reconcileSupportContribution(r.contributionId, gateway); await createSupportCheckout(i, gateway);
    assert.equal(posts, n); assert.equal((await getSupportStatus(r.contributionId, i.ownerToken)).needsReconciliation, true);
  });
  await check("process restart: expired persistent lease resumes GET-only", async () => {
    const i = input(); timeout = true; const r = await createSupportCheckout(i, gateway);
    await prisma.supportContributionAttempt.updateMany({ where: { contributionId: r.contributionId }, data: { leaseToken: randomUUID(), leaseUntil: new Date(Date.now() - 60000) } });
    const n = posts; await reconcileSupportContribution(r.contributionId, gateway); assert.equal(posts, n);
    assert.ok((await prisma.supportContribution.findUniqueOrThrow({ where: { id: r.contributionId } })).providerReference);
  });
  await check("capture timeout after success, kill switch OFF, reconciliation and refund still work", async () => {
    const i = input("PAYPAL"), r = await createSupportCheckout(i, gateway); timeout = true;
    await assert.rejects(captureSupportContribution(r.contributionId, i.ownerToken, gateway)); const n = posts;
    process.env.SUPPORT_ENABLED = "false";
    await assert.rejects(createSupportCheckout(input(), gateway), { code: "DISABLED" });
    await reconcileSupportContribution(r.contributionId, gateway); assert.equal(posts, n);
    assert.equal((await getSupportStatus(r.contributionId, i.ownerToken)).status, "SUCCEEDED");
    timeout = true; await assert.rejects(runSupportOperation(r.contributionId, "REFUND", gateway));
    const refundPosts = posts; await reconcileSupportContribution(r.contributionId, gateway);
    assert.equal(posts, refundPosts); assert.equal((await getSupportStatus(r.contributionId, i.ownerToken)).status, "REFUNDED");
    process.env.SUPPORT_ENABLED = "true";
  });
  await check("webhook before persistence retries; duplicate/out-of-order and double payment audited", async () => {
    const i = input(); timeout = true; const r = await createSupportCheckout(i, gateway);
    const e: SupportEvidence = { contributionId: r.contributionId, provider: "STRIPE", providerReference: `qa_${r.contributionId}`, paymentReference: `qa_pi_${r.contributionId}`, amountCents: 500, currency: "EUR", status: "SUCCEEDED" };
    await assert.rejects(reconcileSupportEvidence(e, "qa:early"), { code: "UNAVAILABLE" });
    await reconcileSupportContribution(r.contributionId, gateway);
    await Promise.all(Array.from({ length: 10 }, () => reconcileSupportEvidence(e, "qa:early")));
    assert.equal(await prisma.supportContributionEvent.count({ where: { eventKey: "qa:early" } }), 1);
    await reconcileSupportEvidence({ ...e, status: "FAILED" }, "qa:late");
    assert.equal((await getSupportStatus(r.contributionId, i.ownerToken)).status, "SUCCEEDED");
    await reconcileSupportEvidence({ ...e, paymentReference: "qa_extra_payment" }, "qa:extra");
    assert.equal((await getSupportStatus(r.contributionId, i.ownerToken)).status, "REQUIRES_REVIEW");
    assert.equal((await prisma.supportContributionEvent.findUniqueOrThrow({ where: { eventKey: "qa:extra" } })).type, "EVIDENCE_MISMATCH");
  });
  await check("network work does not hold a transaction; stale lease cannot attach", async () => {
    const i = input(); const injected = { ...gateway, async createCheckout(v: SupportSnapshot) {
      assert.equal((await owner.query("SELECT count(*)::int n FROM pg_stat_activity WHERE usename=$1 AND state='idle in transaction'", [roles[1]])).rows[0].n, 0);
      await owner.query('UPDATE support_contribution_attempts SET "leaseToken"=$1 WHERE "contributionId"=$2', [randomUUID(), v.id]);
      return gateway.createCheckout(v);
    } }; const r = await createSupportCheckout(i, injected); assert.equal(r.checkoutUrl, null);
  });
  await check("actual child SIGKILL after fake provider success, then durable recovery", async () => {
    const dir = mkdtempSync(`${tmpdir()}/lnx-support-crash-`), path = `${dir}/result.json`;
    try {
      const i = input();
      const signal = await new Promise<string | null>(resolve => {
        execFile(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/support-crash-fixture.ts"], {
          env: { ...process.env, SUPPORT_CRASH_QA: "local-only", SUPPORT_CRASH_INPUT: JSON.stringify(i), SUPPORT_CRASH_RESULT: path }, timeout: 15000,
        }, error => resolve((error as { signal?: string } | null)?.signal ?? null));
      });
      assert.equal(signal, "SIGKILL");
      const recovered = JSON.parse(readFileSync(path, "utf8"));
      assert.equal((await getSupportStatus(recovered.id, i.ownerToken)).needsReconciliation, true);
      remote.set(recovered.id + ":CHECKOUT", { checkout: recovered.checkout });
      await prisma.supportContributionAttempt.updateMany({ where: { contributionId: recovered.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
      const n = posts; await reconcileSupportContribution(recovered.id, gateway);
      assert.equal(posts, n); assert.equal((await getSupportStatus(recovered.id, i.ownerToken)).status, "PENDING");
    } finally { rmSync(dir, { recursive: true }); }
  });
  await check("historical domains unchanged; events append-only under effective runtime", async () => {
    for (const t of ["orders", "payments", "shop_orders", "invoices", "products"]) assert.equal((await owner.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n, 0);
    assert.deepEqual(await historical(), before);
    await assert.rejects(prisma.supportContributionEvent.deleteMany());
    assert.ok(await prisma.supportContributionEvent.count() > 0);
  });
  await check("accounting export exceeds 200, streams all pages, isolates TEST/LIVE", async () => {
    for (let index = 0; index < 205; index++) {
      const i = input(); await createSupportCheckout(i, gateway);
    }
    const { createSupportExport } = await import("@/lib/support/export");
    const expected = await prisma.supportContribution.count({ where: { mode: "TEST" } });
    const response = createSupportExport("TEST");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const attemptCount = await prisma.supportContributionAttempt.count();
    const csv = await response.text(); assert.ok(expected > 200); assert.equal(csv.trim().split("\r\n").length - 1, attemptCount);
    assert.equal((await createSupportExport("LIVE").text()).trim().split("\r\n").length, 1);
    assert.equal(createSupportExport("ALL").status, 400);
  });
  await check("write permission switch revokes column grants, then idempotently restores them", async () => {
    await provisionSupportRuntimePrivileges(owner, roles[1], false);
    await assert.rejects(prisma.supportContribution.updateMany({ data: { status: "PENDING" } }));
    await assert.rejects(prisma.supportContribution.create({ data: { ownerHash: "a".repeat(64), idempotencyKey: "b".repeat(64), amountCents: 500, provider: "STRIPE" } }));
    await provisionSupportRuntimePrivileges(owner, roles[1], true);
    assert.deepEqual(await historical(), before);
  });
  console.log(JSON.stringify({ status: "PASS", checks, scenarios: results, providerPOSTs: posts, reconciliationGETs: reads, realProviderCalls: 0, runtimeRoles: 2, provisioningRuns: 6 }));
} finally { await prisma.$disconnect(); await owner.end(); }
