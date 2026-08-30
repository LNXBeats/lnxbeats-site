import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { prisma } from "@/lib/prisma";
import { assertShopAfterSalesQaEnabled, SHOP_AFTER_SALES_QA_TARGET } from "@/lib/shop/after-sales-config";

const MEMBER_EMAIL = "lnx-v110-phase5b-member@example.invalid";
const ADMIN_EMAIL = "lnx-v110-phase5b-admin@example.invalid";
const ORDER_NUMBER = "LNX-SHOP-2026-500002";

async function guard() {
  assertShopAfterSalesQaEnabled();
  assert.equal(process.env.LNX_DATABASE_TARGET, SHOP_AFTER_SALES_QA_TARGET);
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  assert.ok(proofPath);
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as { name?: string; pid?: number };
  assert.equal(proof.name, SHOP_AFTER_SALES_QA_TARGET);
  process.kill(Number(proof.pid), 0);
}

async function run() {
  await guard();
  const memberPassword = process.env.LNX_AUTH_QA_MEMBER_PASSWORD;
  const adminPassword = process.env.LNX_AUTH_QA_ADMIN_PASSWORD;
  assert.ok(memberPassword && memberPassword.length >= 12);
  assert.ok(adminPassword && adminPassword.length >= 12);
  assert.notEqual(memberPassword, adminPassword);
  assert.equal(await prisma.user.count({ where: { email: { in: [MEMBER_EMAIL, ADMIN_EMAIL] } } }), 0);
  const now = new Date();
  const [member, admin] = await Promise.all([
    createInternalAuthUser({ email: MEMBER_EMAIL, password: memberPassword, displayName: "Membre fictif SAV Phase 5B", role: "MEMBER" }),
    createInternalAuthUser({ email: ADMIN_EMAIL, password: adminPassword, displayName: "Admin fictif SAV Phase 5B", role: "ADMIN" }),
  ]);
  const product = await prisma.product.create({ data: {
    slug: "lnx-v110-phase5b-cd-qa", title: "CD QA — Service après-vente", description: "Produit fictif local Phase 5B.",
    status: "PUBLISHED", priceCents: 2_500, currency: "EUR", trackInventory: true, stock: 7,
    shippingRequired: true, shippingPriceCents: 800, shippingWeightGrams: 120, publishedAt: now,
    createdByAdminId: admin.id, updatedByAdminId: admin.id,
  } });
  const order = await prisma.shopOrder.create({ data: {
    orderNumber: ORDER_NUMBER, userId: member.id, creationToken: randomUUID(), requestFingerprintSha256: "4".repeat(64),
    status: "OPEN", paymentStatus: "PAID", fulfillmentStatus: "SHIPPED", currency: "EUR",
    subtotalCents: 7_500, shippingCents: 800, totalCents: 8_300, shippingRequired: true,
    shippingFirstName: "Membre", shippingLastName: "SAV QA", shippingAddressLine1: "5 rue du Test local",
    shippingPostalCode: "75005", shippingCity: "Paris", shippingCountryCode: "FR",
    termsVersion: "shop-cgv-phase5b-qa-v1", termsHashSha256: "5".repeat(64), termsAcceptedAt: now,
    createdAt: now, updatedAt: now,
    reservationExpiresAt: new Date(now.getTime() + 30 * 60_000), paidAt: now,
    preparingAt: new Date(now.getTime() + 1_000), shippedAt: new Date(now.getTime() + 2_000),
    items: { create: [{ productId: product.id, position: 0, productTitle: product.title, inventoryTracked: true,
      unitPriceCents: 2_500, quantity: 3, lineTotalCents: 7_500, shippingRequired: true, unitShippingCents: 0,
      lineShippingCents: 0, unitShippingWeightGrams: 120, lineShippingWeightGrams: 360, currency: "EUR" }] },
  } });
  await prisma.stockReservation.create({ data: { shopOrderId: order.id, productId: product.id, quantity: 3, status: "CONFIRMED", expiresAt: order.reservationExpiresAt, confirmedAt: now, createdAt: now, updatedAt: now } });
  const payment = await prisma.payment.create({ data: {
    shopOrderId: order.id, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 8_300, currency: "EUR",
    pricingVersion: "shop-order-snapshot-v1", idempotencyKey: `phase5b-preview-payment:${order.id}`,
    providerCheckoutId: `cs_test_phase5b_preview_${order.id}`, providerPaymentId: `pi_phase5b_preview_${order.id}`, paymentMethod: "CARD", paidAt: now,
    createdAt: now, updatedAt: now,
  } });
  await prisma.invoice.create({ data: {
    invoiceNumber: "LNX-20260830-5002", sequenceNumber: 5002n, issuedAt: now, documentType: "SHOP", operationCategory: "GOODS",
    shopOrderId: order.id, paymentId: payment.id, orderNumberSnapshot: order.orderNumber, customerType: "INDIVIDUAL",
    customerNameSearch: "Membre SAV Phase 5B", customerEmailSearch: MEMBER_EMAIL, sellerSnapshot: { name: "LNX Beats QA" },
    customerSnapshot: { email: MEMBER_EMAIL }, lineItemsSnapshot: [{ title: product.title, unitPriceCents: 2_500, quantity: 3 }],
    currency: "EUR", subtotalCents: 7_500, shippingCents: 800, totalCents: 8_300, vatRegime: "FRANCHISE_EN_BASE_TVA",
    vatAmountCents: 0, vatLegalNotice: "TVA non applicable — QA", paymentMethodLabel: "Carte test", paidAt: now,
    termsVersion: "shop-cgv-phase5b-qa-v1", termsHashSha256: "5".repeat(64), snapshotHashSha256: "6".repeat(64),
    createdAt: now,
  } });
  console.info(JSON.stringify({ event: "shop.after-sales.preview.ready", outcome: "passed", memberEmail: MEMBER_EMAIL, adminEmail: ADMIN_EMAIL,
    orderNumber: ORDER_NUMBER, totalCents: 8_300, productTitle: product.title, quantity: 3 }));
}

run().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "shop.after-sales.preview.failed", outcome: "failed" }));
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
