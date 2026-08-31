import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { prisma } from "@/lib/prisma";
import {
  assertShopShippingProviderQaEnabled,
  SHOP_SHIPPING_PROVIDER_QA_TARGET,
} from "@/lib/shop/shipping-provider-config";

const MEMBER_EMAIL = "lnx-v110-phase5d-member@example.invalid";
const ADMIN_EMAIL = "lnx-v110-phase5d-admin@example.invalid";
const ORDER_SCENARIOS = [
  { orderNumber: "LNX-SHOP-2026-510001", scenario: "SUCCEEDED", sequence: 5101n },
  { orderNumber: "LNX-SHOP-2026-510002", scenario: "PENDING", sequence: 5102n },
  { orderNumber: "LNX-SHOP-2026-510003", scenario: "FAILED", sequence: 5103n },
  { orderNumber: "LNX-SHOP-2026-510004", scenario: "AMBIGUOUS", sequence: 5104n },
] as const;

async function guard() {
  assertShopShippingProviderQaEnabled();
  assert.equal(process.env.LNX_DATABASE_TARGET, SHOP_SHIPPING_PROVIDER_QA_TARGET);
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  assert.ok(proofPath);
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as { name?: string; pid?: number };
  assert.equal(proof.name, SHOP_SHIPPING_PROVIDER_QA_TARGET);
  process.kill(Number(proof.pid), 0);
}

