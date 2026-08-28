import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { issueCreditNoteForRefund, issueInvoiceForPayment, getInvoiceForMember } from "@/lib/billing/service";
import { enqueuePaymentConfirmedNotifications, enqueueShopPaymentConfirmedNotifications } from "@/lib/notifications/service";
import { prisma } from "@/lib/prisma";

const TARGET = "lnx-studio-v110-phase4b-test";
const FIXTURE = `billing-${randomUUID().slice(0, 8)}`;
const MEMBER_EMAIL = `${FIXTURE}-member@example.invalid`;
const OTHER_EMAIL = `${FIXTURE}-other@example.invalid`;

type Proof = {
  name?: unknown;
  pid?: unknown;
  databasePort?: unknown;
  exports?: { database?: { connectionString?: unknown } };
};

async function assertDisposableRuntime() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, TARGET);
  assert.equal(process.env.EMAIL_PROVIDER, "capture");
  assert.equal(process.env.NOTIFICATION_EMAIL_TRANSPORT, "capture");
  assert.equal(process.env.PAYMENTS_ENABLED, "false");
  assert.equal(process.env.SHOP_ENABLED, "false");
  assert.equal(process.env.SHOP_PAYMENTS_ENABLED, "false");
  assert.equal(process.env.MUSIC_PRICING_SOURCE, "legacy");
  for (const name of ["STRIPE_SECRET_KEY", "PAYPAL_CLIENT_SECRET", "RESEND_API_KEY", "R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"]) {
    assert.ok(!process.env[name], `${name} is forbidden in billing runtime.`);
  }
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  const databaseUrl = process.env.DATABASE_URL;
  if (!proofPath?.endsWith(`/${TARGET}/server.json`)) throw new Error("Billing runtime requires the exact disposable Prisma Dev proof.");
  if (!databaseUrl) throw new Error("Billing runtime database URL is absent.");
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as Proof;
  const parsed = new URL(databaseUrl);
  assert.equal(proof.name, TARGET);
  assert.equal(proof.exports?.database?.connectionString, databaseUrl);
  assert.ok(parsed.protocol === "postgres:" || parsed.protocol === "postgresql:");
  assert.ok(parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1");
  assert.notEqual(parsed.port, "5432");
  assert.equal(decodeURIComponent(parsed.pathname), "/template1");
  assert.equal(Number(proof.databasePort), Number(parsed.port));
  assert.ok(Number.isInteger(proof.pid) && Number(proof.pid) > 0);
  process.kill(Number(proof.pid), 0);
  const identity = await prisma.$queryRaw<Array<{ database: string; schema: string; address: string | null; port: number | null }>>`
    SELECT current_database() AS database, current_schema() AS schema,
      inet_server_addr()::text AS address, inet_server_port() AS port
  `;
  assert.equal(identity[0]?.database, "template1");
  assert.equal(identity[0]?.schema, "public");
  if (identity[0]?.address !== null) assert.ok(identity[0]?.address === "127.0.0.1" || identity[0]?.address === "::1");
  if (identity[0]?.port !== null) assert.equal(identity[0]?.port, Number(parsed.port));
}

function numberSuffix(sequence: number) {
  return `${String(sequence).padStart(6, "0")}`;
}

async function createUser(email: string, displayName: string) {
  return prisma.user.create({ data: { email, emailVerified: true, emailVerifiedAt: new Date(), displayName, role: "MEMBER", status: "ACTIVE" } });
}

async function createAdmin(email: string, displayName: string) {
  return prisma.user.create({ data: { email, emailVerified: true, emailVerifiedAt: new Date(), displayName, role: "ADMIN", status: "ACTIVE" } });
}

