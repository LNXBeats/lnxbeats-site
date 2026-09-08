import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { paypalRefundApplicationReference } from "@/lib/payments/paypal-client";
import {
  processVerifiedPaypalFinancialEvent,
  processVerifiedStripeFinancialEvent,
} from "@/lib/payments/provider-financial-events";
import { activateDueRightsLicenses, createRightsPaymentRepository } from "@/lib/rights/payment-repository";
import { createRightsWithdrawalRepository, refundRightsWithdrawal } from "@/lib/rights/withdrawal";
import type { RightsProviderEvent } from "@/lib/rights/payment-types";

const now = new Date();
const url = process.env.DATABASE_URL ?? "";
const parsed = assertSafeLocalPostgresUrl(url);
assert.equal(process.env.NODE_ENV, "test");
assert.equal(parsed.hostname, "127.0.0.1");
assert.equal(parsed.pathname, "/lnx_rights_withdrawal_runtime");
for (const secret of ["STRIPE_SECRET_KEY", "PAYPAL_CLIENT_SECRET", "RESEND_API_KEY"]) assert.equal(process.env[secret], undefined);

function client(name: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, application_name: `rights-runtime-${name}`, max: 1 }) });
}

const primary = client("primary");
const a = client("a");
const b = client("b");
const actorIds = { member: randomUUID(), admin: randomUUID() };
const member = { id: actorIds.member, email: `rights-runtime-member-${actorIds.member.slice(0, 8)}@example.invalid`, name: "Camille Runtime", role: "MEMBER" as const, status: "ACTIVE" as const, emailVerified: true as const };
const admin = { id: actorIds.admin, email: `rights-runtime-admin-${actorIds.admin.slice(0, 8)}@example.invalid`, name: "Admin Runtime", role: "ADMIN" as const, status: "ACTIVE" as const, emailVerified: true as const };
let sequence = Number(String(Date.now()).slice(-3)) * 1_000;

function event(payment: { paymentId: string; provider: "STRIPE" | "PAYPAL" }, suffix: string, status: "SUCCEEDED" | "PENDING" | "FAILED" = "SUCCEEDED"): RightsProviderEvent {
  return {
    eventId: `rights-runtime-${suffix}-${payment.paymentId}`,
    type: `${payment.provider}.RIGHTS.RUNTIME`, provider: payment.provider, livemode: false,
    paymentId: payment.paymentId, providerCheckoutId: `checkout-${payment.paymentId}`, providerPaymentId: `provider-${payment.paymentId}`,
    amountCents: 15_000, currency: "EUR", status, occurredAt: now,
    paymentMethod: payment.provider === "PAYPAL" ? "PAYPAL" : "CARD", evidenceConsistent: true,
  };
}

