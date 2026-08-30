import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { prisma } from "@/lib/prisma";
import {
  assertShopShippingOperationsQaEnabled,
  SHOP_SHIPPING_OPERATIONS_QA_TARGET,
} from "@/lib/shop/shipping-operations-config";

const MEMBER_EMAIL = "lnx-v110-phase5c-member@example.invalid";
const ADMIN_EMAIL = "lnx-v110-phase5c-admin@example.invalid";
const ORDER_NUMBER = "LNX-SHOP-2026-500003";
const VISUAL_ORDER_NUMBER = "LNX-SHOP-2026-500004";

async function guard() {
  assertShopShippingOperationsQaEnabled();
  assert.equal(process.env.LNX_DATABASE_TARGET, SHOP_SHIPPING_OPERATIONS_QA_TARGET);
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  assert.ok(proofPath);
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as { name?: string; pid?: number };
  assert.equal(proof.name, SHOP_SHIPPING_OPERATIONS_QA_TARGET);
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
  assert.equal(await prisma.shopOrder.count({ where: { orderNumber: { in: [ORDER_NUMBER, VISUAL_ORDER_NUMBER] } } }), 0);
  const now = new Date();
  const [member, admin] = await Promise.all([
    createInternalAuthUser({ email: MEMBER_EMAIL, password: memberPassword, displayName: "Membre fictif Expédition Phase 5C", role: "MEMBER" }),
    createInternalAuthUser({ email: ADMIN_EMAIL, password: adminPassword, displayName: "Admin fictif Expédition Phase 5C", role: "ADMIN" }),
  ]);
  const product = await prisma.product.create({ data: {
    slug: "lnx-v110-phase5c-cd-qa", title: "CD QA — Expédition locale", description: "Produit physique fictif local Phase 5C.",
    status: "PUBLISHED", priceCents: 2_500, currency: "EUR", trackInventory: true, stock: 9,
    shippingRequired: true, shippingPriceCents: 800, shippingWeightGrams: 120, publishedAt: now,
    createdByAdminId: admin.id, updatedByAdminId: admin.id, createdAt: now,
  } });
  const rate = await prisma.shippingRateVersion.create({ data: {
    version: "phase5c-preview-snapshot-v1", status: "ACTIVE", scope: "INTERNAL_QA",
    service: "STANDARD_TRACKED_SIGNATURE", currency: "EUR", countryCode: "FR",
    minimumBillableWeightGrams: 150, packagingWeightGrams: 150, activatedAt: now, createdAt: now,
    tiers: { create: [{ position: 0, maxWeightGrams: 500, priceCents: 800, createdAt: now }] },
  } });
  const order = await prisma.shopOrder.create({ data: {
    orderNumber: ORDER_NUMBER, userId: member.id, creationToken: randomUUID(), requestFingerprintSha256: "7".repeat(64),
    status: "OPEN", paymentStatus: "PAID", fulfillmentStatus: "PENDING", currency: "EUR",
    subtotalCents: 2_500, shippingCents: 800, totalCents: 3_300, shippingRequired: true,
    shippingFirstName: "Membre", shippingLastName: "Expédition QA", shippingAddressLine1: "7 rue du Test local",
    shippingPostalCode: "75007", shippingCity: "Paris", shippingCountryCode: "FR",
    shippingRateVersionId: rate.id,
    shippingQuoteVersion: "phase5a-qa-internal-v1", shippingMethod: "STANDARD_TRACKED_SIGNATURE",
    shippingWeightGrams: 120, shippingPackagingGrams: 150, shippingBillableGrams: 270,
    termsVersion: "shop-cgv-phase4c-candidate-v1", termsHashSha256: "8".repeat(64), termsAcceptedAt: now,
    reservationExpiresAt: new Date(now.getTime() + 30 * 60_000), paidAt: now, createdAt: now,
    items: { create: [{ productId: product.id, position: 0, productTitle: product.title, inventoryTracked: true,
      unitPriceCents: 2_500, quantity: 1, lineTotalCents: 2_500, shippingRequired: true, unitShippingCents: 0,
      lineShippingCents: 0, unitShippingWeightGrams: 120, lineShippingWeightGrams: 120, currency: "EUR" }] },
  } });
  await prisma.stockReservation.create({ data: {
    shopOrderId: order.id, productId: product.id, quantity: 1, status: "CONFIRMED", expiresAt: order.reservationExpiresAt,
    confirmedAt: now, createdAt: now,
  } });
  const payment = await prisma.payment.create({ data: {
    shopOrderId: order.id, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 3_300, currency: "EUR",
    pricingVersion: "shop-order-snapshot-v1", idempotencyKey: `phase5c-preview-payment:${order.id}`,
    providerCheckoutId: `cs_test_phase5c_preview_${order.id}`, providerPaymentId: `pi_phase5c_preview_${order.id}`,
    paymentMethod: "CARD", paidAt: now, createdAt: now,
  } });
  await prisma.invoice.create({ data: {
    invoiceNumber: "LNX-20260830-5003", sequenceNumber: 5003n, issuedAt: now, documentType: "SHOP", operationCategory: "GOODS",
    shopOrderId: order.id, paymentId: payment.id, orderNumberSnapshot: order.orderNumber, customerType: "INDIVIDUAL",
    customerNameSearch: "Membre Expédition Phase 5C", customerEmailSearch: MEMBER_EMAIL,
    sellerSnapshot: { name: "LNX Beats QA" }, customerSnapshot: { email: MEMBER_EMAIL },
    lineItemsSnapshot: [{ title: product.title, unitPriceCents: 2_500, quantity: 1 }], currency: "EUR",
    subtotalCents: 2_500, shippingCents: 800, totalCents: 3_300, vatRegime: "FRANCHISE_EN_BASE_TVA",
    vatAmountCents: 0, vatLegalNotice: "TVA non applicable — QA", paymentMethodLabel: "Carte test", paidAt: now,
    termsVersion: "shop-cgv-phase4c-candidate-v1", termsHashSha256: "8".repeat(64), snapshotHashSha256: "9".repeat(64), createdAt: now,
  } });
  const visualOrder = await prisma.shopOrder.create({ data: {
    orderNumber: VISUAL_ORDER_NUMBER, userId: member.id, creationToken: randomUUID(), requestFingerprintSha256: "a".repeat(64),
    status: "OPEN", paymentStatus: "PAID", fulfillmentStatus: "PENDING", currency: "EUR",
    subtotalCents: 2_500, shippingCents: 800, totalCents: 3_300, shippingRequired: true,
    shippingFirstName: "Membre", shippingLastName: "Expédition Visuelle QA", shippingAddressLine1: "8 rue du Test local",
    shippingPostalCode: "75008", shippingCity: "Paris", shippingCountryCode: "FR",
    shippingRateVersionId: rate.id,
    shippingQuoteVersion: "phase5a-qa-internal-v1", shippingMethod: "STANDARD_TRACKED_SIGNATURE",
    shippingWeightGrams: 120, shippingPackagingGrams: 150, shippingBillableGrams: 270,
    termsVersion: "shop-cgv-phase4c-candidate-v1", termsHashSha256: "b".repeat(64), termsAcceptedAt: now,
    reservationExpiresAt: new Date(now.getTime() + 30 * 60_000), paidAt: now, createdAt: now,
    items: { create: [{ productId: product.id, position: 0, productTitle: product.title, inventoryTracked: true,
      unitPriceCents: 2_500, quantity: 1, lineTotalCents: 2_500, shippingRequired: true, unitShippingCents: 0,
      lineShippingCents: 0, unitShippingWeightGrams: 120, lineShippingWeightGrams: 120, currency: "EUR" }] },
  } });
  await prisma.stockReservation.create({ data: {
    shopOrderId: visualOrder.id, productId: product.id, quantity: 1, status: "CONFIRMED", expiresAt: visualOrder.reservationExpiresAt,
    confirmedAt: now, createdAt: now,
  } });
  const visualPayment = await prisma.payment.create({ data: {
    shopOrderId: visualOrder.id, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 3_300, currency: "EUR",
    pricingVersion: "shop-order-snapshot-v1", idempotencyKey: `phase5c-preview-payment:${visualOrder.id}`,
    providerCheckoutId: `cs_test_phase5c_visual_${visualOrder.id}`, providerPaymentId: `pi_phase5c_visual_${visualOrder.id}`,
    paymentMethod: "CARD", paidAt: now, createdAt: now,
  } });
  await prisma.invoice.create({ data: {
    invoiceNumber: "LNX-20260830-5004", sequenceNumber: 5004n, issuedAt: now, documentType: "SHOP", operationCategory: "GOODS",
    shopOrderId: visualOrder.id, paymentId: visualPayment.id, orderNumberSnapshot: visualOrder.orderNumber, customerType: "INDIVIDUAL",
    customerNameSearch: "Membre Expédition Visuelle Phase 5C", customerEmailSearch: MEMBER_EMAIL,
    sellerSnapshot: { name: "LNX Beats QA" }, customerSnapshot: { email: MEMBER_EMAIL },
    lineItemsSnapshot: [{ title: product.title, unitPriceCents: 2_500, quantity: 1 }], currency: "EUR",
    subtotalCents: 2_500, shippingCents: 800, totalCents: 3_300, vatRegime: "FRANCHISE_EN_BASE_TVA",
    vatAmountCents: 0, vatLegalNotice: "TVA non applicable — QA", paymentMethodLabel: "Carte test", paidAt: now,
    termsVersion: "shop-cgv-phase4c-candidate-v1", termsHashSha256: "b".repeat(64), snapshotHashSha256: "c".repeat(64), createdAt: now,
  } });
  console.info(JSON.stringify({
    event: "shop.shipping-operations.preview.ready", outcome: "passed", memberEmail: MEMBER_EMAIL, adminEmail: ADMIN_EMAIL,
    orderNumber: ORDER_NUMBER, totalCents: 3_300, productTitle: product.title, stock: product.stock,
    paymentStatus: "PAID", fulfillmentStatus: "PENDING", tracking: null, visualOrderNumber: VISUAL_ORDER_NUMBER,
  }));
}

run().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "shop.shipping-operations.preview.failed", outcome: "failed" }));
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
