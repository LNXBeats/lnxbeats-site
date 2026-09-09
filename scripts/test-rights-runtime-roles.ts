import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";

import { PrismaClient } from "@/generated/prisma/client";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { activateDueRightsLicenses, createRightsPaymentRepository } from "@/lib/rights/payment-repository";
import type { RightsProviderEvent } from "@/lib/rights/payment-types";

const databaseUrl = process.env.DATABASE_URL ?? "";
const parsed = assertSafeLocalPostgresUrl(databaseUrl);
assert.equal(process.env.NODE_ENV, "test");
assert.equal(parsed.hostname, "127.0.0.1");
assert.equal(parsed.pathname, "/lnx_rights_withdrawal_runtime");
for (const secret of ["STRIPE_SECRET_KEY", "PAYPAL_CLIENT_SECRET", "RESEND_API_KEY"]) {
  assert.equal(process.env[secret], undefined);
}

function prismaClient(connectionString: string, applicationName: string) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, application_name: applicationName, max: 1 }),
  });
}

function roleUrl(role: string, password: string) {
  const value = new URL(databaseUrl);
  value.username = role;
  value.password = password;
  return value.toString();
}

const admin = prismaClient(databaseUrl, "rights-role-runtime-admin");
const nativeAdmin = new Client({ connectionString: databaseUrl, application_name: "rights-role-runtime-grants" });
const suffix = randomBytes(5).toString("hex");
const roles = {
  web: `lnx_web_rights_qa_${suffix}`,
  notifications: `lnx_notifications_rights_qa_${suffix}`,
  maintenance: `lnx_maintenance_rights_qa_${suffix}`,
} as const;
const passwords = {
  web: randomBytes(24).toString("hex"),
  notifications: randomBytes(24).toString("hex"),
  maintenance: randomBytes(24).toString("hex"),
} as const;
const createdRoles: string[] = [];

function identifier(value: string) {
  assert.match(value, /^[a-z][a-z0-9_]+$/);
  return `"${value}"`;
}

async function createRole(role: string, password: string) {
  assert.match(password, /^[a-f0-9]+$/);
  await nativeAdmin.query(`CREATE ROLE ${identifier(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`);
  createdRoles.push(role);
  await nativeAdmin.query(`GRANT CONNECT ON DATABASE ${identifier(parsed.pathname.slice(1))} TO ${identifier(role)}`);
  await nativeAdmin.query(`GRANT USAGE ON SCHEMA public TO ${identifier(role)}`);
}

async function grant(role: string, privileges: string, tables: readonly string[]) {
  for (const privilege of privileges.split(",").map((item) => item.trim())) {
    assert.match(privilege, /^(SELECT|INSERT|UPDATE|USAGE)$/);
  }
  for (const table of tables) assert.match(table, /^[a-z][a-z0-9_]+$/);
  await nativeAdmin.query(`GRANT ${privileges} ON TABLE ${tables.map((table) => `public.${identifier(table)}`).join(", ")} TO ${identifier(role)}`);
}

async function grantSequence(role: string, sequences: readonly string[]) {
  for (const sequence of sequences) assert.match(sequence, /^[a-z][a-z0-9_]+$/);
  await nativeAdmin.query(`GRANT USAGE ON SEQUENCE ${sequences.map((sequence) => `public.${identifier(sequence)}`).join(", ")} TO ${identifier(role)}`);
}

async function assertDenied(client: Client, sql: string) {
  try {
    await client.query(sql);
    assert.fail("operation unexpectedly allowed");
  } catch (error) {
    assert.equal(error && typeof error === "object" && "code" in error ? error.code : null, "42501");
  }
}

