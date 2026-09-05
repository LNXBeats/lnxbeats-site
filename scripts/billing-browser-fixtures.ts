import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { issueCreditNoteForRefund, issueInvoiceForPayment } from "@/lib/billing/service";
import { prisma } from "@/lib/prisma";

const TARGET = "lnx-studio-v110-phase4b-visual-qa";
const MEMBER_EMAIL = "lnx-v110-phase4b-member@example.invalid";
const ADMIN_EMAIL = "lnx-v110-phase4b-admin@example.invalid";

type Proof = {
  name?: unknown;
  pid?: unknown;
  databasePort?: unknown;
  exports?: { database?: { connectionString?: unknown } };
};

async function assertVisualQaRuntime() {
  assert.equal(process.env.NODE_ENV, "development");
  assert.equal(process.env.LNX_DATABASE_TARGET, TARGET);
  assert.equal(process.env.PAYMENTS_ENABLED, "false");
  assert.equal(process.env.SHOP_ENABLED, "false");
  assert.equal(process.env.SHOP_PAYMENTS_ENABLED, "false");
  assert.equal(process.env.EMAIL_PROVIDER, "capture");
  assert.equal(process.env.NOTIFICATION_EMAIL_TRANSPORT, "capture");
  for (const name of [
    "STRIPE_SECRET_KEY", "PAYPAL_CLIENT_SECRET", "RESEND_API_KEY", "R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID",
  ]) assert.ok(!process.env[name], `${name} is forbidden in the billing visual QA runtime.`);

  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  const databaseUrl = process.env.DATABASE_URL;
  if (!proofPath?.endsWith(`/${TARGET}/server.json`) || !databaseUrl) throw new Error("Exact visual QA database proof is required.");
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as Proof;
  const parsed = new URL(databaseUrl);
  assert.equal(proof.name, TARGET);
  assert.equal(proof.exports?.database?.connectionString, databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.notEqual(parsed.port, "5432");
  assert.equal(decodeURIComponent(parsed.pathname), "/template1");
  assert.equal(Number(proof.databasePort), Number(parsed.port));
  assert.ok(Number.isInteger(proof.pid) && Number(proof.pid) > 0);
  process.kill(Number(proof.pid), 0);

  const identity = await prisma.$queryRaw<Array<{ database: string; address: string | null; port: number | null }>>`
    SELECT current_database() AS database, inet_server_addr()::text AS address, inet_server_port() AS port
  `;
  assert.equal(identity[0]?.database, "template1");
  if (identity[0]?.address !== null) assert.ok(identity[0]?.address === "127.0.0.1" || identity[0]?.address === "::1");
  if (identity[0]?.port !== null) assert.equal(identity[0]?.port, Number(parsed.port));
  const migrations = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  assert.equal(Number(migrations[0]?.count), 29);
}

async function createMusicPayment(userId: string, orderNumber: string, title: string, totalCents: number, paid: boolean) {
  const now = new Date();
  const coverIncluded = totalCents === 3000 || totalCents === 6000;
  const priorityProcessing = totalCents === 5000 || totalCents === 6000;
  const order = await prisma.order.create({
    data: {
      orderNumber, userId, customerEmail: MEMBER_EMAIL, customerName: "Jean Exemple",
      status: paid ? "PAYMENT_CONFIRMED" : "AWAITING_PAYMENT", title,
      brief: "Brief entièrement fictif réservé à la validation locale de la facturation.",
      basePriceCents: 2000, coverIncluded, coverPriceCents: coverIncluded ? 1000 : 0,
      priorityProcessing, priorityPriceCents: priorityProcessing ? 3000 : 0,
      totalCents, currency: "EUR", pricingVersion: "billing-phase4b-visual-qa",
      personalUseTermsVersion: "music-cgv-2026-02-draft", personalUseTermsHashSha256: "a".repeat(64), personalUseTermsAcceptedAt: now,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id, provider: "STRIPE", mode: "TEST", status: paid ? "SUCCEEDED" : "PENDING",
      amountCents: totalCents, currency: "EUR", pricingVersion: "billing-phase4b-visual-qa",
      idempotencyKey: `billing-visual:${order.id}`, providerCheckoutId: `billing-visual-checkout:${order.id}`,
      ...(paid ? { paidAt: now } : {}),
    },
  });
  return { order, payment };
}

async function main() {
  await assertVisualQaRuntime();
  const memberPassword = process.env.LNX_AUTH_QA_MEMBER_PASSWORD;
  const adminPassword = process.env.LNX_AUTH_QA_ADMIN_PASSWORD;
  assert.ok(memberPassword && memberPassword.length >= 16, "A distinct MEMBER QA password is required.");
  assert.ok(adminPassword && adminPassword.length >= 16, "A distinct ADMIN QA password is required.");
  assert.notEqual(memberPassword, adminPassword);
  assert.equal(await prisma.user.count(), 0, "Visual QA database must be empty before fixture setup.");

  const member = await createInternalAuthUser({ email: MEMBER_EMAIL, password: memberPassword, displayName: "Membre LNX", role: "MEMBER" });
  const admin = await createInternalAuthUser({ email: ADMIN_EMAIL, password: adminPassword, displayName: "Admin Facturation QA", role: "ADMIN" });

  const individualPayment = await createMusicPayment(member.id, "LNX-2099-100001", "Création musicale — particulier QA", 3000, true);
  const individualInvoice = await prisma.$transaction((transaction) => issueInvoiceForPayment(transaction, individualPayment.payment.id));

  const professionalPayment = await createMusicPayment(member.id, "LNX-2099-100002", "Création musicale — professionnel QA", 5000, true);
  const professionalInvoice = await prisma.$transaction((transaction) => issueInvoiceForPayment(transaction, professionalPayment.payment.id, {
    customer: {
      type: "PROFESSIONAL", name: "Marie Exemple", email: "facturation@entreprise.example.invalid",
      companyName: "Entreprise Exemple SAS", billingAddress: { line1: "12 rue Exemple", postalCode: "75000", city: "Paris", countryCode: "FR" },
      businessIdentifier: "12345678900012", vatId: null,
    },
  }));

  await createMusicPayment(member.id, "LNX-2099-100003", "Création musicale — impayée QA", 2000, false);

  const product = await prisma.product.create({
    data: {
      slug: "billing-phase4b-cd-qa", title: "CD fictif — Facturation QA", description: "Produit entièrement fictif.",
      status: "PUBLISHED", priceCents: 2500, currency: "EUR", trackInventory: true, stock: 7,
      shippingRequired: true, shippingPriceCents: 500, publishedAt: new Date(), createdByAdminId: admin.id,
    },
  });
  const shopNow = new Date();
  const shopOrder = await prisma.shopOrder.create({
    data: {
      orderNumber: "LNX-SHOP-2099-100001", userId: member.id, creationToken: randomUUID(), requestFingerprintSha256: "b".repeat(64),
      status: "OPEN", paymentStatus: "PAID", fulfillmentStatus: "PENDING", subtotalCents: 2500, shippingCents: 500, totalCents: 3000,
      shippingRequired: true, shippingFirstName: "Élodie Anne-Marie", shippingLastName: "D’Arcy", shippingAddressLine1: "18 rue de l’Exemple",
      shippingAddressLine2: "Bâtiment B", shippingPostalCode: "69001", shippingCity: "Lyon", shippingCountryCode: "FR", termsVersion: "shop-cgv-2026-02-draft",
      termsHashSha256: "c".repeat(64), termsAcceptedAt: shopNow, reservationExpiresAt: new Date(shopNow.getTime() + 86_400_000), paidAt: shopNow, createdAt: shopNow,
      items: {
        create: {
          productId: product.id, position: 0, productTitle: product.title, inventoryTracked: true, unitPriceCents: 2500, quantity: 1,
          lineTotalCents: 2500, shippingRequired: true, unitShippingCents: 500, lineShippingCents: 500, currency: "EUR",
          reservation: { create: { status: "CONFIRMED", expiresAt: new Date(shopNow.getTime() + 86_400_000), confirmedAt: shopNow, createdAt: shopNow } },
        },
      },
    },
  });
  const shopPayment = await prisma.payment.create({
    data: {
      shopOrderId: shopOrder.id, provider: "PAYPAL", mode: "TEST", status: "SUCCEEDED", amountCents: 3000, currency: "EUR",
      pricingVersion: "shop-phase4b-visual-qa", idempotencyKey: `billing-visual:${shopOrder.id}`,
      providerCheckoutId: `billing-visual-paypal:${shopOrder.id}`, paidAt: shopNow,
    },
  });
  const shopInvoice = await prisma.$transaction((transaction) => issueInvoiceForPayment(transaction, shopPayment.id));

  const withdrawal = await prisma.consumerWithdrawalRequest.create({
    data: {
      requestNumber: "RET-2099-100001", publicReceiptTokenHash: "d".repeat(64), deduplicationHashSha256: "e".repeat(64), contractType: "MUSIC_ORDER",
      claimedOrderReference: individualPayment.order.orderNumber, orderId: individualPayment.order.id, identityMatch: "MATCHED",
      claimantFirstName: "Jean", claimantLastName: "Exemple", claimantEmail: MEMBER_EMAIL, productDescription: "Création musicale fictive",
      declarationText: "Demande de rétractation entièrement fictive.", receivedAt: shopNow, status: "ACCEPTED", eligibilityReview: "ELIGIBLE",
      reviewedAt: shopNow, reviewedByUserId: admin.id, acknowledgementSnapshot: { qa: true }, acknowledgementHashSha256: "f".repeat(64),
      acknowledgementCreatedAt: shopNow, refundStatus: "REFUND_REQUIRED",
    },
  });
  const firstRefund = await prisma.refundAttempt.create({
    data: {
      paymentId: individualPayment.payment.id, provider: "STRIPE", source: "ADMIN", requestedByUserId: admin.id,
      amountCents: 1000, currency: "EUR", localIdempotencyKey: "billing-visual-refund-1", providerRefundId: "billing-visual-provider-refund-1",
      providerIdempotencyKey: "billing-visual-provider-key-1", status: "SUCCEEDED", confirmedAt: shopNow,
    },
  });
  const withdrawalCredit = await prisma.$transaction((transaction) => issueCreditNoteForRefund(transaction, {
    refundAttemptId: firstRefund.id, withdrawalRequestId: withdrawal.id, reasonCode: "WITHDRAWAL",
  }));
  const secondRefund = await prisma.refundAttempt.create({
    data: {
      paymentId: individualPayment.payment.id, provider: "STRIPE", source: "ADMIN", requestedByUserId: admin.id,
      amountCents: 500, currency: "EUR", localIdempotencyKey: "billing-visual-refund-2", providerRefundId: "billing-visual-provider-refund-2",
      providerIdempotencyKey: "billing-visual-provider-key-2", status: "SUCCEEDED", confirmedAt: new Date(shopNow.getTime() + 1_000),
    },
  });
  const nonConformityCredit = await prisma.$transaction((transaction) => issueCreditNoteForRefund(transaction, {
    refundAttemptId: secondRefund.id, reasonCode: "NON_CONFORMITY", reasonText: "Correction fictive distincte de la rétractation.",
  }));

  console.info(JSON.stringify({
    event: "billing.visual-fixtures.ready", memberEmail: MEMBER_EMAIL, adminEmail: ADMIN_EMAIL,
    musicInvoice: individualInvoice.invoice.invoiceNumber, professionalInvoice: professionalInvoice.invoice.invoiceNumber,
    shopInvoice: shopInvoice.invoice.invoiceNumber, withdrawalCredit: withdrawalCredit.creditNote.creditNoteNumber,
    nonConformityCredit: nonConformityCredit.creditNote.creditNoteNumber,
  }));
}

main().finally(() => prisma.$disconnect());
