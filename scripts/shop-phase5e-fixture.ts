import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import sharp from "sharp";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { prisma } from "@/lib/prisma";
import { createMemberShopReturn } from "@/lib/shop/after-sales-service";
import { SHOP_LEGAL_QA_TERMS_HASH } from "@/lib/shop/legal";
import { createShopCustomerRequest } from "@/lib/shop/customer-request-service";
import { adminProductEditorPayload } from "@/lib/shop/product-admin-form";
import { replaceAdminProductImage } from "@/lib/shop/product-image";
import { createAdminProduct, publishAdminProduct } from "@/lib/shop/product-service";
import { assertShopProductionReadinessQaEnabled, SHOP_PHASE5E_PREVIEW_TARGET } from "@/lib/shop/production-readiness-config";
import { ensurePhase5ECommercialCandidate } from "@/lib/shop/shipping-service";
import { SHOP_PHASE5E_QA_ORDER_SNAPSHOT_VERSION, SHOP_PHASE5E_QA_TERMS_VERSION } from "@/lib/shop/qa-contract";

const MEMBER_EMAIL = "lnx-v110-phase5e-member@example.invalid";
const ADMIN_EMAIL = "lnx-v110-phase5e-admin@example.invalid";
const PRODUCT_DEFINITIONS = [
  { key: "cd", slug: "lnx-v110-phase5e-cd-qa", title: "CD QA — Readiness France", price: "25,00", stock: "40", weight: "25", position: "51", description: "CD fictif local de 25 g pour valider les paliers Colissimo candidats.", alt: "Pochette fictive du CD QA Phase 5E", background: { r: 111, g: 75, b: 31 } },
  { key: "badge", slug: "lnx-v110-phase5e-badge-qa", title: "Badge QA — poids fictif", price: "5,00", stock: "1", weight: "15", position: "52", description: "Badge strictement fictif ; son poids de 15 g ne constitue aucune donnée commerciale.", alt: "Visuel fictif du badge QA Phase 5E", background: { r: 35, g: 35, b: 39 } },
  { key: "goodie", slug: "lnx-v110-phase5e-goodie-qa", title: "Goodie QA — poids fictif", price: "10,00", stock: "12", weight: "100", position: "53", description: "Goodie strictement fictif ; son poids de 100 g ne constitue aucune donnée commerciale.", alt: "Visuel fictif du goodie QA Phase 5E", background: { r: 82, g: 57, b: 28 } },
] as const;

async function guard() {
  const identity = assertShopProductionReadinessQaEnabled();
  assert.equal(identity.target, SHOP_PHASE5E_PREVIEW_TARGET);
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  assert.ok(proofPath);
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as { name?: string; pid?: number };
  assert.equal(proof.name, SHOP_PHASE5E_PREVIEW_TARGET);
  process.kill(Number(proof.pid), 0);
}

function productPayload(definition: typeof PRODUCT_DEFINITIONS[number]) {
  return adminProductEditorPayload({
    slug: definition.slug, title: definition.title, description: definition.description,
    price: definition.price, currency: "EUR", trackInventory: "on", stock: definition.stock,
    shippingRequired: "on", shippingPrice: "0,00", shippingWeightGrams: definition.weight, position: definition.position,
  });
}

async function createProduct(definition: typeof PRODUCT_DEFINITIONS[number], adminId: string) {
  const existing = await prisma.product.findUnique({ where: { slug: definition.slug }, include: { assets: true } });
  if (existing) {
    assert.equal(existing.title, definition.title);
    assert.equal(existing.status, "PUBLISHED");
    assert.equal(existing.priceCents, Math.round(Number(definition.price.replace(",", ".")) * 100));
    assert.equal(existing.stock, Number(definition.stock));
    assert.equal(existing.shippingWeightGrams, Number(definition.weight));
    assert.equal(existing.assets.length, 1);
    return existing;
  }
  const created = await createAdminProduct(productPayload(definition), adminId);
  const bytes = await sharp({ create: { width: 900, height: 900, channels: 3, background: definition.background } }).png().toBuffer();
  await replaceAdminProductImage({
    productId: created.id, expectedLockVersion: created.lockVersion, expectedAssetId: null,
    file: new File([bytes], `${definition.slug}.png`, { type: "image/png" }), alt: definition.alt,
    rightsConfirmed: true, actorAdminId: adminId,
  });
  const current = await prisma.product.findUniqueOrThrow({ where: { id: created.id }, select: { lockVersion: true } });
  return publishAdminProduct(created.id, current.lockVersion, adminId);
}

type FixtureProduct = Awaited<ReturnType<typeof createProduct>>;

async function ensureFixtureUser(input: Readonly<{
  email: string;
  password: string;
  displayName: string;
  role: "MEMBER" | "ADMIN";
}>) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (!existing) return createInternalAuthUser(input);
  assert.equal(existing.displayName, input.displayName);
  assert.equal(existing.role, input.role);
  assert.equal(existing.status, "ACTIVE");
  assert.equal(existing.emailVerified, true);
  assert.equal(await prisma.account.count({ where: { userId: existing.id, providerId: "credential" } }), 1);
  return existing;
}