async function seedPaidLicense() {
  const now = new Date();
  const withdrawalEndsAt = new Date(now.getTime() - 60_000);
  const tag = suffix.toUpperCase();
  const memberId = randomUUID();
  const adminId = randomUUID();
  const orderId = randomUUID();
  const requestId = randomUUID();
  const audioId = randomUUID();
  const documentAssetId = randomUUID();
  const documentId = randomUUID();
  const memberEmail = `rights-role-${suffix}@example.invalid`;
  await admin.user.createMany({ data: [
    { id: memberId, email: memberEmail, emailVerified: true, emailVerifiedAt: now, displayName: "Camille Permissions", role: "MEMBER", status: "ACTIVE" },
    { id: adminId, email: `rights-role-admin-${suffix}@example.invalid`, emailVerified: true, emailVerifiedAt: now, displayName: "Admin Permissions", role: "ADMIN", status: "ACTIVE" },
  ] });
  const template = await admin.contractTemplate.update({
    where: { type_version: { type: "PUBLICATION_LICENSE", version: 3 } },
    data: { status: "APPROVED", approvedAt: now, approvedByAdminId: adminId, legalReviewReference: "LOCAL-RUNTIME-ROLE-QA" },
  });
  await admin.order.create({ data: {
    id: orderId, orderNumber: `LNX-2078-${tag.slice(0, 6)}`, userId: memberId,
    customerEmail: memberEmail, customerName: "Camille Permissions", status: "DELIVERED",
    title: "Œuvre permissions", brief: "Fixture PostgreSQL locale.", usage: "PERSONAL", totalCents: 5_000,
    personalUseTermsVersion: "runtime-v1", personalUseTermsHashSha256: "a".repeat(64),
    personalUseTermsAcceptedAt: now, submittedAt: now, deliveredAt: now,
  } });
  await admin.payment.create({ data: {
    orderId, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 5_000,
    currency: "EUR", pricingVersion: "runtime", idempotencyKey: `rights-role-source-${suffix}`,
    providerPaymentId: `rights-role-source-provider-${suffix}`, paidAt: now,
  } });
  await admin.asset.create({ data: {
    id: audioId, type: "AUDIO", storageKey: `runtime/rights-role-${suffix}.wav`,
    storageBackend: "LOCAL", storageProvider: "local", visibility: "PRIVATE",
    checksumSha256: "b".repeat(64), filename: "rights-role.wav", mimeType: "audio/wav",
    sizeBytes: 1000n, rightsStatus: "RESTRICTED", confidence: "CONFIRMED",
  } });
  await admin.orderAsset.create({ data: { orderId, assetId: audioId, role: "DELIVERY" } });
  const requestNumber = `LNX-LIC-2078-${String(parseInt(tag.slice(0, 6), 16)).slice(0, 6).padStart(6, "0")}`;
  await admin.rightsRequest.create({ data: {
    id: requestId, requestNumber, orderId, userId: memberId, type: "PUBLICATION_LICENSE",
    status: "READY_FOR_PAYMENT", requestedPriceCents: 15_000, currency: "EUR",
    pricingVersion: "2026-09-publication-license-v1", workTitle: "Œuvre permissions",
    formVersion: "runtime-v1", formData: {}, submittedAt: now, reviewedAt: now, approvedAt: now,
  } });
  await admin.contractPartySnapshot.create({ data: {
    rightsRequestId: requestId, version: 1, partyType: "INDIVIDUAL", firstName: "Camille",
    lastName: "Permissions", streetAddress: "1 rue du Test", postalCode: "75001", city: "Paris",
    country: "FR", contractEmail: memberEmail, confirmedAt: now, confirmedByUserId: memberId,
  } });
  await admin.asset.create({ data: {
    id: documentAssetId, type: "DOCUMENT", storageKey: `runtime/rights-role-${suffix}.pdf`,
    storageBackend: "LOCAL", storageProvider: "local", visibility: "PRIVATE",
    checksumSha256: "c".repeat(64), filename: "rights-role.pdf", mimeType: "application/pdf",
    sizeBytes: 1000n, rightsStatus: "RESTRICTED", confidence: "CONFIRMED",
  } });
  const documentHash = "d".repeat(64);
  await admin.contractDocument.create({ data: {
    id: documentId, contractNumber: `${requestNumber}-C01`, rightsRequestId: requestId,
    templateId: template.id, templateVersion: 3, documentVersion: 1, kind: "CONTRACT",
    status: "DRAFT", generatedAt: now, priceSnapshotCents: 15_000, currency: "EUR",
    sourceSnapshot: {}, documentHashSha256: documentHash, assetId: documentAssetId,
    retentionUntil: new Date("2088-01-15T12:00:00.000Z"),
  } });
  await admin.contractAcceptance.create({ data: {
    contractDocumentId: documentId, acceptedByUserId: memberId, kind: "CLIENT",
    typedFullName: "Camille Permissions", documentHashSha256: documentHash, templateVersion: 3,
    orderId, rightsRequestId: requestId, sessionReferenceHash: "e".repeat(64), acceptedAt: now,
  } });
  await admin.contractDocument.update({ where: { id: documentId }, data: { status: "ADMIN_VALIDATED", acceptedAt: now, adminAcceptedAt: now } });
  const repository = createRightsPaymentRepository(admin, "TEST");
  const attempt = await repository.reserveAttempt(memberId, requestNumber, "STRIPE", "TEST");
  const event: RightsProviderEvent = {
    eventId: `rights-role-payment-${suffix}`, type: "STRIPE.RIGHTS.RUNTIME.ROLE",
    provider: "STRIPE", livemode: false, paymentId: attempt.paymentId,
    providerCheckoutId: `rights-role-checkout-${suffix}`, providerPaymentId: `rights-role-payment-${suffix}`,
    amountCents: 15_000, currency: "EUR", status: "SUCCEEDED", occurredAt: now,
    paymentMethod: "CARD", evidenceConsistent: true,
  };
  await repository.reconcile(event);
  const license = await admin.rightsLicense.findUniqueOrThrow({ where: { rightsRequestId: requestId } });
  await admin.rightsLicense.update({
    where: { id: license.id },
    data: { paidAt: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1_000), withdrawalEndsAt },
  });
  return { requestId, requestNumber, licenseId: license.id, paymentId: attempt.paymentId, activationAt: now };
}