async function createMusicPayment(userId: string, sequence: number, status: "SUCCEEDED" | "PENDING" = "SUCCEEDED") {
  const order = await prisma.order.create({
    data: {
      orderNumber: `LNX-2099-${numberSuffix(sequence)}`, userId, customerEmail: MEMBER_EMAIL, customerName: "Jean Exemple",
      status: status === "SUCCEEDED" ? "PAYMENT_CONFIRMED" : "AWAITING_PAYMENT", title: `Création musicale QA ${sequence}`,
      brief: "Brief fictif de facturation.", basePriceCents: 2000, coverIncluded: true, coverPriceCents: 1000,
      totalCents: 3000, currency: "EUR", pricingVersion: "billing-phase4b-qa",
      personalUseTermsVersion: "music-cgv-phase4b-qa", personalUseTermsHashSha256: "a".repeat(64), personalUseTermsAcceptedAt: new Date(),
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id, provider: sequence % 2 ? "STRIPE" : "PAYPAL", mode: "TEST", status,
      amountCents: 3000, currency: "EUR", pricingVersion: "billing-phase4b-qa", idempotencyKey: `${FIXTURE}:music:${sequence}`,
      providerCheckoutId: `${FIXTURE}:checkout:${sequence}`, ...(status === "SUCCEEDED" ? { paidAt: new Date() } : {}),
    },
  });
  return { order, payment };
}

async function createShopPayment(userId: string, sequence: number) {
  const now = new Date();
  const product = await prisma.product.create({
    data: { slug: `${FIXTURE}-product-${sequence}`, title: `CD fictif QA ${sequence}`, description: "Produit fictif.", status: "PUBLISHED", priceCents: 2500, currency: "EUR", trackInventory: true, stock: 8, shippingRequired: true, shippingPriceCents: 500, publishedAt: new Date() },
  });
  const order = await prisma.shopOrder.create({
    data: {
      orderNumber: `LNX-SHOP-2099-${numberSuffix(sequence)}`, userId, creationToken: randomUUID(), requestFingerprintSha256: `${sequence}`.padStart(64, "b").slice(0, 64),
      status: "OPEN", paymentStatus: "PAID", fulfillmentStatus: "PENDING", subtotalCents: 2500, shippingCents: 500, totalCents: 3000,
      shippingRequired: true, shippingFirstName: "Jean", shippingLastName: "Exemple", shippingAddressLine1: "12 rue Exemple", shippingPostalCode: "75000", shippingCity: "Paris", shippingCountryCode: "FR",
      termsVersion: "shop-cgv-phase4b-qa", termsHashSha256: "c".repeat(64), termsAcceptedAt: now, reservationExpiresAt: new Date(now.getTime() + 60_000), paidAt: now, createdAt: now,
      items: { create: { productId: product.id, position: 0, productTitle: product.title, inventoryTracked: true, unitPriceCents: 2500, quantity: 1, lineTotalCents: 2500, shippingRequired: true, unitShippingCents: 500, lineShippingCents: 500, currency: "EUR" } },
    },
  });
  const payment = await prisma.payment.create({
    data: { shopOrderId: order.id, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 3000, currency: "EUR", pricingVersion: "shop-phase4b-qa", idempotencyKey: `${FIXTURE}:shop:${sequence}`, providerCheckoutId: `${FIXTURE}:shop-checkout:${sequence}`, paidAt: order.paidAt },
  });
  return { order, payment, product };
}

function prismaSqlState(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const value = error as { code?: unknown; meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } } };
  return value.meta?.code ?? value.meta?.driverAdapterError?.cause?.originalCode ?? value.code ?? null;
}