async function createOrder(input: Readonly<{
  orderNumber: string;
  memberId: string;
  product: FixtureProduct;
  quantity: number;
  paid: boolean;
  activeReservation?: boolean;
  rateId: string;
  packagingId: string;
  sequence: bigint;
}>) {
  const now = new Date();
  const productWeight = (input.product.shippingWeightGrams ?? 0) * input.quantity;
  const shippingCents = productWeight <= 250 ? 549 : 759;
  const subtotalCents = (input.product.priceCents ?? 0) * input.quantity;
  const totalCents = subtotalCents + shippingCents;
  let order = await prisma.shopOrder.findUnique({ where: { orderNumber: input.orderNumber }, include: { items: true } });
  if (!order) order = await prisma.shopOrder.create({ data: {
    orderNumber: input.orderNumber, userId: input.memberId, creationToken: randomUUID(), requestFingerprintSha256: input.sequence.toString().padStart(64, "0"),
    status: "OPEN", paymentStatus: input.paid ? "PAID" : "AWAITING_PAYMENT", fulfillmentStatus: "PENDING", currency: "EUR",
    subtotalCents, shippingCents, totalCents, shippingRequired: true,
    shippingFirstName: "Membre", shippingLastName: "Phase 5E", shippingAddressLine1: "5 rue du Test local", shippingPostalCode: "75005", shippingCity: "Paris", shippingCountryCode: "FR",
    shippingRateVersionId: input.rateId, shippingQuoteVersion: "colissimo-domicile-france-2026-v1", shippingMethod: "COLISSIMO_HOME_FRANCE",
    shippingWeightGrams: productWeight, shippingPackagingGrams: 60, shippingPhysicalGrams: productWeight + 60, shippingBillableGrams: productWeight,
    shippingTierMaxGrams: productWeight <= 250 ? 250 : 500, packagingProfileId: input.packagingId, packagingProfileVersion: "carton-cd-60g-v1", shippingWeightPolicy: "PRODUCTS_ONLY",
    termsVersion: SHOP_PHASE5E_QA_TERMS_VERSION, termsHashSha256: SHOP_LEGAL_QA_TERMS_HASH, termsAcceptedAt: now,
    reservationExpiresAt: new Date(now.getTime() + 30 * 60_000), paidAt: input.paid ? now : null,
    createdAt: now, updatedAt: now,
    items: { create: [{ productId: input.product.id, position: 0, productTitle: input.product.title, inventoryTracked: true,
      unitPriceCents: input.product.priceCents!, quantity: input.quantity, lineTotalCents: subtotalCents, shippingRequired: true,
      unitShippingCents: 0, lineShippingCents: 0, unitShippingWeightGrams: input.product.shippingWeightGrams, lineShippingWeightGrams: productWeight, currency: "EUR" }] },
  }, include: { items: true } });
  assert.equal(order.userId, input.memberId);
  assert.equal(order.totalCents, totalCents);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0]?.productId, input.product.id);
  assert.equal(order.items[0]?.quantity, input.quantity);
  let reservation = await prisma.stockReservation.findUnique({ where: { shopOrderId_productId: { shopOrderId: order.id, productId: input.product.id } } });
  if (!reservation) reservation = await prisma.stockReservation.create({ data: {
    shopOrderId: order.id, productId: input.product.id, quantity: input.quantity,
    status: input.paid ? "CONFIRMED" : "ACTIVE", expiresAt: order.reservationExpiresAt, confirmedAt: input.paid ? order.createdAt : null,
    createdAt: order.createdAt, updatedAt: order.createdAt,
  } });
  assert.equal(reservation.quantity, input.quantity);
  assert.equal(reservation.status, input.paid ? "CONFIRMED" : "ACTIVE");
  if (input.paid) {
    let payment = await prisma.payment.findUnique({ where: { idempotencyKey: `phase5e-fixture:${order.id}:payment` } });
    if (!payment) payment = await prisma.payment.create({ data: {
      shopOrderId: order.id, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: totalCents, currency: "EUR",
      pricingVersion: SHOP_PHASE5E_QA_ORDER_SNAPSHOT_VERSION, idempotencyKey: `phase5e-fixture:${order.id}:payment`,
      providerCheckoutId: `cs_test_phase5e_${input.sequence}`, providerPaymentId: `pi_phase5e_${input.sequence}`, paymentMethod: "CARD", paidAt: now,
    } });
    assert.equal(payment.status, "SUCCEEDED");
    const invoice = await prisma.invoice.findFirst({ where: { shopOrderId: order.id } });
    if (!invoice) await prisma.invoice.create({ data: {
      invoiceNumber: `LNX-20260831-${input.sequence}`, sequenceNumber: input.sequence, issuedAt: now, documentType: "SHOP", operationCategory: "GOODS",
      shopOrderId: order.id, paymentId: payment.id, orderNumberSnapshot: order.orderNumber, customerType: "INDIVIDUAL",
      customerNameSearch: "Membre Phase 5E", customerEmailSearch: MEMBER_EMAIL, sellerSnapshot: { name: "LNX Beats QA" }, customerSnapshot: { email: MEMBER_EMAIL },
      lineItemsSnapshot: [{ title: input.product.title, unitPriceCents: input.product.priceCents, quantity: input.quantity }], currency: "EUR",
      subtotalCents, shippingCents, totalCents, vatRegime: "FRANCHISE_EN_BASE_TVA", vatAmountCents: 0, vatLegalNotice: "TVA non applicable — QA",
      paymentMethodLabel: "Carte test", paidAt: now, termsVersion: SHOP_PHASE5E_QA_TERMS_VERSION, termsHashSha256: SHOP_LEGAL_QA_TERMS_HASH, snapshotHashSha256: input.sequence.toString().padStart(64, "f"),
    } });
  }
  return order;
}