async function main() {
  await nativeAdmin.connect();
  for (const key of Object.keys(roles) as Array<keyof typeof roles>) {
    await createRole(roles[key], passwords[key]);
  }

  await grant(roles.web, "SELECT, INSERT, UPDATE", [
    "rights_requests", "rights_request_events", "rights_licenses", "rights_withdrawal_requests",
    "payments", "provider_events", "refund_attempts", "contract_documents", "contract_acceptances",
    "contract_templates", "invoices", "order_notifications", "orders", "order_assets", "assets", "users",
  ]);
  await grantSequence(roles.web, ["lnx_rights_license_number_seq", "lnx_rights_license_activation_number_seq", "invoice_sequence", "credit_note_sequence"]);

  await grant(roles.notifications, "SELECT", ["order_notifications", "notification_events", "notification_suppressions", "orders", "shop_orders", "users"]);
  await grant(roles.notifications, "UPDATE", ["order_notifications"]);
  await grant(roles.notifications, "INSERT", ["notification_events"]);

  await grant(roles.maintenance, "SELECT", [
    "rights_licenses", "rights_requests", "rights_withdrawal_requests", "contract_documents",
    "contract_templates", "contract_acceptances", "payments", "refund_attempts", "invoices",
    "users", "orders", "rights_request_events", "order_notifications",
  ]);
  await grant(roles.maintenance, "UPDATE", ["rights_licenses", "rights_requests", "contract_documents"]);
  await grant(roles.maintenance, "INSERT", ["rights_request_events", "order_notifications"]);

  const fixture = await seedPaidLicense();
  const beforeProviderEvents = await admin.providerEvent.count();
  const beforeRefundAttempts = await admin.refundAttempt.count();

  const maintenance = prismaClient(roleUrl(roles.maintenance, passwords.maintenance), "rights-role-runtime-maintenance");
  const first = await activateDueRightsLicenses(fixture.activationAt, maintenance);
  const replay = await activateDueRightsLicenses(new Date(fixture.activationAt.getTime() + 5 * 60_000), maintenance);
  await maintenance.$disconnect();
  assert.deepEqual(first, { scanned: 1, activated: 1 });
  assert.equal(replay.activated, 0);
  assert.equal((await admin.rightsLicense.findUniqueOrThrow({ where: { id: fixture.licenseId } })).status, "ACTIVE");
  assert.equal(await admin.orderNotification.count({ where: { rightsRequestId: fixture.requestId, kind: "CUSTOMER_RIGHTS_LICENSE_ACTIVE" } }), 1);
  assert.equal(await admin.providerEvent.count(), beforeProviderEvents);
  assert.equal(await admin.refundAttempt.count(), beforeRefundAttempts);

  const web = new Client({ connectionString: roleUrl(roles.web, passwords.web) });
  await web.connect();
  await web.query("BEGIN");
  assert.equal((await web.query("SELECT count(*)::int count FROM contract_templates WHERE type = 'PUBLICATION_LICENSE' AND version = 3")).rows[0].count, 1);
  await web.query('UPDATE rights_requests SET "updatedAt" = "updatedAt" WHERE id = $1', [fixture.requestId]);
  await web.query('INSERT INTO rights_request_events (id, "rightsRequestId", type, "idempotencyKey", note) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), fixture.requestId, "LICENSE_ACTIVATED", `rights-role-web-${suffix}`, "Fixture locale annulée."]);
  await web.query("SELECT nextval('lnx_rights_license_number_seq')");
  await web.query("ROLLBACK");
  await assertDenied(web, "CREATE TABLE public.rights_role_forbidden(id integer)");
  await assertDenied(web, "DELETE FROM invoices WHERE false");
  await web.end();

  const notification = await admin.orderNotification.findFirstOrThrow({ where: { rightsRequestId: fixture.requestId, kind: "CUSTOMER_RIGHTS_LICENSE_ACTIVE" } });
  const notifications = new Client({ connectionString: roleUrl(roles.notifications, passwords.notifications) });
  await notifications.connect();
  await notifications.query("BEGIN");
  await notifications.query("SELECT id FROM order_notifications WHERE id = $1", [notification.id]);
  await notifications.query('UPDATE order_notifications SET status = status WHERE id = $1', [notification.id]);
  await notifications.query('INSERT INTO notification_events (id, "notificationId", outcome, code, "occurredAt") VALUES ($1, $2, $3, $4, $5)', [randomUUID(), notification.id, "PROCESSED", "ROLE_QA", new Date()]);
  await notifications.query("ROLLBACK");
  await assertDenied(notifications, "CREATE TABLE public.notifications_role_forbidden(id integer)");
  await assertDenied(notifications, "DELETE FROM order_notifications WHERE false");
  await notifications.end();

  const maintenanceNative = new Client({ connectionString: roleUrl(roles.maintenance, passwords.maintenance) });
  await maintenanceNative.connect();
  const attributes = await maintenanceNative.query("SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user");
  assert.deepEqual(attributes.rows[0], { rolsuper: false, rolcreatedb: false, rolcreaterole: false });
  await assertDenied(maintenanceNative, "CREATE TABLE public.maintenance_role_forbidden(id integer)");
  await assertDenied(maintenanceNative, "DELETE FROM rights_licenses WHERE false");
  await maintenanceNative.end();

  console.log(JSON.stringify({
    engine: "PostgreSQL native",
    roles: { web: "NOSUPERUSER", notifications: "NOSUPERUSER", maintenance: "NOSUPERUSER" },
    activation: first,
    replayActivated: replay.activated,
    rightsNotificationCount: 1,
    providerCalls: 0,
    destructiveOperationsDenied: true,
  }, null, 2));
}

main().finally(async () => {
  await admin.$disconnect().catch(() => undefined);
  for (const role of createdRoles.reverse()) {
    await nativeAdmin.query(`DROP OWNED BY ${identifier(role)}`).catch(() => undefined);
    await nativeAdmin.query(`DROP ROLE ${identifier(role)}`).catch(() => undefined);
  }
  await nativeAdmin.end().catch(() => undefined);
}).catch((error) => {
  console.error(JSON.stringify({
    error: error instanceof Error ? error.name : "UnknownError",
    code: error && typeof error === "object" && "code" in error ? error.code : null,
    message: error instanceof Error ? error.message : null,
  }));
  process.exitCode = 1;
});
