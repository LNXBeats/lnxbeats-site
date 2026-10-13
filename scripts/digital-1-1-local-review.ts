/** Additive LOCAL upgrade + one clearly simulated QA buyer. Never reset the persistent demo. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, chmod, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { hashPassword } from "@/lib/auth/password";
import { provisionDigitalRuntime } from "@/lib/digital/runtime-privileges";
const cfg = JSON.parse(await readFile(".private/dcn-review-config.json", "utf8"));
const target = assertSafeLocalPostgresUrl(cfg.DATABASE_URL); assert.equal(target.pathname, "/lnx_dcn_runtime_test"); assert.equal(target.port, "55473");
assert.equal(cfg.MEDIA_STORAGE_DRIVER, "local"); assert.equal(cfg.DCN_NEW_PAYMENTS_ENABLED, "false");
const ownerUrl = new URL(target); ownerUrl.username = "dcn_owner";
const sql = new Client({ connectionString: ownerUrl.toString() }); await sql.connect();
if (!(await sql.query("SELECT 1 FROM information_schema.columns WHERE table_name='digital_orders' AND column_name='contractSnapshot'")).rowCount) {
  const root = await mkdtemp("/private/tmp/lnx-dcn-preview-preserved-");
  const file = `${root}/before-dcn-1-1.dump`; execFileSync("pg_dump", ["-Fc", "--no-owner", "--no-acl", "--file", file, ownerUrl.toString()], { stdio: "pipe" }); await chmod(file, 0o600);
  const sha256 = createHash("sha256").update(await readFile(file)).digest("hex");
  const before = (await sql.query('SELECT count(*)::int masters FROM digital_masters')).rows[0];
  execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", ownerUrl.toString(), "-f", "prisma/migrations/20261013020000_digital_fulfillment/migration.sql"], { stdio: "pipe" });
  assert.deepEqual((await sql.query('SELECT count(*)::int masters FROM digital_masters')).rows[0], before);
  await writeFile(".private/dcn-preview-upgrade-proof.json", JSON.stringify({ file, sha256, oldMastersPreserved: true, localOnly: true }), { mode: 0o600 });
}
await provisionDigitalRuntime(sql, "dcn_runtime_a"); await provisionDigitalRuntime(sql, "dcn_runtime_b");
const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerUrl.toString() }) });
const credentials = JSON.parse(await readFile(".private/dcn-review-credentials.json", "utf8"));
const email = "dcn11-review-member@example.invalid", member = await owner.user.upsert({ where: { email }, create: { email, displayName: "Membre QA DCN‑1.1", status: "ACTIVE", emailVerified: true, emailVerifiedAt: new Date() }, update: {} });
await owner.account.upsert({ where: { providerId_accountId: { providerId: "credential", accountId: member.id } }, create: { userId: member.id, providerId: "credential", accountId: member.id, password: await hashPassword(credentials.password) }, update: {} });
await writeFile(".private/dcn-review-credentials.json", JSON.stringify({ ...credentials, dcn11MemberEmail: email }, null, 2), { mode: 0o600 });
Object.assign(process.env, cfg, { DCN_NEW_PAYMENTS_ENABLED: "true", DCN_WORK_ROOT: ".private/dcn-work", DCN_EMAIL_CAPTURE_ROOT: ".private/dcn-mail-outbox" });
const { prisma } = await import("@/lib/prisma");
const { syncCart } = await import("@/lib/digital/catalog"); const { createDigitalCheckout, reconcileDigitalEvidence } = await import("@/lib/digital/commerce");
const { processDigitalDocuments } = await import("@/lib/digital/documents");
const { processDigitalNotifications } = await import("@/lib/digital/notifications");
const album = await prisma.digitalOffer.findFirstOrThrow({ where: { project: { slug: "dcn-local-test" }, scope: "ALBUM" } });
let order = await prisma.digitalOrder.findFirst({ where: { userId: member.id } });
if (!order) {
  const cart = await syncCart(member.id, [album.id], 0); let attemptId = "";
  const r = await createDigitalCheckout({ id: member.id, email: member.email, name: member.displayName, status: "ACTIVE", role: "MEMBER", emailVerified: true },
    { revision: cart.revision, idempotencyKey: randomUUID(), provider: "STRIPE", termsVersion: "DCN-1.0-LOCAL-REVIEW", earlyDelivery: true, withdrawalAcknowledged: true },
    { merchantId: "dcn11-simulated-local", async create(_o, a) { attemptId = a.id; return { id: `dcn11-simulated-session-${a.id}`, url: "https://checkout.stripe.com/c/local_simulated_only" }; }, async recover() { return null; } });
  await reconcileDigitalEvidence({ authenticated: true, mode: "TEST", merchantId: "dcn11-simulated-local", provider: "STRIPE", eventId: `dcn11-review-${attemptId}`, orderId: r.orderId,
    providerReference: `dcn11-simulated-session-${attemptId}`, paymentReference: `dcn11-simulated-payment-${attemptId}`, amountCents: cart.totalCents, currency: "EUR", status: "PAID" }, "dcn11-simulated-local");
  order = await prisma.digitalOrder.findUniqueOrThrow({ where: { id: r.orderId } });
}
await processDigitalDocuments(); await processDigitalNotifications();
await writeFile(".private/dcn-1-1-review-index.json", JSON.stringify({ orderId: order.id, confirmation: `/musique/confirmation/${order.id}`, admin: `/admin/musique/achats/${order.id}`, simulatedPayment: true, contractReceiptNotInvented: true }), { mode: 0o600 });
console.log("DCN‑1.1 local review prepared: historic demo/acquisitions preserved; new buyer and payment are QA simulation; receipts require explicit review.");
await prisma.$disconnect(); await owner.$disconnect(); await sql.end();
