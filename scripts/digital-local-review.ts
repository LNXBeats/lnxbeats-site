/** Local fixtures only. This script refuses a remote or differently named database. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { hashPassword } from "@/lib/auth/password";
import { provisionDigitalRuntime } from "@/lib/digital/runtime-privileges";

const target = assertSafeLocalPostgresUrl(process.env.MIGRATION_DATABASE_URL ?? "");
assert.equal(target.port, "55473");
assert.equal(target.pathname, "/lnx_dcn_runtime_test");
assert.equal(target.username, "dcn_owner");
const roots = ["MEDIA_LOCAL_PRIVATE_ROOT", "MEDIA_LOCAL_PUBLIC_ROOT", "DCN_LOCAL_UPLOAD_ROOT"] as const;
for (const key of roots) { assert.ok(process.env[key]?.startsWith("/private/tmp/lnx-dcn-"), "Use the isolated DCN fixture roots."); await stat(process.env[key]!); }
const owner = new Client({ connectionString: target.toString() });
await owner.connect();
await provisionDigitalRuntime(owner, "dcn_runtime_a");
// Existing-domain ACLs required by the local auth/catalogue/Admin shell only.
// This does NOT alter any Production ACL or grant globally on the public schema.
const reads = ["users", "projects", "tracks", "assets", "project_assets", "platform_links", "credits", "confidence_annotations",
  "orders", "payments", "payment_incidents", "rights_requests", "order_notifications", "shop_orders", "shop_order_customer_requests",
  "refund_attempts", "shop_shipping_provider_attempts", "shop_return_requests", "shop_return_items", "provider_events", "provider_event_technical_reviews",
  "order_events", "order_assets", "contract_party_snapshots", "rights_contributions", "rights_grants", "rights_split_proposals", "contract_documents",
  "rights_request_events", "rights_messages", "invoices", "credit_notes", "rights_licenses", "rights_withdrawal_requests", "shop_order_items", "consumer_withdrawal_requests"];
await owner.query(`GRANT SELECT ON ${reads.join(",")} TO dcn_runtime_a`);
await owner.query("GRANT SELECT,INSERT,UPDATE,DELETE ON auth_sessions,auth_accounts,auth_rate_limits,auth_verifications TO dcn_runtime_a");
await owner.query('GRANT INSERT ON assets TO dcn_runtime_a; GRANT UPDATE ("rightsStatus","updatedAt") ON assets TO dcn_runtime_a');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.toString() }) });
const privateDirectory = path.resolve(".private");
await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
const credentialsPath = path.join(privateDirectory, "dcn-review-credentials.json");
let credentials: { adminEmail: string; memberEmail: string; password: string };
try { credentials = JSON.parse(await readFile(credentialsPath, "utf8")); } catch { credentials = {
  adminEmail: "dcn-review-admin@example.invalid", memberEmail: "dcn-review-member@example.invalid", password: randomBytes(24).toString("base64url"),
}; }
const hash = await hashPassword(credentials.password);
for (const [email, role] of [[credentials.adminEmail, "ADMIN"], [credentials.memberEmail, "MEMBER"]] as const) {
  const user = await db.user.upsert({ where: { email }, create: { email, role, displayName: `DCN revue ${role}`, status: "ACTIVE", emailVerified: true, emailVerifiedAt: new Date() }, update: {} });
  await db.account.upsert({ where: { providerId_accountId: { providerId: "credential", accountId: user.id } }, create: { userId: user.id, accountId: user.id, providerId: "credential", password: hash }, update: { password: hash } });
}
const project = await db.project.findUniqueOrThrow({ where: { slug: "dcn-local-test" } });
const coverSource = process.env.DCN_REVIEW_COVER_SOURCE;
if (coverSource && !(await db.projectAsset.findFirst({ where: { projectId: project.id, role: "COVER" } }))) {
  // Copy the exact already-public LNX cover. No transformation, new artwork or private media.
  const bytes = await readFile(coverSource); const id = randomUUID(); const key = `catalog/covers/${id}.webp`;
  const destination = path.join(process.env.MEDIA_LOCAL_PUBLIC_ROOT!, key); await mkdir(path.dirname(destination), { recursive: true }); await copyFile(coverSource, destination);
  const asset = await db.asset.create({ data: { type: "COVER", storageKey: key, filename: "lnx-public-cover-reference.webp", mimeType: "image/webp", sizeBytes: BigInt(bytes.length), visibility: "PUBLIC", rightsStatus: "CLEARED", confidence: "CONFIRMED", checksumSha256: createHash("sha256").update(bytes).digest("hex"), alt: "Pochette LNX réelle, utilisée sans modification pour la revue locale" } });
  await db.projectAsset.create({ data: { projectId: project.id, assetId: asset.id, role: "COVER" } });
}
const fixtureCover=await db.projectAsset.findFirst({where:{projectId:project.id,role:"COVER",asset:{filename:"lnx-public-cover-reference.webp"}}});
if(fixtureCover)await db.asset.update({where:{id:fixtureCover.assetId},data:{type:"COVER"}});
await db.project.update({ where: { id: project.id }, data: { shortDescription: "Album de démonstration locale DCN : audio synthétique, pochette publique réelle conservée à l’identique. Aucun tarif définitif.", description: "Deux sources WAV synthétiques de plus de 10 Mio. Extraits réellement découpés ; fichiers complets privés. Démonstration uniquement, sans commercialisation ni paiement réel.", trackCount: 2, jukeboxPlacement: "PUBLISHED", jukeboxPosition: 1 } });
const runtime = new URL(target); runtime.username = "dcn_runtime_a";
const configuration = { DATABASE_URL: runtime.toString(), AUTH_URL: "http://127.0.0.1:3140", SITE_URL: "http://127.0.0.1:3140", AUTH_SECRET: randomBytes(48).toString("base64url"),
  DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_NEW_PAYMENTS_ENABLED: "false", MEDIA_DEPLOYMENT_ENV: "test", MEDIA_STORAGE_DRIVER: "local",
  MEDIA_LOCAL_PRIVATE_ROOT: process.env.MEDIA_LOCAL_PRIVATE_ROOT!, MEDIA_LOCAL_PUBLIC_ROOT: process.env.MEDIA_LOCAL_PUBLIC_ROOT!, DCN_LOCAL_UPLOAD_ROOT: process.env.DCN_LOCAL_UPLOAD_ROOT!,
  EMAIL_PROVIDER: "capture", AUTH_EMAIL_CAPTURE_PATH: path.join(privateDirectory, "dcn-mailbox.jsonl"), ADS_ENABLED: "false", SUPPORT_PAYMENTS_ENABLED: "false" };
await writeFile(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
await writeFile(path.join(privateDirectory, "dcn-review-config.json"), JSON.stringify(configuration, null, 2), { mode: 0o600 });
Object.assign(process.env, configuration, { DCN_NEW_PAYMENTS_ENABLED: "true" });
const { prisma } = await import("@/lib/prisma");
const { syncCart } = await import("@/lib/digital/catalog");
const { createDigitalCheckout, reconcileDigitalEvidence } = await import("@/lib/digital/commerce");
const member = await db.user.findUniqueOrThrow({ where: { email: credentials.memberEmail } });
const album = await db.digitalOffer.findFirstOrThrow({ where: { projectId: project.id, scope: "ALBUM" } });
if (!await db.digitalOrder.findFirst({ where: { userId: member.id } })) {
  const cart = await syncCart(member.id, [album.id], 0);
  let attemptId = "";
  const order = await createDigitalCheckout({ id: member.id, email: member.email, name: member.displayName, role: member.role, status: "ACTIVE", emailVerified: true },
    { revision: cart.revision, idempotencyKey: randomUUID(), provider: "STRIPE", termsVersion: "DCN-1.0-LOCAL-REVIEW", earlyDelivery: true, withdrawalAcknowledged: true },
    { merchantId: "local-simulated-merchant", async create(_order, attempt) { attemptId = attempt.id; return { id: `local-simulated-session-${attempt.id}`, url: "https://checkout.stripe.com/c/local_simulated_only" }; }, async recover() { return null; } });
  await reconcileDigitalEvidence({ authenticated: true, eventId: `local-fixture-${attemptId}`, orderId: order.orderId, provider: "STRIPE", mode: "TEST", providerReference: `local-simulated-session-${attemptId}`,
    paymentReference: `local-simulated-payment-${attemptId}`, merchantId: "local-simulated-merchant", amountCents: cart.totalCents, currency: "EUR", status: "PAID" }, "local-simulated-merchant");
}
await prisma.$disconnect();
console.log("Local review ready: loopback database; non-owner runtime; synthetic users; no financial credentials. Private connection details saved without output.");
await db.$disconnect(); await owner.end();