async function main() {
  await assertDisposableRuntime();
  const applied = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(Number(applied[0]?.count), 23);

  const member = await createUser(MEMBER_EMAIL, "Jean Exemple");
  const other = await createUser(OTHER_EMAIL, "Autre Exemple");
  const reviewer = await createAdmin(`${FIXTURE}-reviewer@example.invalid`, "Relecteur Facturation");
  const music = await createMusicPayment(member.id, 1);
  const individual = await prisma.$transaction(async (transaction) => {
    const issued = await issueInvoiceForPayment(transaction, music.payment.id, { issuedAt: new Date("2099-01-01T12:00:00Z") });
    await enqueuePaymentConfirmedNotifications(transaction, music.order.id);
    return issued;
  });
  assert.equal(individual.created, true);
  assert.equal(individual.invoice.documentType, "MUSIC");
  assert.equal(individual.invoice.customerType, "INDIVIDUAL");
  assert.equal(individual.invoice.totalCents, 3000);
  assert.equal(individual.invoice.vatAmountCents, 0);
  assert.equal(individual.invoice.vatLegalNotice, "TVA non applicable, article 293 B du CGI");
  assert.equal(await getInvoiceForMember(individual.invoice.invoiceNumber, other.id), null);
  assert.equal((await getInvoiceForMember(individual.invoice.invoiceNumber, member.id))?.id, individual.invoice.id);
  const musicNotifications = await prisma.orderNotification.findMany({ where: { orderId: music.order.id } });
  assert.equal(musicNotifications.length, 2);
  assert.ok(musicNotifications.every((notification) => (notification.payload as { invoiceNumber?: string }).invoiceNumber === individual.invoice.invoiceNumber));

  const pending = await createMusicPayment(member.id, 2, "PENDING");
  await assert.rejects(() => prisma.$transaction((transaction) => issueInvoiceForPayment(transaction, pending.payment.id)));
  assert.equal(await prisma.invoice.count({ where: { paymentId: pending.payment.id } }), 0);

  const professionalPayment = await createMusicPayment(member.id, 3);
  const professional = await prisma.$transaction((transaction) => issueInvoiceForPayment(transaction, professionalPayment.payment.id, {
    issuedAt: new Date("2099-01-01T12:01:00Z"),
    customer: {
      type: "PROFESSIONAL", name: "Marie Exemple", email: "facturation@entreprise.example.invalid", companyName: "Entreprise Exemple SAS",
      billingAddress: { line1: "12 rue Exemple", postalCode: "75000", city: "Paris", countryCode: "FR" }, businessIdentifier: "12345678900012", vatId: null,
    },
  }));
  assert.equal(professional.invoice.customerType, "PROFESSIONAL");
  assert.equal((professional.invoice.customerSnapshot as { companyName?: string }).companyName, "Entreprise Exemple SAS");

  const shop = await createShopPayment(member.id, 4);
  const shopInvoice = await prisma.$transaction(async (transaction) => {
    const issued = await issueInvoiceForPayment(transaction, shop.payment.id, { issuedAt: new Date("2099-01-01T12:02:00Z") });
    await enqueueShopPaymentConfirmedNotifications(transaction, { shopOrderId: shop.order.id, paymentProvider: "STRIPE", termsVersion: shop.order.termsVersion! });
    return issued;
  });
  assert.equal(shopInvoice.invoice.subtotalCents, 2500);
  assert.equal(shopInvoice.invoice.shippingCents, 500);
  assert.equal(shopInvoice.invoice.totalCents, 3000);
  const shopSnapshot = structuredClone({ customer: shopInvoice.invoice.customerSnapshot, lines: shopInvoice.invoice.lineItemsSnapshot, total: shopInvoice.invoice.totalCents });
  await prisma.product.update({ where: { id: shop.product.id }, data: { title: "Titre courant modifié", priceCents: 9999 } });
  const unchangedShopInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: shopInvoice.invoice.id } });
  assert.deepEqual({ customer: unchangedShopInvoice.customerSnapshot, lines: unchangedShopInvoice.lineItemsSnapshot, total: unchangedShopInvoice.totalCents }, shopSnapshot);
  const shopNotifications = await prisma.orderNotification.findMany({ where: { shopOrderId: shop.order.id } });
  assert.equal(shopNotifications.length, 2);
  assert.ok(shopNotifications.every((notification) => (notification.payload as { invoiceNumber?: string }).invoiceNumber === shopInvoice.invoice.invoiceNumber));

  const concurrent = await createMusicPayment(member.id, 5);
  const duplicateResults = await Promise.all([
    prisma.$transaction((transaction) => issueInvoiceForPayment(transaction, concurrent.payment.id)),
    prisma.$transaction((transaction) => issueInvoiceForPayment(transaction, concurrent.payment.id)),
  ]);
  assert.equal(duplicateResults.filter((result) => result.created).length, 1);
  assert.equal(await prisma.invoice.count({ where: { paymentId: concurrent.payment.id } }), 1);

  const simultaneousA = await createMusicPayment(member.id, 6);
  const simultaneousB = await createMusicPayment(member.id, 7);
  const simultaneous = await Promise.all([
    prisma.$transaction((transaction) => issueInvoiceForPayment(transaction, simultaneousA.payment.id)),
    prisma.$transaction((transaction) => issueInvoiceForPayment(transaction, simultaneousB.payment.id)),
  ]);
  assert.notEqual(simultaneous[0].invoice.sequenceNumber, simultaneous[1].invoice.sequenceNumber);

  const rollbackPayment = await createMusicPayment(member.id, 8);
  let rolledBackSequence = 0n;
  await assert.rejects(() => prisma.$transaction(async (transaction) => {
    const issued = await issueInvoiceForPayment(transaction, rollbackPayment.payment.id);
    rolledBackSequence = issued.invoice.sequenceNumber;
    throw new Error("FORCED_BILLING_ROLLBACK");
  }));
  assert.equal(await prisma.invoice.count({ where: { paymentId: rollbackPayment.payment.id } }), 0);
  const afterRollbackPayment = await createMusicPayment(member.id, 9);
  const afterRollback = await prisma.$transaction((transaction) => issueInvoiceForPayment(transaction, afterRollbackPayment.payment.id));
  assert.ok(afterRollback.invoice.sequenceNumber > rolledBackSequence, "A rolled-back sequence value is never reused.");

  const withdrawal = await prisma.consumerWithdrawalRequest.create({
    data: {
      requestNumber: `RET-2099-${numberSuffix(1)}`, publicReceiptTokenHash: "d".repeat(64), deduplicationHashSha256: "e".repeat(64), contractType: "MUSIC_ORDER",
      claimedOrderReference: music.order.orderNumber, orderId: music.order.id, identityMatch: "MATCHED", claimantFirstName: "Jean", claimantLastName: "Exemple", claimantEmail: MEMBER_EMAIL,
      productDescription: "Création musicale fictive", declarationText: "Demande fictive QA", receivedAt: new Date(), status: "ACCEPTED", eligibilityReview: "ELIGIBLE",
      reviewedAt: new Date(), reviewedByUserId: reviewer.id, acknowledgementSnapshot: { qa: true }, acknowledgementHashSha256: "f".repeat(64), acknowledgementCreatedAt: new Date(), refundStatus: "REFUND_REQUIRED",
    },
  });
  const firstRefund = await prisma.refundAttempt.create({
    data: { paymentId: music.payment.id, provider: "STRIPE", source: "ADMIN", requestedByUserId: reviewer.id, amountCents: 1000, currency: "EUR", localIdempotencyKey: `${FIXTURE}:refund:1`, providerRefundId: `${FIXTURE}:provider-refund:1`, providerIdempotencyKey: `${FIXTURE}:provider-refund-key:1`, status: "SUCCEEDED", confirmedAt: new Date() },
  });
  const firstCredit = await prisma.$transaction((transaction) => issueCreditNoteForRefund(transaction, { refundAttemptId: firstRefund.id, withdrawalRequestId: withdrawal.id, reasonCode: "WITHDRAWAL" }));
  assert.equal(firstCredit.creditNote.amountCents, 1000);
  assert.equal(firstCredit.creditNote.cumulativeCreditedCents, 1000);
  assert.equal(firstCredit.creditNote.remainingBalanceCents, 2000);
  assert.equal(firstCredit.creditNote.withdrawalRequestId, withdrawal.id);
  const replayCredit = await prisma.$transaction((transaction) => issueCreditNoteForRefund(transaction, { refundAttemptId: firstRefund.id, withdrawalRequestId: withdrawal.id, reasonCode: "WITHDRAWAL" }));
  assert.equal(replayCredit.created, false);
  assert.equal(replayCredit.creditNote.id, firstCredit.creditNote.id);

  const secondRefund = await prisma.refundAttempt.create({
    data: { paymentId: music.payment.id, provider: "STRIPE", source: "ADMIN", requestedByUserId: reviewer.id, amountCents: 2000, currency: "EUR", localIdempotencyKey: `${FIXTURE}:refund:2`, providerRefundId: `${FIXTURE}:provider-refund:2`, providerIdempotencyKey: `${FIXTURE}:provider-refund-key:2`, status: "SUCCEEDED", confirmedAt: new Date() },
  });
  const secondCredit = await prisma.$transaction((transaction) => issueCreditNoteForRefund(transaction, { refundAttemptId: secondRefund.id, reasonCode: "NON_CONFORMITY" }));
  assert.equal(secondCredit.creditNote.amountCents, 2000);
  assert.equal(secondCredit.creditNote.cumulativeCreditedCents, 3000);
  assert.equal(secondCredit.creditNote.remainingBalanceCents, 0);
  assert.equal(await prisma.creditNote.aggregate({ where: { invoiceId: individual.invoice.id }, _sum: { amountCents: true } }).then((result) => result._sum.amountCents), 3000);

  const excessiveRefund = await prisma.refundAttempt.create({
    data: { paymentId: music.payment.id, provider: "STRIPE", source: "ADMIN", requestedByUserId: reviewer.id, amountCents: 1, currency: "EUR", localIdempotencyKey: `${FIXTURE}:refund:3`, providerRefundId: `${FIXTURE}:provider-refund:3`, providerIdempotencyKey: `${FIXTURE}:provider-refund-key:3`, status: "SUCCEEDED", confirmedAt: new Date() },
  });
  await assert.rejects(() => prisma.$transaction((transaction) => issueCreditNoteForRefund(transaction, { refundAttemptId: excessiveRefund.id })));
  assert.equal(await prisma.creditNote.count({ where: { invoiceId: individual.invoice.id } }), 2);

  await assert.rejects(
    () => prisma.$executeRawUnsafe(`UPDATE "invoices" SET "totalCents" = 1 WHERE "id" = '${individual.invoice.id}'`),
    (error: unknown) => String(prismaSqlState(error)) === "23514",
  );
  await assert.rejects(
    () => prisma.$executeRawUnsafe(`DELETE FROM "credit_notes" WHERE "id" = '${firstCredit.creditNote.id}'`),
    (error: unknown) => String(prismaSqlState(error)) === "23514",
  );

  const archivedUser = await createUser(`${FIXTURE}-archive@example.invalid`, "Archive Exemple");
  const archivedPayment = await createMusicPayment(archivedUser.id, 10);
  const archivedInvoice = await prisma.$transaction((transaction) => issueInvoiceForPayment(transaction, archivedPayment.payment.id));
  await prisma.order.update({ where: { id: archivedPayment.order.id }, data: { userId: null } });
  await prisma.user.delete({ where: { id: archivedUser.id } });
  assert.ok(await prisma.invoice.findUnique({ where: { id: archivedInvoice.invoice.id } }));
  assert.equal(await getInvoiceForMember(archivedInvoice.invoice.invoiceNumber, member.id), null);

  const counts = {
    migrations: Number(applied[0]?.count),
    invoices: await prisma.invoice.count(), creditNotes: await prisma.creditNote.count(),
    individual: await prisma.invoice.count({ where: { customerType: "INDIVIDUAL" } }), professional: await prisma.invoice.count({ where: { customerType: "PROFESSIONAL" } }),
    musicNotifications: musicNotifications.length, shopNotifications: shopNotifications.length,
    immutableSqlState: 23514, rollbackPreserved: true, idorBlocked: true, archivedInvoicePreserved: true,
  };
  console.log(JSON.stringify({ event: "billing.runtime.completed", ...counts }));
}

main().finally(() => prisma.$disconnect());