async function run() {
  await guard();
  const memberPassword = process.env.LNX_AUTH_QA_MEMBER_PASSWORD;
  const adminPassword = process.env.LNX_AUTH_QA_ADMIN_PASSWORD;
  assert.ok(memberPassword && memberPassword.length >= 12 && memberPassword.length <= 128);
  assert.ok(adminPassword && adminPassword.length >= 12 && adminPassword.length <= 128);
  assert.notEqual(memberPassword, adminPassword);
  assert.equal(await prisma.user.count({ where: { email: { in: [MEMBER_EMAIL, ADMIN_EMAIL] } } }), 0);
  assert.equal(await prisma.shopOrder.count({ where: { orderNumber: { in: ORDER_SCENARIOS.map(({ orderNumber }) => orderNumber) } } }), 0);

  const now = new Date();
  const paidAt = new Date(now.getTime() - 5 * 60_000);
  const preparingAt = new Date(now.getTime() - 4 * 60_000);
  const readyToShipAt = new Date(now.getTime() - 3 * 60_000);
  const [member, admin] = await Promise.all([
    createInternalAuthUser({ email: MEMBER_EMAIL, password: memberPassword, displayName: "Membre fictif Provider Phase 5D", role: "MEMBER" }),
    createInternalAuthUser({ email: ADMIN_EMAIL, password: adminPassword, displayName: "Admin fictif Provider Phase 5D", role: "ADMIN" }),
  ]);
  const product = await prisma.product.create({ data: {
    slug: "lnx-v110-phase5d-provider-qa", title: "CD QA — Expédition locale", description: "Produit fictif local Phase 5D.",
    status: "PUBLISHED", priceCents: 2_500, currency: "EUR", trackInventory: true, stock: 16,
    shippingRequired: true, shippingPriceCents: 800, shippingWeightGrams: 120, publishedAt: now,
    createdByAdminId: admin.id, updatedByAdminId: admin.id, createdAt: now,
  } });
  const rate = await prisma.shippingRateVersion.create({ data: {
    version: "phase5d-preview-snapshot-v1", status: "ACTIVE", scope: "INTERNAL_QA",
    service: "STANDARD_TRACKED_SIGNATURE", currency: "EUR", countryCode: "FR",
    minimumBillableWeightGrams: 150, packagingWeightGrams: 150, activatedAt: now, createdAt: now,
    tiers: { create: [{ position: 0, maxWeightGrams: 500, priceCents: 800, createdAt: now }] },
  } });

  for (const [position, definition] of ORDER_SCENARIOS.entries()) {
    const order = await prisma.shopOrder.create({ data: {
      orderNumber: definition.orderNumber, userId: member.id, creationToken: randomUUID(), requestFingerprintSha256: `${position + 1}`.repeat(64),
      status: "OPEN", paymentStatus: "PAID", fulfillmentStatus: "READY_TO_SHIP", currency: "EUR",
      subtotalCents: 2_500, shippingCents: 800, totalCents: 3_300, shippingRequired: true,
      shippingFirstName: "Membre", shippingLastName: `Test QA ${position + 1}`, shippingAddressLine1: `${position + 1} rue du Test local`,
      shippingPostalCode: `7500${position + 1}`, shippingCity: "Paris", shippingCountryCode: "FR",
      shippingRateVersionId: rate.id, shippingQuoteVersion: "phase5d-preview-snapshot-v1",
      shippingMethod: "STANDARD_TRACKED_SIGNATURE", shippingWeightGrams: 120, shippingPackagingGrams: 150, shippingBillableGrams: 270,
      termsVersion: "shop-cgv-phase4c-candidate-v1", termsHashSha256: `${position + 5}`.repeat(64), termsAcceptedAt: paidAt,
      reservationExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000), paidAt, preparingAt, readyToShipAt, createdAt: paidAt,
      items: { create: [{ productId: product.id, position: 0, productTitle: product.title, inventoryTracked: true,
        unitPriceCents: 2_500, quantity: 1, lineTotalCents: 2_500, shippingRequired: true, unitShippingCents: 0,
        lineShippingCents: 0, unitShippingWeightGrams: 120, lineShippingWeightGrams: 120, currency: "EUR" }] },
    } });
    await prisma.stockReservation.create({ data: {
      shopOrderId: order.id, productId: product.id, quantity: 1, status: "CONFIRMED", expiresAt: order.reservationExpiresAt,
      confirmedAt: paidAt, createdAt: paidAt,
    } });
    const payment = await prisma.payment.create({ data: {
      shopOrderId: order.id, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 3_300, currency: "EUR",
      pricingVersion: "shop-order-snapshot-v1", idempotencyKey: `phase5d-preview-payment:${order.id}`,
      providerCheckoutId: `cs_test_phase5d_${position + 1}_${order.id}`, providerPaymentId: `pi_phase5d_${position + 1}_${order.id}`,
      paymentMethod: "CARD", paidAt, createdAt: paidAt,
    } });
    await prisma.invoice.create({ data: {
      invoiceNumber: `LNX-20260831-${definition.sequence}`, sequenceNumber: definition.sequence, issuedAt: paidAt,
      documentType: "SHOP", operationCategory: "GOODS", shopOrderId: order.id, paymentId: payment.id,
      orderNumberSnapshot: order.orderNumber, customerType: "INDIVIDUAL", customerNameSearch: "Membre Provider Phase 5D",
      customerEmailSearch: MEMBER_EMAIL, sellerSnapshot: { name: "LNX Beats QA" }, customerSnapshot: { email: MEMBER_EMAIL },
      lineItemsSnapshot: [{ title: product.title, unitPriceCents: 2_500, quantity: 1 }], currency: "EUR",
      subtotalCents: 2_500, shippingCents: 800, totalCents: 3_300, vatRegime: "FRANCHISE_EN_BASE_TVA",
      vatAmountCents: 0, vatLegalNotice: "TVA non applicable — QA", paymentMethodLabel: "Carte test", paidAt,
      termsVersion: "shop-cgv-phase4c-candidate-v1", termsHashSha256: `${position + 5}`.repeat(64),
      snapshotHashSha256: `${position + 1}`.repeat(64), createdAt: paidAt,
    } });
    await prisma.shopOrderLifecycleEvent.createMany({ data: [
      { shopOrderId: order.id, actorUserId: admin.id, type: "PREPARATION_STARTED", idempotencyKey: `phase5d:${order.id}:preparing`, metadata: { fixture: true }, occurredAt: preparingAt },
      { shopOrderId: order.id, actorUserId: admin.id, type: "SHIPMENT_READY", idempotencyKey: `phase5d:${order.id}:ready`, metadata: { fixture: true }, occurredAt: readyToShipAt },
    ] });
  }
  console.info(JSON.stringify({
    event: "shop.shipping-provider.preview.ready",
    outcome: "passed",
    memberEmail: MEMBER_EMAIL,
    adminEmail: ADMIN_EMAIL,
    orders: ORDER_SCENARIOS.map(({ orderNumber, scenario }) => ({ orderNumber, scenario, totalCents: 3_300, fulfillmentStatus: "READY_TO_SHIP" })),
  }));
}

run().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "shop.shipping-provider.preview.failed", outcome: "failed" }));
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
