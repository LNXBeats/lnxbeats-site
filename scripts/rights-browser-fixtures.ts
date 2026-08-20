import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { personalUseTermsSnapshot, rightsPriceSnapshot } from "@/lib/rights/domain";
import { loadAndAssertRightsQaEnvironment } from "@/lib/rights/qa-guard";
import { prisma } from "@/lib/prisma";

const memberEmail = "lnx-v072-browser-member@example.invalid";
const adminEmail = "lnx-v072-browser-admin@example.invalid";
const orderNumbers = ["LNX-2072-900001", "LNX-2072-900002", "LNX-2072-900003"] as const;
const requestNumbers = ["LNX-LIC-2072-900001", "LNX-PART-2072-900001"] as const;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { in: [memberEmail, adminEmail] } }, select: { id: true } });
  const userIds = users.map(({ id }) => id);
  const orders = await prisma.order.findMany({ where: { orderNumber: { in: [...orderNumbers] } }, select: { id: true } });
  const orderIds = orders.map(({ id }) => id);
  const requests = await prisma.rightsRequest.findMany({ where: { requestNumber: { in: [...requestNumbers] } }, select: { id: true } });
  const requestIds = requests.map(({ id }) => id);
  const documents = await prisma.contractDocument.findMany({ where: { rightsRequestId: { in: requestIds } }, select: { id: true, assetId: true } });
  const orderAssets = await prisma.orderAsset.findMany({ where: { orderId: { in: orderIds } }, select: { assetId: true } });
  const assetIds = [...new Set([...documents.map(({ assetId }) => assetId), ...orderAssets.map(({ assetId }) => assetId)])];
  await prisma.$transaction(async (transaction) => {
    await transaction.contractAcceptance.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.contractDocument.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.rightsSplitProposal.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.rightsGrant.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.rightsMessage.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.rightsRequestEvent.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.rightsContribution.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.contractPartySnapshot.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.rightsRequest.deleteMany({ where: { id: { in: requestIds } } });
    await transaction.orderNotification.deleteMany({ where: { orderId: { in: orderIds } } });
    await transaction.providerEvent.deleteMany({ where: { payment: { orderId: { in: orderIds } } } });
    await transaction.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await transaction.orderAsset.deleteMany({ where: { orderId: { in: orderIds } } });
    await transaction.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await transaction.commercialLicense.deleteMany({ where: { orderId: { in: orderIds } } });
    await transaction.order.deleteMany({ where: { id: { in: orderIds } } });
    await transaction.asset.deleteMany({ where: { id: { in: assetIds } } });
    await transaction.rateLimit.deleteMany({ where: { OR: [{ key: { in: userIds.flatMap((id) => [`rights:${id}`, `orders:${id}`]) } }, { key: "127.0.0.1|/sign-in/email" }] } });
    await transaction.session.deleteMany({ where: { userId: { in: userIds } } });
    await transaction.account.deleteMany({ where: { userId: { in: userIds } } });
    await transaction.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

async function assertClean() {
  const counts = await Promise.all([
    prisma.user.count({ where: { email: { in: [memberEmail, adminEmail] } } }),
    prisma.order.count({ where: { orderNumber: { in: [...orderNumbers] } } }),
    prisma.rightsRequest.count({ where: { requestNumber: { in: [...requestNumbers] } } }),
  ]);
  assert.deepEqual(counts, [0, 0, 0], "Rights browser fixtures remain after cleanup.");
}

async function createDeliveredOrder(userId: string, sequence: number) {
  const orderNumber = orderNumbers[sequence - 1]!;
  const orderId = randomUUID();
  const assetId = randomUUID();
  const now = new Date();
  const terms = personalUseTermsSnapshot();
  await prisma.$transaction(async (transaction) => {
    await transaction.order.create({ data: { id: orderId, orderNumber, userId, customerEmail: memberEmail, customerName: "Camille Navigateur", status: "DELIVERED", title: `Création navigateur ${sequence}`, brief: "Fixture exclusivement réservée à la QA navigateur jetable V0.7.2.", usage: "PERSONAL", totalCents: 5_000, personalUseTermsVersion: terms.version, personalUseTermsHashSha256: terms.hashSha256, personalUseTermsAcceptedAt: now, submittedAt: now, deliveredAt: now } });
    await transaction.payment.create({ data: { orderId, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 5_000, currency: "EUR", pricingVersion: "2026-08-v1", idempotencyKey: `v072-browser-payment-${sequence}`, providerCheckoutId: `cs_test_v072_browser_${sequence}`, providerPaymentId: `pi_test_v072_browser_${sequence}`, paymentMethod: "CARD", paidAt: now } });
    await transaction.asset.create({ data: { id: assetId, type: "AUDIO", storageKey: `qa-v072-browser/delivery-${sequence}.wav`, storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE", checksumSha256: String(sequence).repeat(64), filename: `master-qa-${sequence}.wav`, mimeType: "audio/wav", sizeBytes: 1_024n, rightsStatus: "RESTRICTED", confidence: "CONFIRMED" } });
    await transaction.orderAsset.create({ data: { orderId, assetId, role: "DELIVERY" } });
  });
  return { orderId, orderNumber };
}

async function setup() {
  await cleanup();
  await assertClean();
  const password = process.env.LNX_AUTH_QA_PASSWORD as string;
  const member = await createInternalAuthUser({ email: memberEmail, password, displayName: "Camille Navigateur", role: "MEMBER" });
  await createInternalAuthUser({ email: adminEmail, password, displayName: "LNX Admin Navigateur", role: "ADMIN" });
  const [draftOrder, submittedOrder] = await Promise.all([createDeliveredOrder(member.id, 1), createDeliveredOrder(member.id, 2), createDeliveredOrder(member.id, 3)]);
  const publication = rightsPriceSnapshot("PUBLICATION_LICENSE");
  const partnership = rightsPriceSnapshot("EXPLOITATION_PARTNERSHIP");
  await prisma.rightsRequest.create({ data: { requestNumber: requestNumbers[0], orderId: draftOrder.orderId, userId: member.id, type: "PUBLICATION_LICENSE", status: "DRAFT", requestedPriceCents: publication.priceCents, currency: publication.currency, pricingVersion: publication.pricingVersion, workTitle: "Création navigateur 1", artistName: "Camille QA", formVersion: "2026-08-rights-form-v1", formData: { project: { territory: "France", duration: "Deux ans", platforms: ["SPOTIFY", "DEEZER"] }, partnership: null }, partySnapshots: { create: { version: 1, partyType: "INDIVIDUAL", firstName: "Camille", lastName: "Navigateur", artistName: "Camille QA", streetAddress: "1 rue de la QA", postalCode: "75001", city: "Paris", country: "FR", contractEmail: memberEmail } }, contributions: { create: { kind: "STORY_BRIEF_ONLY", description: "Histoire fictive de la fixture navigateur.", position: 0 } }, events: { create: { type: "REQUEST_CREATED", idempotencyKey: "rights:v072-browser:publication:created", actorUserId: member.id, note: "Brouillon navigateur créé." } } } });
  const submittedAt = new Date();
  await prisma.rightsRequest.create({ data: { requestNumber: requestNumbers[1], orderId: submittedOrder.orderId, userId: member.id, type: "EXPLOITATION_PARTNERSHIP", status: "SUBMITTED", requestedPriceCents: partnership.priceCents, currency: partnership.currency, pricingVersion: partnership.pricingVersion, workTitle: "Création navigateur 2", artistName: "Camille QA", formVersion: "2026-08-rights-form-v1", formData: { project: { territory: "Europe", duration: "À définir", platforms: ["SPOTIFY", "YOUTUBE"] }, partnership: { aiKnown: true, humanCreativeContribution: "Direction humaine fictive à étudier." } }, submittedAt, partySnapshots: { create: { version: 1, partyType: "INDIVIDUAL", firstName: "Camille", lastName: "Navigateur", artistName: "Camille QA", streetAddress: "1 rue de la QA", postalCode: "75001", city: "Paris", country: "FR", contractEmail: memberEmail, confirmedAt: submittedAt, confirmedByUserId: member.id } }, contributions: { create: { kind: "LYRICS_PARTIAL", description: "Paroles fictives pour la QA.", claimedPercentage: 20, position: 0 } }, events: { create: [{ type: "REQUEST_CREATED", idempotencyKey: "rights:v072-browser:partnership:created", actorUserId: member.id, note: "Demande navigateur créée." }, { type: "CONTACT_CONFIRMED", idempotencyKey: "rights:v072-browser:partnership:contact", actorUserId: member.id, note: "Coordonnées confirmées." }, { type: "REQUEST_SUBMITTED", idempotencyKey: "rights:v072-browser:partnership:submitted", actorUserId: member.id, note: "Demande envoyée." }] } } });
  console.info(`Rights browser fixtures ready: ${memberEmail} / ${adminEmail}; ${orderNumbers.join(", ")}.`);
}

async function main() {
  await loadAndAssertRightsQaEnvironment();
  const mode = process.argv[2];
  if (mode === "setup") await setup();
  else if (mode === "cleanup") { await cleanup(); await assertClean(); console.info("Rights browser fixtures cleaned."); }
  else throw new Error("Expected setup or cleanup.");
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Rights browser fixtures failed."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
