import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { legalNoticesCandidate } from "@/data/legal";
import { getWithdrawalReceipt, parseWithdrawalSubmission, submitWithdrawalRequest } from "@/lib/legal/withdrawal";
import { prisma } from "@/lib/prisma";

const suffix = randomUUID().slice(0, 8);
const userId = randomUUID();
const orderId = randomUUID();
const shopOrderId = randomUUID();
const email = `legal-${suffix}@example.invalid`;
const musicOrderNumber = `LNX-2099-${suffix.slice(0, 6).replace(/[a-f]/g, "1").padEnd(6, "1")}`;
const shopOrderNumber = `LNX-SHOP-2099-${suffix.slice(0, 6).replace(/[a-f]/g, "2").padEnd(6, "2")}`;

async function main() {
  const createdAt = new Date();
  const migrations = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`;
  assert.equal(Number(migrations[0]?.count), 23);

  await prisma.user.create({
    data: { id: userId, email, emailVerified: true, displayName: "Legal Runtime", role: "MEMBER", status: "ACTIVE" },
  });
  await prisma.order.create({
    data: { id: orderId, orderNumber: musicOrderNumber, userId, customerEmail: email, customerName: "Legal Runtime", brief: "Runtime legal test", basePriceCents: 2000, totalCents: 2000 },
  });
  await prisma.shopOrder.create({
    data: {
      id: shopOrderId,
      orderNumber: shopOrderNumber,
      userId,
      creationToken: randomUUID(),
      requestFingerprintSha256: "a".repeat(64),
      subtotalCents: 3000,
      shippingCents: 0,
      totalCents: 3000,
      shippingRequired: false,
      reservationExpiresAt: new Date(Date.now() + 30 * 60_000),
      createdAt,
      termsVersion: "shop-cgv-phase3-qa-v1",
      termsHashSha256: "b".repeat(64),
      termsAcceptedAt: createdAt,
    },
  });

  const document = await prisma.legalDocumentVersion.create({
    data: {
      type: legalNoticesCandidate.type,
      version: `${legalNoticesCandidate.version}-${suffix}`,
      hashSha256: legalNoticesCandidate.hashSha256,
      status: legalNoticesCandidate.status,
    },
  });
  assert.equal(document.status, "AWAITING_LEGAL_REVIEW");
  await assert.rejects(
    prisma.legalDocumentVersion.create({
      data: {
        type: "PRIVACY_NOTICE",
        version: `invalid-active-${suffix}`,
        hashSha256: "c".repeat(64),
        status: "ACTIVE",
        effectiveAt: new Date(),
      },
    }),
  );

  const submission = parseWithdrawalSubmission({
    contractType: "SHOP_ORDER",
    orderNumber: shopOrderNumber,
    firstName: "Marie",
    lastName: "Runtime",
    email,
    productDescription: "CD audio",
    quantity: 1,
    reason: null,
    declarationAccepted: true,
  });
  const first = await submitWithdrawalRequest(submission, "127.0.0.1");
  const second = await submitWithdrawalRequest(submission, "127.0.0.1");
  assert.equal(second.requestNumber, first.requestNumber);
  const stored = await prisma.consumerWithdrawalRequest.findUniqueOrThrow({ where: { requestNumber: first.requestNumber } });
  assert.equal(stored.identityMatch, "MATCHED");
  assert.equal(stored.shopOrderId, shopOrderId);
  assert.equal(stored.orderId, null);
  assert.equal(stored.eligibilityReview, "PENDING_REVIEW");
  assert.equal(stored.refundStatus, "NOT_EVALUATED");
  assert.equal(stored.acknowledgementStatus, "CAPTURED");
  assert.equal(await prisma.consumerWithdrawalRequest.count({ where: { deduplicationHashSha256: stored.deduplicationHashSha256 } }), 1);
  assert.equal(await prisma.payment.count({ where: { shopOrderId } }), 0);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId } }), 0);
  assert.ok(await getWithdrawalReceipt(second.receiptToken));
  assert.equal(await getWithdrawalReceipt(first.receiptToken), null, "duplicate submission rotates the private receipt token");

  const unmatched = await submitWithdrawalRequest(parseWithdrawalSubmission({
    contractType: "MUSIC_ORDER",
    orderNumber: "LNX-2099-999999",
    firstName: "Inconnu",
    lastName: "Demandeur",
    email: "unknown@example.invalid",
    productDescription: "Création musicale",
    quantity: null,
    reason: null,
    declarationAccepted: true,
  }), "127.0.0.2");
  const unmatchedStored = await prisma.consumerWithdrawalRequest.findUniqueOrThrow({ where: { requestNumber: unmatched.requestNumber } });
  assert.equal(unmatchedStored.identityMatch, "UNMATCHED");
  assert.equal(unmatchedStored.orderId, null);
  assert.equal(unmatchedStored.shopOrderId, null);

  const counts = {
    migrations: Number(migrations[0]?.count),
    documentCandidate: document.status,
    matched: stored.identityMatch,
    duplicateCount: await prisma.consumerWithdrawalRequest.count({ where: { requestNumber: first.requestNumber } }),
    unmatched: unmatchedStored.identityMatch,
    paymentsCreated: await prisma.payment.count({ where: { shopOrderId } }),
    notificationsCreated: await prisma.orderNotification.count({ where: { shopOrderId } }),
  };
  console.log(JSON.stringify({ event: "legal.runtime.completed", ...counts }));

  await prisma.consumerWithdrawalRequest.deleteMany({ where: { OR: [{ id: stored.id }, { id: unmatchedStored.id }] } });
  await prisma.legalDocumentVersion.delete({ where: { id: document.id } });
  await prisma.shopOrder.delete({ where: { id: shopOrderId } });
  await prisma.order.delete({ where: { id: orderId } });
  await prisma.user.delete({ where: { id: userId } });
}

main().finally(() => prisma.$disconnect());