async function fixture(options: { party?: boolean } = {}) {
  sequence += 1;
  const tag = String(sequence).padStart(6, "0");
  const orderId = randomUUID(); const requestId = randomUUID(); const audioId = randomUUID(); const documentAssetId = randomUUID(); const documentId = randomUUID();
  const template = await primary.contractTemplate.findUniqueOrThrow({ where: { type_version: { type: "PUBLICATION_LICENSE", version: 3 } } });
  await primary.order.create({ data: {
    id: orderId, orderNumber: `LNX-2077-${tag}`, userId: actorIds.member, customerEmail: member.email, customerName: "Camille Runtime",
    status: "DELIVERED", title: `Œuvre runtime ${tag}`, brief: "Fixture locale PostgreSQL.", usage: "PERSONAL", totalCents: 5_000,
    personalUseTermsVersion: "runtime-v1", personalUseTermsHashSha256: "a".repeat(64), personalUseTermsAcceptedAt: now,
    submittedAt: now, deliveredAt: now,
  } });
  await primary.payment.create({ data: { orderId, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 5_000, currency: "EUR", pricingVersion: "runtime", idempotencyKey: `source-${tag}`, providerPaymentId: `source-pi-${tag}`, paidAt: now } });
  await primary.asset.create({ data: { id: audioId, type: "AUDIO", storageKey: `runtime/audio-${tag}.wav`, storageBackend: "LOCAL", storageProvider: "local", visibility: "PRIVATE", checksumSha256: "b".repeat(64), filename: `audio-${tag}.wav`, mimeType: "audio/wav", sizeBytes: 1000n, rightsStatus: "RESTRICTED", confidence: "CONFIRMED" } });
  await primary.orderAsset.create({ data: { orderId, assetId: audioId, role: "DELIVERY" } });
  await primary.rightsRequest.create({ data: { id: requestId, requestNumber: `LNX-LIC-2077-${tag}`, orderId, userId: actorIds.member, type: "PUBLICATION_LICENSE", status: "READY_FOR_PAYMENT", requestedPriceCents: 15_000, currency: "EUR", pricingVersion: "2026-09-publication-license-v1", workTitle: `Œuvre runtime ${tag}`, formVersion: "runtime-v1", formData: {}, submittedAt: now, reviewedAt: now, approvedAt: now } });
  if (options.party !== false) await primary.contractPartySnapshot.create({ data: { rightsRequestId: requestId, version: 1, partyType: "INDIVIDUAL", firstName: "Camille", lastName: "Runtime", streetAddress: "1 rue du Test", postalCode: "75001", city: "Paris", country: "FR", contractEmail: member.email, confirmedAt: now, confirmedByUserId: actorIds.member } });
  await primary.asset.create({ data: { id: documentAssetId, type: "DOCUMENT", storageKey: `runtime/contract-${tag}.pdf`, storageBackend: "LOCAL", storageProvider: "local", visibility: "PRIVATE", checksumSha256: "c".repeat(64), filename: `contract-${tag}.pdf`, mimeType: "application/pdf", sizeBytes: 1000n, rightsStatus: "RESTRICTED", confidence: "CONFIRMED" } });
  await primary.contractDocument.create({ data: { id: documentId, contractNumber: `LNX-LIC-2077-${tag}-C01`, rightsRequestId: requestId, templateId: template.id, templateVersion: 3, documentVersion: 1, kind: "CONTRACT", status: "DRAFT", generatedAt: now, priceSnapshotCents: 15_000, currency: "EUR", sourceSnapshot: {}, documentHashSha256: "d".repeat(63) + String(sequence % 10), assetId: documentAssetId, retentionUntil: new Date(now.getTime() + 10 * 365 * 86400_000) } });
  await primary.contractAcceptance.create({ data: { contractDocumentId: documentId, acceptedByUserId: actorIds.member, kind: "CLIENT", typedFullName: "Camille Runtime", documentHashSha256: "d".repeat(63) + String(sequence % 10), templateVersion: 3, orderId, rightsRequestId: requestId, sessionReferenceHash: "e".repeat(64), acceptedAt: now } });
  await primary.contractDocument.update({ where: { id: documentId }, data: { status: "ADMIN_VALIDATED", acceptedAt: now, adminAcceptedAt: now } });
  return { id: requestId, requestNumber: `LNX-LIC-2077-${tag}`, documentId };
}

async function reserve(request: { id: string; requestNumber: string; documentId: string }, provider: "STRIPE" | "PAYPAL", target = a) {
  return createRightsPaymentRepository(target, "TEST").reserveAttempt(actorIds.member, request.requestNumber, provider, "TEST");
}

async function paid(request: Awaited<ReturnType<typeof fixture>>, provider: "STRIPE" | "PAYPAL" = "STRIPE") {
  const attempt = await reserve(request, provider);
  await createRightsPaymentRepository(primary, "TEST").reconcile(event(attempt, `paid-${sequence}`));
  return primary.payment.findUniqueOrThrow({ where: { id: attempt.paymentId } });
}