async function run() {
  await guard();
  const memberPassword = process.env.LNX_AUTH_QA_MEMBER_PASSWORD;
  const adminPassword = process.env.LNX_AUTH_QA_ADMIN_PASSWORD;
  assert.ok(memberPassword && memberPassword.length >= 12 && memberPassword.length <= 128);
  assert.ok(adminPassword && adminPassword.length >= 12 && adminPassword.length <= 128);
  assert.notEqual(memberPassword, adminPassword);
  const [member, admin] = await Promise.all([
    ensureFixtureUser({ email: MEMBER_EMAIL, password: memberPassword, displayName: "Membre fictif Readiness Phase 5E", role: "MEMBER" }),
    ensureFixtureUser({ email: ADMIN_EMAIL, password: adminPassword, displayName: "Admin fictif Readiness Phase 5E", role: "ADMIN" }),
  ]);
  const products: FixtureProduct[] = [];
  for (const definition of PRODUCT_DEFINITIONS) products.push(await createProduct(definition, admin.id));
  const [cd, badge] = products;
  const rate = await ensurePhase5ECommercialCandidate();
  assert.equal(rate.status, "DRAFT");
  assert.ok(rate.packagingProfile);

  const cancellable = await createOrder({ orderNumber: "LNX-SHOP-2026-550001", memberId: member.id, product: cd!, quantity: 1, paid: true, rateId: rate.id, packagingId: rate.packagingProfile.id, sequence: 550001n });
  const savOrder = await createOrder({ orderNumber: "LNX-SHOP-2026-550002", memberId: member.id, product: cd!, quantity: 1, paid: true, rateId: rate.id, packagingId: rate.packagingProfile.id, sequence: 550002n });
  const addressOrder = await createOrder({ orderNumber: "LNX-SHOP-2026-550003", memberId: member.id, product: cd!, quantity: 1, paid: true, rateId: rate.id, packagingId: rate.packagingProfile.id, sequence: 550003n });
  const reservedOrder = await createOrder({ orderNumber: "LNX-SHOP-2026-550004", memberId: member.id, product: badge!, quantity: 1, paid: false, activeReservation: true, rateId: rate.id, packagingId: rate.packagingProfile.id, sequence: 550004n });
  const actor = { id: member.id, role: "MEMBER" as const, status: "ACTIVE", emailVerified: true };
  const sav = await createMemberShopReturn(actor, { orderNumber: savOrder.orderNumber, type: "DEFECTIVE", comment: "Le CD présente un défaut fictif à documenter pendant la QA locale.", quantities: new Map([[cd!.id, 1]]) });
  const cancellation = await createShopCustomerRequest(actor, { orderNumber: cancellable.orderNumber, type: "PAID_ORDER_CANCELLATION", reason: "Demande d’annulation fictive avant expédition.", address: null });
  const address = await createShopCustomerRequest(actor, { orderNumber: addressOrder.orderNumber, type: "SHIPPING_ADDRESS_CORRECTION", reason: "Correction fictive avant expédition.", address: { firstName: "Jean", lastName: "Test", addressLine1: "6 rue du Test local", addressLine2: null, postalCode: "75006", city: "Paris", countryCode: "FR" } });

  console.info(JSON.stringify({
    event: "shop.phase5e.preview.ready", outcome: "passed", memberEmail: MEMBER_EMAIL, adminEmail: ADMIN_EMAIL,
    candidateRate: rate.version, candidateStatus: rate.status, products: products.map(({ slug }) => slug),
    shopOrders: [cancellable.orderNumber, savOrder.orderNumber, addressOrder.orderNumber, reservedOrder.orderNumber],
    savRequest: sav.requestNumber, cancellationRequest: cancellation.requestNumber, addressRequest: address.requestNumber,
  }));
}

run().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "shop.phase5e.preview.failed", outcome: "failed" }));
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