async function main() {
  const migrations = await primary.$queryRaw<Array<{ applied: number; total: number }>>`SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int applied, count(*)::int total FROM "_prisma_migrations"`;
  assert.deepEqual(migrations[0], { applied: 34, total: 34 });
  const pids = await Promise.all([a, b, primary].map((db) => db.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int pid`));
  assert.equal(new Set(pids.map((row) => row[0]!.pid)).size, 3);
  await primary.user.createMany({ data: [
    { id: actorIds.member, email: member.email, emailVerified: true, emailVerifiedAt: now, displayName: "Camille Runtime", role: "MEMBER", status: "ACTIVE" },
    { id: actorIds.admin, email: admin.email, emailVerified: true, emailVerifiedAt: now, displayName: "Admin Runtime", role: "ADMIN", status: "ACTIVE" },
  ] });
  await primary.contractTemplate.update({ where: { type_version: { type: "PUBLICATION_LICENSE", version: 3 } }, data: { status: "APPROVED", approvedAt: now, approvedByAdminId: actorIds.admin, legalReviewReference: "RUNTIME-LOCAL-ONLY" } });
  const passed: string[] = [];

  const s1 = await fixture();
  const stripeDouble = await Promise.all([reserve(s1, "STRIPE", a), reserve(s1, "STRIPE", b)]);
  assert.equal(new Set(stripeDouble.map((x) => x.paymentId)).size, 1); passed.push("1 DOUBLE STRIPE INIT");

  const s2 = await fixture();
  const paypalDouble = await Promise.all([reserve(s2, "PAYPAL", a), reserve(s2, "PAYPAL", b)]);
  assert.equal(new Set(paypalDouble.map((x) => x.paymentId)).size, 1); passed.push("2 DOUBLE PAYPAL INIT");

  const s3 = await fixture(); const stripe = await reserve(s3, "STRIPE", a); const paypal = await reserve(s3, "PAYPAL", b);
  await Promise.all([createRightsPaymentRepository(a, "TEST").reconcile(event(stripe, "race-stripe")), createRightsPaymentRepository(b, "TEST").reconcile(event(paypal, "race-paypal"))]);
  assert.equal(await primary.rightsPaymentWinner.count({ where: { rightsRequestId: s3.id } }), 1);
  assert.equal(await primary.invoice.count({ where: { rightsRequestId: s3.id } }), 1); passed.push("3 STRIPE VS PAYPAL");

  const s4 = await fixture(); const p4 = await reserve(s4, "STRIPE"); const e4 = event(p4, "duplicate");
  await Promise.all([createRightsPaymentRepository(a, "TEST").reconcile(e4), createRightsPaymentRepository(b, "TEST").reconcile(e4)]);
  assert.equal(await primary.providerEvent.count({ where: { providerEventId: e4.eventId } }), 1); passed.push("4 DOUBLE WEBHOOK");

  const s5 = await fixture(); const p5 = await reserve(s5, "STRIPE");
  await createRightsPaymentRepository(a, "TEST").reconcile(event(p5, "webhook-first"));
  await createRightsPaymentRepository(b, "TEST").recordSession(p5.paymentId, "STRIPE", { id: `checkout-${p5.paymentId}`, url: "https://example.invalid" });
  assert.equal((await primary.payment.findUniqueOrThrow({ where: { id: p5.paymentId } })).status, "SUCCEEDED"); passed.push("5 WEBHOOK AVANT RETOUR API");

  const s6 = await fixture(); const p6 = await reserve(s6, "PAYPAL");
  await createRightsPaymentRepository(a, "TEST").recordSession(p6.paymentId, "PAYPAL", { id: `checkout-${p6.paymentId}`, url: "https://example.invalid" });
  await createRightsPaymentRepository(b, "TEST").reconcile(event(p6, "api-first"));
  assert.equal((await primary.payment.findUniqueOrThrow({ where: { id: p6.paymentId } })).status, "SUCCEEDED"); passed.push("6 RETOUR API AVANT WEBHOOK");

  const s7 = await fixture({ party: false }); const p7 = await reserve(s7, "STRIPE");
  const r7 = await createRightsPaymentRepository(a, "TEST").reconcile(event(p7, "local-failure"));
  assert.equal(r7.outcome, "REQUIRES_REVIEW"); assert.equal(await primary.rightsLicense.count({ where: { rightsRequestId: s7.id } }), 0); passed.push("7 FINALIZATION FAILURE");

  const s8 = await fixture(); await paid(s8); const l8 = await primary.rightsLicense.findUniqueOrThrow({ where: { rightsRequestId: s8.id } });
  const boundary8 = new Date(now.getTime() + 1);
  await primary.rightsLicense.update({ where: { id: l8.id }, data: { withdrawalEndsAt: boundary8 } });
  const tx8 = a.$transaction(async (t) => { await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rights-payment:request:${s8.id}`}, 0))`; await t.rightsWithdrawalRequest.create({ data: { requestNumber: `LNX-RET-LIC-2077-${String(sequence).padStart(12, "A")}`, rightsRequestId: s8.id, paymentId: l8.paymentId, invoiceId: l8.invoiceId, contractDocumentId: l8.contractDocumentId, requestedByUserId: actorIds.member, requestedAt: boundary8, withdrawalDeadline: boundary8, declarationText: "Fixture", evidenceSnapshot: {}, evidenceHashSha256: createHash("sha256").update(s8.id).digest("hex") } }); await t.rightsLicense.update({ where: { id: l8.id }, data: { status: "WITHDRAWAL_REQUESTED" } }); });
  const act8 = activateDueRightsLicenses(boundary8, b); await Promise.all([tx8, act8]);
  assert.equal((await primary.rightsLicense.findUniqueOrThrow({ where: { id: l8.id } })).status, "WITHDRAWAL_REQUESTED"); passed.push("8 RETRACTATION VS ACTIVATION");

  const s9 = await fixture(); await paid(s9); const l9 = await primary.rightsLicense.findUniqueOrThrow({ where: { rightsRequestId: s9.id } });
  const boundary9 = new Date(now.getTime() + 1);
  await primary.rightsLicense.update({ where: { id: l9.id }, data: { withdrawalEndsAt: boundary9 } });
  const activate9 = activateDueRightsLicenses(boundary9, a); const withdraw9 = createRightsWithdrawalRepository(b, "TEST").submit(member, s9.requestNumber, null, boundary9);
  const results9 = await Promise.allSettled([activate9, withdraw9]);
  assert.equal(results9.filter((x) => x.status === "fulfilled").length >= 1, true);
  const state9 = await primary.rightsLicense.findUniqueOrThrow({ where: { id: l9.id } });
  assert.ok(["ACTIVE", "WITHDRAWAL_REQUESTED"].includes(state9.status)); passed.push("9 ACTIVATION VS RETRACTATION FRONTIERE");

  const s10 = await fixture(); await paid(s10); const l10 = await primary.rightsLicense.findUniqueOrThrow({ where: { rightsRequestId: s10.id } });
  await primary.rightsLicense.update({ where: { id: l10.id }, data: { withdrawalEndsAt: new Date(now.getTime() - 1), paidAt: new Date(now.getTime() - 15 * 86400_000) } });
  await Promise.all([activateDueRightsLicenses(now, a), activateDueRightsLicenses(now, b)]);
  assert.equal((await primary.rightsLicense.findUniqueOrThrow({ where: { id: l10.id } })).status, "ACTIVE"); passed.push("10 DEUX ACTIVATIONS");

  const s11 = await fixture(); await paid(s11, "PAYPAL"); const w11 = await createRightsWithdrawalRepository(primary, "TEST").submit(member, s11.requestNumber, null, now);
  let providerCalls = 0; let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; });
  const deps = { skipGate: true, assertRuntime: async () => ({ mode: "TEST" as const, liveRefundsEnabled: false, liveRefundsArmed: false }), repository: createRightsWithdrawalRepository(a, "TEST"), gateway: () => ({ request: async (input: { paymentId: string; attemptId: string; providerPaymentId: string; amountCents: number; idempotencyKey: string }) => { providerCalls += 1; await barrier; return { provider: "PAYPAL" as const, providerRefundId: `refund-runtime-${input.attemptId}`, providerPaymentId: input.providerPaymentId, status: "SUCCEEDED" as const, amountCents: 15_000, currency: "EUR" as const, occurredAt: now, applicationEvidence: { kind: "PAYPAL_INVOICE_REFERENCE" as const, present: true, value: (await import("@/lib/payments/paypal-client")).paypalRefundApplicationReference(input.idempotencyKey) } }; }, retrieve: async () => { throw new Error("unexpected"); } }) };
  const firstRefund = refundRightsWithdrawal(admin, w11.requestNumber, deps as never); await new Promise((resolve) => setTimeout(resolve, 50));
  const secondRefund = await refundRightsWithdrawal(admin, w11.requestNumber, { ...deps, repository: createRightsWithdrawalRepository(b, "TEST") } as never); release(); await firstRefund;
  assert.equal(providerCalls, 1); assert.equal(secondRefund.status, "PENDING"); passed.push("11 DOUBLE REFUND RIGHTS");

  const s12 = await fixture(); await paid(s12); const w12 = await createRightsWithdrawalRepository(primary, "TEST").submit(member, s12.requestNumber, null, now);
  const l12 = await primary.rightsLicense.findUniqueOrThrow({ where: { rightsRequestId: s12.id } });
  await primary.rightsLicense.update({ where: { id: l12.id }, data: { paidAt: new Date(now.getTime() - 15 * 86400_000), withdrawalEndsAt: new Date(now.getTime() - 1) } });
  assert.equal(w12.status, "REQUESTED"); const act12 = await activateDueRightsLicenses(now, b);
  assert.equal(act12.activated, 0); passed.push("12 REFUND VS ACTIVATION");

  const active = await primary.rightsRequest.findUniqueOrThrow({ where: { id: s10.id } });
  await assert.rejects(reserve({ id: active.id, requestNumber: active.requestNumber, documentId: l10.contractDocumentId }, "PAYPAL")); passed.push("13 LICENCE ACTIVE EXISTANTE");

  assert.equal(await primary.invoice.count({ where: { rightsRequestId: s7.id } }), 0); passed.push("14 INVOICE FAILURE");

  const s15 = await fixture(); await paid(s15); const l15 = await primary.rightsLicense.findUniqueOrThrow({ where: { rightsRequestId: s15.id } });
  await primary.contractDocument.update({ where: { id: l15.contractDocumentId }, data: { status: "DRAFT" } });
  await primary.rightsLicense.update({ where: { id: l15.id }, data: { withdrawalEndsAt: new Date(now.getTime() - 1), paidAt: new Date(now.getTime() - 15 * 86400_000) } });
  await activateDueRightsLicenses(now, a);
  assert.equal((await primary.rightsLicense.findUniqueOrThrow({ where: { id: l15.id } })).status, "REQUIRES_REVIEW"); passed.push("15 CONTRACT DOCUMENT FAILURE");

  const s16 = await fixture(); await paid(s16); const w16 = await createRightsWithdrawalRepository(primary, "TEST").submit(member, s16.requestNumber, null, now);
  const attempt16 = await createRightsWithdrawalRepository(primary, "TEST").reserveRefund(admin, w16.requestNumber, now);
  await primary.refundAttempt.update({ where: { id: attempt16.id }, data: { status: "REQUIRES_REVIEW", failureCode: "RUNTIME_AMBIGUOUS" } });
  await primary.rightsWithdrawalRequest.update({ where: { id: w16.id }, data: { status: "REQUIRES_REVIEW" } });
  assert.equal((await activateDueRightsLicenses(new Date(), a)).activated, 0); passed.push("16 REFUND REQUIRES_REVIEW BLOQUE ACTIVATION");

  const s17 = await fixture(); await paid(s17); const w17 = await createRightsWithdrawalRepository(primary, "TEST").submit(member, s17.requestNumber, null, now);
  await createRightsWithdrawalRepository(primary, "TEST").reject(admin, w17.requestNumber, "Demande hors périmètre de la fixture.", now);
  const l17 = await primary.rightsLicense.findUniqueOrThrow({ where: { rightsRequestId: s17.id } });
  await primary.rightsLicense.update({ where: { id: l17.id }, data: { paidAt: new Date(now.getTime() - 15 * 86400_000), withdrawalEndsAt: new Date(now.getTime() - 1) } });
  await activateDueRightsLicenses(new Date(), b);
  assert.equal((await primary.rightsLicense.findUniqueOrThrow({ where: { id: l17.id } })).status, "ACTIVE"); passed.push("17 RETRACTATION REJETEE TERMINALE");

  const s18a = await fixture(); await paid(s18a); const w18 = await createRightsWithdrawalRepository(primary, "TEST").submit(member, s18a.requestNumber, null, now);
  const s18b = await fixture(); const p18b = await paid(s18b, "PAYPAL");
  await assert.rejects(primary.refundAttempt.create({ data: { paymentId: p18b.id, provider: "PAYPAL", source: "ADMIN", amountCents: 15_000, currency: "EUR", requestedByUserId: actorIds.admin, rightsWithdrawalId: w18.id, localIdempotencyKey: `wrong-parent-${s18b.id}`, providerIdempotencyKey: `wrong-parent-provider-${s18b.id}`, status: "PROCESSING" } }), /RIGHTS_REFUND_PARENT_MISMATCH/);
  passed.push("18 MAUVAISE RELATION REFUNDATTEMPT REFUSEE");

  const s19 = await fixture(); const p19 = await paid(s19, "STRIPE"); const w19 = await createRightsWithdrawalRepository(primary, "TEST").submit(member, s19.requestNumber, null, now);
  const a19 = await createRightsWithdrawalRepository(primary, "TEST").reserveRefund(admin, w19.requestNumber, now);
  const stripeRefundEvent = {
    id: `evt-rights-refund-${a19.id}`, type: "refund.updated", livemode: false, created: Math.floor(now.getTime() / 1000),
    data: { object: { id: `re-rights-${a19.id}`, object: "refund", payment_intent: p19.providerPaymentId!, amount: 15_000, currency: "eur", status: "succeeded", metadata: { paymentId: p19.id, refundAttemptId: a19.id } } },
  } as const;
  const stripeResult = await processVerifiedStripeFinancialEvent(stripeRefundEvent);
  assert.equal(stripeResult.outcome, "PROCESSED");
  assert.equal((await primary.payment.findUniqueOrThrow({ where: { id: p19.id } })).status, "REFUNDED");
  assert.equal(await primary.creditNote.count({ where: { refundAttemptId: a19.id } }), 1);
  const stripeDuplicate = await processVerifiedStripeFinancialEvent(stripeRefundEvent);
  assert.equal(stripeDuplicate.duplicate, true);
  assert.equal(await primary.creditNote.count({ where: { refundAttemptId: a19.id } }), 1);
  passed.push("19 WEBHOOK STRIPE REFUND RIGHTS + DOUBLON");

  const s20 = await fixture(); const p20 = await paid(s20, "PAYPAL"); const w20 = await createRightsWithdrawalRepository(primary, "TEST").submit(member, s20.requestNumber, null, now);
  const a20 = await createRightsWithdrawalRepository(primary, "TEST").reserveRefund(admin, w20.requestNumber, now);
  const paypalRefundEvent = {
    id: `WH-RIGHTS-REFUND-${a20.id}`, event_type: "PAYMENT.CAPTURE.REFUNDED", create_time: now.toISOString(),
    resource: {
      id: `PAYPAL-RIGHTS-REFUND-${a20.id}`, status: "COMPLETED", amount: { currency_code: "EUR", value: "150.00" },
      invoice_id: paypalRefundApplicationReference(a20.providerIdempotencyKey), update_time: now.toISOString(),
      links: [{ rel: "up", method: "GET", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${encodeURIComponent(p20.providerPaymentId!)}` }],
    },
  } as const;
  const paypalResult = await processVerifiedPaypalFinancialEvent(paypalRefundEvent, "sandbox");
  assert.equal(paypalResult.outcome, "PROCESSED");
  assert.equal((await primary.payment.findUniqueOrThrow({ where: { id: p20.id } })).status, "REFUNDED");
  assert.equal(await primary.creditNote.count({ where: { refundAttemptId: a20.id } }), 1);
  const paypalDuplicate = await processVerifiedPaypalFinancialEvent(paypalRefundEvent, "sandbox");
  assert.equal(paypalDuplicate.duplicate, true);
  assert.equal(await primary.creditNote.count({ where: { refundAttemptId: a20.id } }), 1);
  passed.push("20 WEBHOOK PAYPAL REFUND RIGHTS + DOUBLON");

  console.log(JSON.stringify({ engine: "PostgreSQL 17 native", connections: pids.map((row) => row[0]!.pid), migrations: migrations[0], passed }, null, 2));
}

main().finally(async () => { await Promise.all([primary.$disconnect(), a.$disconnect(), b.$disconnect()]); }).catch((error) => { console.error(error); process.exitCode = 1; });
