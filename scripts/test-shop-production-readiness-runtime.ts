import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { prisma } from "@/lib/prisma";
import { addShopReturnEvidence, getAuthorizedShopReturnEvidence } from "@/lib/shop/evidence-service";
import { SHOP_LEGAL_QA_TERMS_HASH } from "@/lib/shop/legal";
import {
  createFakeShopRefundGateway,
  createMemberShopReturn,
  decideShopReturn,
  reconcileShopReturnRefund,
  requestShopReturnRefund,
  startShopReturnReview,
  type ShopRefundGateway,
} from "@/lib/shop/after-sales-service";
import { ShopCustomerRequestError } from "@/lib/shop/customer-request-domain";
import {
  createShopCustomerRequest,
  decideShopCustomerRequest,
  reconcileShopCustomerRequestRefund,
} from "@/lib/shop/customer-request-service";
import {
  assertShopProductionReadinessQaEnabled,
  SHOP_PHASE5E_RUNTIME_TARGET,
} from "@/lib/shop/production-readiness-config";
import { runShopReadinessMaintenance } from "@/lib/shop/readiness-scheduler";
import { SHOP_PHASE5E_QA_ORDER_SNAPSHOT_VERSION, SHOP_PHASE5E_QA_TERMS_VERSION } from "@/lib/shop/qa-contract";
import { quoteShipping } from "@/lib/shop/shipping-domain";
import {
  activatePhase5ECommercialRate,
  ensurePhase5ECommercialCandidate,
  SHOP_COMMERCIAL_RATE_ACTIVATION_CONFIRMATION,
} from "@/lib/shop/shipping-service";

type Actor = Readonly<{ id: string; role: "MEMBER" | "ADMIN"; status: "ACTIVE"; emailVerified: true }>;
type RuntimeActors = Readonly<{ member: Actor & { role: "MEMBER" }; other: Actor & { role: "MEMBER" }; admin: Actor & { role: "ADMIN" } }>;
type ProductFixture = Readonly<{ id: string; title: string; priceCents: number; stock: number; shippingWeightGrams: number }>;
type OrderFixture = Readonly<{ id: string; orderNumber: string; paymentId: string | null; invoiceId: string | null }>;

const ROOT = "/private/tmp/lnxbeats-v110-phase5e-runtime-evidence";
const NOW = new Date("2026-08-31T12:00:00.000Z");
const noGuard = () => undefined;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function installCreditNoteFailureTrigger() {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION lnx_test_reject_credit_note() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'LNX_TEST_CREDIT_NOTE_FAILURE';
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS lnx_test_reject_credit_note ON credit_notes`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER lnx_test_reject_credit_note
    BEFORE INSERT ON credit_notes
    FOR EACH ROW EXECUTE FUNCTION lnx_test_reject_credit_note()
  `);
}

async function removeCreditNoteFailureTrigger() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS lnx_test_reject_credit_note ON credit_notes`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS lnx_test_reject_credit_note()`);
}

function isolatedClient() {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

async function guard() {
  const identity = assertShopProductionReadinessQaEnabled();
  assert.equal(identity.target, SHOP_PHASE5E_RUNTIME_TARGET);
  assert.equal(process.env.NODE_ENV, "test");
  assert.ok(!process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_ENVIRONMENT_NAME);
  const database = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "");
  assert.equal(database.hostname, "127.0.0.1");
  assert.notEqual(database.port, "5432");
  assert.equal(decodeURIComponent(database.pathname), "/template1");
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  assert.ok(proofPath);
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as { name?: string; pid?: number; exports?: { database?: { connectionString?: string } } };
  assert.equal(proof.name, SHOP_PHASE5E_RUNTIME_TARGET);
  const proofUrl = assertSafeLocalPostgresUrl(proof.exports?.database?.connectionString ?? "");
  assert.equal(proofUrl.port, database.port);
  process.kill(Number(proof.pid), 0);
  const dbIdentity = await prisma.$queryRaw<Array<{ database: string; schema: string }>>`SELECT current_database() AS database, current_schema() AS schema`;
  assert.deepEqual(dbIdentity[0], { database: "template1", schema: "public" });

  const root = path.join(process.cwd(), "prisma", "migrations");
  const expected = await Promise.all((await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    .map(async (name) => ({ name, checksum: sha256(await readFile(path.join(root, name, "migration.sql"), "utf8")) })));
  const applied = await prisma.$queryRaw<Array<{ name: string; checksum: string; finishedAt: Date | null; rolledBackAt: Date | null }>>`
    SELECT "migration_name" AS name, checksum, "finished_at" AS "finishedAt", "rolled_back_at" AS "rolledBackAt"
    FROM "_prisma_migrations" ORDER BY "migration_name", "started_at"
  `;
  assert.deepEqual(applied.map(({ name, checksum }) => ({ name, checksum })), expected);
  assert.ok(applied.every(({ finishedAt, rolledBackAt }) => finishedAt && !rolledBackAt));
  return expected.length;
}

async function createActors(): Promise<RuntimeActors> {
  const data = [
    { email: "lnx-v110-phase5e-runtime-member@example.invalid", displayName: "Membre Phase 5E", role: "MEMBER" as const },
    { email: "lnx-v110-phase5e-runtime-other@example.invalid", displayName: "Autre membre Phase 5E", role: "MEMBER" as const },
    { email: "lnx-v110-phase5e-runtime-admin@example.invalid", displayName: "Admin Phase 5E", role: "ADMIN" as const },
  ];
  const member = await prisma.user.create({ data: { ...data[0]!, status: "ACTIVE", emailVerified: true, emailVerifiedAt: NOW } });
  const other = await prisma.user.create({ data: { ...data[1]!, status: "ACTIVE", emailVerified: true, emailVerifiedAt: NOW } });
  const admin = await prisma.user.create({ data: { ...data[2]!, status: "ACTIVE", emailVerified: true, emailVerifiedAt: NOW } });
  return {
    member: { id: member.id, role: "MEMBER", status: "ACTIVE", emailVerified: true },
    other: { id: other.id, role: "MEMBER", status: "ACTIVE", emailVerified: true },
    admin: { id: admin.id, role: "ADMIN", status: "ACTIVE", emailVerified: true },
  };
}

async function createProduct(adminId: string, suffix: string, input: Readonly<{ priceCents: number; stock: number; weight: number }>): Promise<ProductFixture> {
  const product = await prisma.product.create({ data: {
    slug: `lnx-v110-phase5e-runtime-${suffix}`, title: `Produit fictif Phase 5E ${suffix}`, description: "Fixture PostgreSQL locale jetable.",
    status: "PUBLISHED", priceCents: input.priceCents, currency: "EUR", trackInventory: true, stock: input.stock,
    shippingRequired: true, shippingPriceCents: 0, shippingWeightGrams: input.weight, publishedAt: NOW,
    createdByAdminId: adminId, updatedByAdminId: adminId,
  } });
  return { id: product.id, title: product.title, priceCents: input.priceCents, stock: input.stock, shippingWeightGrams: input.weight };
}

async function createOrder(
  actors: RuntimeActors,
  products: readonly Readonly<{ product: ProductFixture; quantity: number }>[],
  sequence: number,
  input: Readonly<{
    paid: boolean;
    fulfillment?: "PENDING" | "SHIPPED";
    expiresAt?: Date;
    paymentStatus?: "SUCCEEDED" | "PENDING";
    provider?: "STRIPE" | "PAYPAL";
    issueInvoice?: boolean;
  }>,
): Promise<OrderFixture> {
  const rate = await prisma.shippingRateVersion.findFirstOrThrow({ where: { status: "ACTIVE", scope: "COMMERCIAL_CANDIDATE" }, include: { tiers: { orderBy: { position: "asc" } }, packagingProfile: true } });
  const quote = quoteShipping({ rate, destinationCountryCode: "FR", lines: products.map(({ product, quantity }) => ({ productId: product.id, shippingRequired: true, shippingWeightGrams: product.shippingWeightGrams, quantity })) });
  const subtotalCents = products.reduce((sum, { product, quantity }) => sum + product.priceCents * quantity, 0);
  const totalCents = subtotalCents + quote.amountCents;
  const orderNumber = `LNX-SHOP-2026-${sequence.toString().padStart(6, "0")}`;
  const expiresAt = input.expiresAt ?? new Date(NOW.getTime() + 30 * 60_000);
  const createdAt = new Date(Math.min(NOW.getTime(), expiresAt.getTime() - 30 * 60_000));
  const fulfillment = input.fulfillment ?? "PENDING";
  const order = await prisma.shopOrder.create({ data: {
    orderNumber, userId: actors.member.id, creationToken: randomUUID(), requestFingerprintSha256: sha256(`phase5e:${sequence}`),
    status: "OPEN", paymentStatus: input.paid ? "PAID" : "AWAITING_PAYMENT", fulfillmentStatus: fulfillment,
    currency: "EUR", subtotalCents, shippingCents: quote.amountCents, totalCents, shippingRequired: true,
    shippingFirstName: "Membre", shippingLastName: "Phase 5E", shippingAddressLine1: "5 rue du Test local", shippingPostalCode: "75005", shippingCity: "Paris", shippingCountryCode: "FR",
    shippingRateVersionId: quote.rateVersionId, shippingQuoteVersion: quote.version, shippingMethod: quote.service,
    shippingWeightGrams: quote.productWeightGrams, shippingPackagingGrams: quote.packagingWeightGrams,
    shippingPhysicalGrams: quote.physicalWeightGrams,
    shippingBillableGrams: quote.billableWeightPolicy === "PRODUCTS_ONLY" ? quote.productWeightGrams : quote.billableWeightGrams,
    shippingTierMaxGrams: quote.tierMaximumWeightGrams, packagingProfileId: quote.packagingProfileId,
    packagingProfileVersion: quote.packagingProfileVersion, shippingWeightPolicy: quote.billableWeightPolicy,
    termsVersion: SHOP_PHASE5E_QA_TERMS_VERSION, termsHashSha256: SHOP_LEGAL_QA_TERMS_HASH, termsAcceptedAt: createdAt,
    reservationExpiresAt: expiresAt, paidAt: input.paid ? NOW : null, preparingAt: fulfillment === "SHIPPED" ? NOW : null, shippedAt: fulfillment === "SHIPPED" ? NOW : null,
    createdAt, updatedAt: createdAt,
    items: { create: products.map(({ product, quantity }, position) => ({
      productId: product.id, position, productTitle: product.title, inventoryTracked: true, unitPriceCents: product.priceCents,
      quantity, lineTotalCents: product.priceCents * quantity, shippingRequired: true, unitShippingCents: 0, lineShippingCents: 0,
      unitShippingWeightGrams: product.shippingWeightGrams, lineShippingWeightGrams: product.shippingWeightGrams * quantity, currency: "EUR",
    })) },
  } });
  for (const { product, quantity } of products) {
    await prisma.stockReservation.create({ data: {
      shopOrderId: order.id, productId: product.id, quantity, status: input.paid ? "CONFIRMED" : "ACTIVE",
      expiresAt, confirmedAt: input.paid ? NOW : null, createdAt, updatedAt: createdAt,
    } });
  }
  if (!input.paid && input.paymentStatus !== "PENDING") return { id: order.id, orderNumber, paymentId: null, invoiceId: null };
  const provider = input.provider ?? "STRIPE";
  const payment = await prisma.payment.create({ data: {
    shopOrderId: order.id, provider, mode: "TEST", status: input.paymentStatus ?? "SUCCEEDED", amountCents: totalCents,
    currency: "EUR", pricingVersion: SHOP_PHASE5E_QA_ORDER_SNAPSHOT_VERSION, idempotencyKey: `phase5e-runtime-payment:${sequence}`,
    providerCheckoutId: `${provider === "STRIPE" ? "cs_test" : "paypal_order"}_phase5e_runtime_${sequence}`,
    providerPaymentId: `${provider === "STRIPE" ? "pi" : "paypal_capture"}_phase5e_runtime_${sequence}`,
    paymentMethod: provider === "STRIPE" ? "CARD" : "PAYPAL", paidAt: input.paid ? NOW : null,
  } });
  if (!input.paid) return { id: order.id, orderNumber, paymentId: payment.id, invoiceId: null };
  if (input.issueInvoice === false) return { id: order.id, orderNumber, paymentId: payment.id, invoiceId: null };
  const invoice = await prisma.invoice.create({ data: {
    invoiceNumber: `LNX-20260831-${sequence}`, sequenceNumber: BigInt(sequence), issuedAt: NOW, documentType: "SHOP", operationCategory: "GOODS",
    shopOrderId: order.id, paymentId: payment.id, orderNumberSnapshot: orderNumber, customerType: "INDIVIDUAL",
    customerNameSearch: "Membre Phase 5E", customerEmailSearch: "lnx-v110-phase5e-runtime-member@example.invalid",
    sellerSnapshot: { name: "LNX Beats QA" }, customerSnapshot: { firstName: "Membre", lastName: "Phase 5E", addressLine1: "5 rue du Test local", postalCode: "75005", city: "Paris", countryCode: "FR" },
    lineItemsSnapshot: products.map(({ product, quantity }) => ({ title: product.title, unitPriceCents: product.priceCents, quantity })),
    currency: "EUR", subtotalCents, shippingCents: quote.amountCents, totalCents, vatRegime: "FRANCHISE_EN_BASE_TVA", vatAmountCents: 0,
    vatLegalNotice: "TVA non applicable — fixture QA", paymentMethodLabel: provider === "STRIPE" ? "Carte test" : "PayPal test", paidAt: NOW,
    termsVersion: SHOP_PHASE5E_QA_TERMS_VERSION, termsHashSha256: SHOP_LEGAL_QA_TERMS_HASH, snapshotHashSha256: sha256(`invoice:${sequence}`),
  } });
  return { id: order.id, orderNumber, paymentId: payment.id, invoiceId: invoice.id };
}

async function shippingScenario(actors: RuntimeActors, cd: ProductFixture, badge: ProductFixture, goodie: ProductFixture) {
  await prisma.packagingProfile.create({ data: { version: "historical-active-package-v1", name: "Emballage historique QA", status: "ACTIVE", physicalWeightGrams: 30, maximumItemQuantity: 10, customerBillableWeightIncluded: false, activatedAt: NOW } });
  await prisma.shippingRateVersion.create({ data: {
    version: "historical-commercial-qa-v1", status: "ACTIVE", scope: "COMMERCIAL_CANDIDATE", service: "COLISSIMO_HOME_FRANCE", currency: "EUR", countryCode: "FR",
    minimumBillableWeightGrams: 1, packagingWeightGrams: 30, billableWeightPolicy: "PRODUCTS_ONLY", validFrom: new Date("2025-01-01T00:00:00.000Z"), activatedAt: NOW,
    tiers: { create: [{ position: 0, maxWeightGrams: 30_000, priceCents: 999 }] },
  } });
  const candidate = await ensurePhase5ECommercialCandidate();
  assert.equal(candidate.status, "DRAFT");
  const active = await activatePhase5ECommercialRate(candidate.version, actors.admin.id, SHOP_COMMERCIAL_RATE_ACTIVATION_CONFIRMATION, NOW);
  assert.equal(active.status, "ACTIVE");
  assert.equal((await prisma.shippingRateVersion.findUniqueOrThrow({ where: { version: "historical-commercial-qa-v1" } })).status, "ARCHIVED");
  assert.equal((await prisma.packagingProfile.findUniqueOrThrow({ where: { version: "historical-active-package-v1" } })).status, "ARCHIVED");
  const quote = (lines: readonly { product: ProductFixture; quantity: number }[]) => quoteShipping({ rate: active, destinationCountryCode: "FR", lines: lines.map(({ product, quantity }) => ({ productId: product.id, shippingRequired: true, shippingWeightGrams: product.shippingWeightGrams, quantity })) });
  const one = quote([{ product: cd, quantity: 1 }]);
  const ten = quote([{ product: cd, quantity: 10 }]);
  const eleven = quote([{ product: cd, quantity: 11 }]);
  const sixteen = quote([{ product: cd, quantity: 16 }]);
  const mixed = quote([{ product: cd, quantity: 2 }, { product: badge, quantity: 3 }, { product: goodie, quantity: 1 }]);
  assert.deepEqual([one.productWeightGrams, one.packagingWeightGrams, one.physicalWeightGrams, one.billableWeightGrams, one.tierMaximumWeightGrams, one.amountCents], [25, 60, 85, 250, 250, 549]);
  assert.deepEqual([ten.productWeightGrams, ten.packagingWeightGrams, ten.physicalWeightGrams, ten.billableWeightGrams, ten.tierMaximumWeightGrams, ten.amountCents], [250, 60, 310, 250, 250, 549]);
  assert.deepEqual([eleven.productWeightGrams, eleven.packagingWeightGrams, eleven.physicalWeightGrams, eleven.billableWeightGrams, eleven.tierMaximumWeightGrams, eleven.amountCents], [275, 60, 335, 275, 500, 759]);
  assert.deepEqual([sixteen.productWeightGrams, sixteen.packagingWeightGrams, sixteen.physicalWeightGrams, sixteen.billableWeightGrams, sixteen.tierMaximumWeightGrams, sixteen.amountCents], [400, 60, 460, 400, 500, 759]);
  assert.deepEqual([mixed.productWeightGrams, mixed.packagingWeightGrams, mixed.physicalWeightGrams, mixed.billableWeightGrams, mixed.tierMaximumWeightGrams, mixed.amountCents], [195, 60, 255, 250, 250, 549]);
  assert.throws(() => quote([{ product: cd, quantity: 17 }]));
  return { candidate: candidate.version, one, ten, eleven, sixteen, mixed };
}

async function prepareNoPhysicalReturn(
  actors: RuntimeActors,
  fixture: OrderFixture,
  productId: string,
) {
  const created = await createMemberShopReturn(actors.member, {
    orderNumber: fixture.orderNumber,
    type: "NON_CONFORMING",
    comment: `Scénario provider ${fixture.orderNumber}`,
    quantities: new Map([[productId, 1]]),
  }, NOW, { client: prisma, assertEnabled: noGuard });
  await startShopReturnReview(actors.admin, created.requestNumber, NOW, { client: prisma, assertEnabled: noGuard });
  await decideShopReturn(actors.admin, {
    requestNumber: created.requestNumber,
    decision: "APPROVE",
    authorizedQuantities: new Map([[productId, 1]]),
    physicalReturnRequired: false,
    returnCostDecision: "MERCHANT",
    instructions: null,
    comment: "Remboursement QA sans retour physique.",
  }, NOW, { client: prisma, assertEnabled: noGuard, immediateRefund: false });
  return created;
}

async function savScenario(actors: RuntimeActors, cd: ProductFixture, badge: ProductFixture) {
  const single = await createOrder(actors, [{ product: cd, quantity: 1 }], 560001, { paid: true, fulfillment: "SHIPPED" });
  const created = await createMemberShopReturn(actors.member, { orderNumber: single.orderNumber, type: "DEFECTIVE", comment: "Défaut fictif confirmé par l’Admin local.", quantities: new Map([[cd.id, 1]]) }, NOW, { client: prisma, assertEnabled: noGuard });
  await startShopReturnReview(actors.admin, created.requestNumber, NOW, { client: prisma, assertEnabled: noGuard });
  await decideShopReturn(actors.admin, {
    requestNumber: created.requestNumber, decision: "APPROVE", authorizedQuantities: new Map([[cd.id, 1]]), physicalReturnRequired: false,
    returnCostDecision: "MERCHANT", instructions: null, comment: "Retour physique non requis ; remboursement immédiat QA.",
  }, NOW, { client: prisma, assertEnabled: noGuard, immediateRefund: true, refundGateway: createFakeShopRefundGateway("SUCCEEDED") });
  const singleState = await prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: created.id }, include: { refundAttempt: true, creditNote: true } });
  assert.equal(singleState.status, "REFUNDED");
  assert.equal(singleState.itemsRefundCents, cd.priceCents);
  assert.equal(singleState.shippingRefundCents, 549);
  assert.equal(singleState.totalRefundCents, cd.priceCents + 549);
  assert.ok(singleState.refundAttempt && singleState.creditNote);
  assert.equal(await prisma.productStockAdjustment.count({ where: { shopReturnRequestId: created.id } }), 0, "refund must not restock");

  const multi = await createOrder(actors, [{ product: cd, quantity: 1 }, { product: badge, quantity: 1 }], 560002, { paid: true, fulfillment: "SHIPPED" });
  const multiReturn = await createMemberShopReturn(actors.member, { orderNumber: multi.orderNumber, type: "DEFECTIVE", comment: "Un seul article fictif est défectueux.", quantities: new Map([[cd.id, 1]]) }, NOW, { client: prisma, assertEnabled: noGuard });
  await startShopReturnReview(actors.admin, multiReturn.requestNumber, NOW, { client: prisma, assertEnabled: noGuard });
  await decideShopReturn(actors.admin, {
    requestNumber: multiReturn.requestNumber, decision: "APPROVE", authorizedQuantities: new Map([[cd.id, 1]]), physicalReturnRequired: false,
    returnCostDecision: "MERCHANT", instructions: null, comment: "Shipping conservé car une autre ligne a été livrée.",
  }, NOW, { client: prisma, assertEnabled: noGuard, immediateRefund: true, refundGateway: createFakeShopRefundGateway("SUCCEEDED") });
  const multiState = await prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: multiReturn.id } });
  assert.deepEqual([multiState.itemsRefundCents, multiState.shippingRefundCents, multiState.totalRefundCents], [cd.priceCents, 0, cd.priceCents]);

  const evidenceOrder = await createOrder(actors, [{ product: cd, quantity: 1 }], 560003, { paid: true, fulfillment: "SHIPPED" });
  const evidenceReturn = await createMemberShopReturn(actors.member, { orderNumber: evidenceOrder.orderNumber, type: "DAMAGED", comment: "Colis fictif endommagé avec photos privées.", quantities: new Map([[cd.id, 1]]) }, new Date("2026-04-01T12:00:00.000Z"), { client: prisma, assertEnabled: noGuard });
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const first = await addShopReturnEvidence(actors.member, evidenceReturn.requestNumber, [{ name: "preuve-1.png", type: "image/png", bytes: png }], { client: prisma, root: ROOT });
  await assert.rejects(() => getAuthorizedShopReturnEvidence(actors.other, first[0]!.id, { client: prisma, root: ROOT }));
  assert.equal((await getAuthorizedShopReturnEvidence(actors.member, first[0]!.id, { client: prisma, root: ROOT })).evidence.id, first[0]!.id);
  assert.equal((await getAuthorizedShopReturnEvidence(actors.admin, first[0]!.id, { client: prisma, root: ROOT })).evidence.id, first[0]!.id);
  for (let index = 2; index <= 5; index += 1) {
    const bytes = Uint8Array.from([...png, index]);
    await addShopReturnEvidence(actors.member, evidenceReturn.requestNumber, [{ name: `preuve-${index}.png`, type: "image/png", bytes }], { client: prisma, root: ROOT });
  }
  await assert.rejects(() => addShopReturnEvidence(actors.member, evidenceReturn.requestNumber, [{ name: "preuve-6.png", type: "image/png", bytes: Uint8Array.from([...png, 6]) }], { client: prisma, root: ROOT }));
  await prisma.shopReturnRequest.update({ where: { id: evidenceReturn.id }, data: { status: "CLOSED", closedAt: new Date("2026-05-01T12:00:00.000Z") } });

  const overdueOrder = await createOrder(actors, [{ product: cd, quantity: 1 }], 560004, { paid: true, fulfillment: "SHIPPED" });
  const overdue = await createMemberShopReturn(actors.member, { orderNumber: overdueOrder.orderNumber, type: "LOGISTICS_INCIDENT", comment: "Colis fictif non reçu, à analyser sans remboursement automatique.", quantities: new Map([[cd.id, 1]]) }, new Date("2026-08-20T12:00:00.000Z"), { client: prisma, assertEnabled: noGuard });

  const ambiguousOrder = await createOrder(actors, [{ product: badge, quantity: 1 }], 560005, { paid: true, fulfillment: "SHIPPED" });
  const ambiguous = await createMemberShopReturn(actors.member, { orderNumber: ambiguousOrder.orderNumber, type: "NON_CONFORMING", comment: "Scénario de review refund sans retry aveugle.", quantities: new Map([[badge.id, 1]]) }, NOW, { client: prisma, assertEnabled: noGuard });
  await startShopReturnReview(actors.admin, ambiguous.requestNumber, NOW, { client: prisma, assertEnabled: noGuard });
  await decideShopReturn(actors.admin, { requestNumber: ambiguous.requestNumber, decision: "APPROVE", authorizedQuantities: new Map([[badge.id, 1]]), physicalReturnRequired: false, returnCostDecision: "MERCHANT", instructions: null, comment: "Ambigu local." }, NOW, { client: prisma, assertEnabled: noGuard, immediateRefund: true, refundGateway: createFakeShopRefundGateway("AMBIGUOUS") });
  assert.equal((await prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: ambiguous.id }, include: { refundAttempt: true } })).refundAttempt?.status, "REQUIRES_REVIEW");

  const finalizationOrder = await createOrder(actors, [{ product: badge, quantity: 1 }], 560006, { paid: true, fulfillment: "SHIPPED" });
  const finalization = await prepareNoPhysicalReturn(actors, finalizationOrder, badge.id);
  await installCreditNoteFailureTrigger();
  try {
    assert.equal(
      (await requestShopReturnRefund(actors.admin, finalization.requestNumber, "NONE", createFakeShopRefundGateway("SUCCEEDED"))).status,
      "REQUIRES_REVIEW",
      "SAV provider success followed by credit-note failure must require review",
    );
  } finally {
    await removeCreditNoteFailureTrigger();
  }
  const finalizationReview = await prisma.shopReturnRequest.findUniqueOrThrow({
    where: { id: finalization.id },
    include: { refundAttempt: { include: { payment: true } } },
  });
  assert.equal(finalizationReview.refundStatus, "REQUIRES_REVIEW", "SAV request must remain in review");
  assert.equal(finalizationReview.refundAttempt?.status, "REQUIRES_REVIEW", "SAV attempt must remain in review");
  assert.equal(finalizationReview.refundAttempt?.failureCode, "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED");
  assert.ok(finalizationReview.refundAttempt?.providerRefundId);
  assert.equal(finalizationReview.refundAttempt?.payment.refundedAmountCents, 0);
  assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: finalization.id } }), 0);
  assert.equal((await reconcileShopReturnRefund(actors.admin, finalization.requestNumber, createFakeShopRefundGateway("SUCCEEDED"))).status, "SUCCEEDED");
  assert.equal((await reconcileShopReturnRefund(actors.admin, finalization.requestNumber, createFakeShopRefundGateway("SUCCEEDED"))).status, "SUCCEEDED");
  assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: finalization.id } }), 1);
  assert.equal(await prisma.paymentAuditEvent.count({ where: { refundAttemptId: finalizationReview.refundAttempt!.id, action: "REFUND_RECONCILIATION_REQUIRED" } }), 1);

  return { single: created.requestNumber, multi: multiReturn.requestNumber, evidence: evidenceReturn, evidenceIds: first.map(({ id }) => id), overdue: overdue.requestNumber, ambiguous: ambiguous.requestNumber, finalizationReview: finalization.requestNumber };
}

async function customerRequestsScenario(actors: RuntimeActors, cd: ProductFixture) {
  const cancellationOrder = await createOrder(actors, [{ product: cd, quantity: 1 }], 560010, { paid: true });
  const request = await createShopCustomerRequest(actors.member, { orderNumber: cancellationOrder.orderNumber, type: "PAID_ORDER_CANCELLATION", reason: "Annulation fictive avant expédition.", address: null }, NOW, prisma);
  let gatewayCalls = 0;
  const base = createFakeShopRefundGateway("SUCCEEDED");
  const gateway: ShopRefundGateway = { request(input) { gatewayCalls += 1; return base.request(input); }, retrieve(input) { gatewayCalls += 1; return base.retrieve(input); } };
  assert.equal(await decideShopCustomerRequest(actors.admin, request.requestNumber, "APPROVE", "Annulation approuvée en QA.", gateway, NOW, prisma), "SUCCEEDED");
  assert.equal(await decideShopCustomerRequest(actors.admin, request.requestNumber, "APPROVE", "Replay sûr.", gateway, NOW, prisma), "SUCCEEDED");
  assert.equal(gatewayCalls, 1);
  const cancelled = await prisma.shopOrder.findUniqueOrThrow({ where: { id: cancellationOrder.id } });
  const attempts = await prisma.refundAttempt.count({ where: { shopCustomerRequestId: request.id } });
  const notes = await prisma.creditNote.count({ where: { refundAttempt: { shopCustomerRequestId: request.id } } });
  const adjustments = await prisma.productStockAdjustment.count({ where: { shopCustomerRequestId: request.id } });
  const notifications = await prisma.orderNotification.groupBy({ by: ["kind"], where: { shopOrderId: cancellationOrder.id }, _count: { _all: true } });
  assert.deepEqual([cancelled.status, cancelled.paymentStatus, cancelled.fulfillmentStatus], ["CANCELLED", "CANCELLED", "CANCELLED"]);
  assert.deepEqual([attempts, notes, adjustments], [1, 1, 1]);
  assert.ok(notifications.every((row) => row._count._all === 1));

  const addressOrder = await createOrder(actors, [{ product: cd, quantity: 1 }], 560011, { paid: true });
  const invoiceBefore = await prisma.invoice.findUniqueOrThrow({ where: { id: addressOrder.invoiceId! } });
  const address = await createShopCustomerRequest(actors.member, { orderNumber: addressOrder.orderNumber, type: "SHIPPING_ADDRESS_CORRECTION", reason: "Adresse fictive corrigée avant expédition.", address: { firstName: "Jean", lastName: "Test", addressLine1: "6 rue du Test local", addressLine2: null, postalCode: "75006", city: "Paris", countryCode: "FR" } }, NOW, prisma);
  await decideShopCustomerRequest(actors.admin, address.requestNumber, "APPROVE", "Adresse contrôlée.", gateway, NOW, prisma);
  await decideShopCustomerRequest(actors.admin, address.requestNumber, "APPROVE", "Replay sûr.", gateway, NOW, prisma);
  const addressState = await prisma.shopOrder.findUniqueOrThrow({ where: { id: addressOrder.id } });
  const invoiceAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: addressOrder.invoiceId! } });
  assert.deepEqual([addressState.shippingAddressLine1, addressState.shippingPostalCode, addressState.shippingCountryCode], ["6 rue du Test local", "75006", "FR"]);
  assert.deepEqual(invoiceAfter.customerSnapshot, invoiceBefore.customerSnapshot, "invoice snapshot must remain immutable");

  const missingInvoiceResults: Array<{ provider: "STRIPE" | "PAYPAL"; orderNumber: string }> = [];
  for (const [offset, provider] of (["STRIPE", "PAYPAL"] as const).entries()) {
    const missingInvoiceOrder = await createOrder(actors, [{ product: cd, quantity: 1 }], 560013 + offset, { paid: true, provider, issueInvoice: false });
    const missingInvoiceRequest = await createShopCustomerRequest(actors.member, {
      orderNumber: missingInvoiceOrder.orderNumber,
      type: "PAID_ORDER_CANCELLATION",
      reason: `Facture ${provider} volontairement absente dans ce test local.`,
      address: null,
    }, NOW, prisma);
    let providerCalls = 0;
    const fake = createFakeShopRefundGateway("SUCCEEDED");
    const guardedGateway: ShopRefundGateway = {
      request(input) { providerCalls += 1; return fake.request(input); },
      retrieve(input) { providerCalls += 1; return fake.retrieve(input); },
    };
    await assert.rejects(
      () => decideShopCustomerRequest(actors.admin, missingInvoiceRequest.requestNumber, "APPROVE", "Refus attendu.", guardedGateway, NOW, prisma),
      (error: unknown) => error instanceof ShopCustomerRequestError && error.code === "REFUND_REQUIRES_REVIEW",
    );
    assert.equal(providerCalls, 0);
    assert.equal(await prisma.refundAttempt.count({ where: { shopCustomerRequestId: missingInvoiceRequest.id } }), 0);
    assert.equal(await prisma.creditNote.count({ where: { invoice: { shopOrderId: missingInvoiceOrder.id } } }), 0);
    assert.equal(await prisma.productStockAdjustment.count({ where: { shopCustomerRequestId: missingInvoiceRequest.id } }), 0);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: missingInvoiceOrder.paymentId! } })).status, "SUCCEEDED");
    missingInvoiceResults.push({ provider, orderNumber: missingInvoiceOrder.orderNumber });
  }

  const finalizationOrder = await createOrder(actors, [{ product: cd, quantity: 1 }], 560015, { paid: true });
  const finalizationRequest = await createShopCustomerRequest(actors.member, {
    orderNumber: finalizationOrder.orderNumber,
    type: "PAID_ORDER_CANCELLATION",
    reason: "Échec comptable injecté après succès provider fictif.",
    address: null,
  }, NOW, prisma);
  let requestCalls = 0;
  let retrieveCalls = 0;
  const successfulGateway = createFakeShopRefundGateway("SUCCEEDED");
  const countedGateway: ShopRefundGateway = {
    request(input) { requestCalls += 1; return successfulGateway.request(input); },
    retrieve(input) { retrieveCalls += 1; return successfulGateway.retrieve(input); },
  };
  await installCreditNoteFailureTrigger();
  try {
    assert.equal(
      await decideShopCustomerRequest(actors.admin, finalizationRequest.requestNumber, "APPROVE", "Annulation testée.", countedGateway, NOW, prisma),
      "REQUIRES_REVIEW",
      "cancellation provider success followed by credit-note failure must require review",
    );
  } finally {
    await removeCreditNoteFailureTrigger();
  }
  const reviewAttempt = await prisma.refundAttempt.findUniqueOrThrow({
    where: { shopCustomerRequestId: finalizationRequest.id },
    include: { payment: true },
  });
  assert.equal(reviewAttempt.status, "REQUIRES_REVIEW", "cancellation attempt must remain in review");
  assert.equal(reviewAttempt.failureCode, "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED");
  assert.ok(reviewAttempt.providerRefundId);
  assert.equal(reviewAttempt.payment.refundedAmountCents, 0);
  assert.equal(requestCalls, 1);
  assert.equal(retrieveCalls, 0);
  assert.equal(await prisma.creditNote.count({ where: { refundAttemptId: reviewAttempt.id } }), 0);
  assert.equal(await prisma.productStockAdjustment.count({ where: { shopCustomerRequestId: finalizationRequest.id } }), 0);
  assert.equal(await prisma.paymentAuditEvent.count({ where: { refundAttemptId: reviewAttempt.id, action: "REFUND_RECONCILIATION_REQUIRED" } }), 1);
  assert.equal(await reconcileShopCustomerRequestRefund(actors.admin, finalizationRequest.requestNumber, countedGateway, prisma), "SUCCEEDED");
  assert.equal(await reconcileShopCustomerRequestRefund(actors.admin, finalizationRequest.requestNumber, countedGateway, prisma), "SUCCEEDED");
  assert.equal(requestCalls, 1, "reconciliation must retrieve the existing provider refund, never request another one");
  assert.equal(retrieveCalls, 2);
  assert.equal(await prisma.creditNote.count({ where: { refundAttemptId: reviewAttempt.id } }), 1);
  assert.equal(await prisma.productStockAdjustment.count({ where: { shopCustomerRequestId: finalizationRequest.id } }), 1);

  const shipped = await createOrder(actors, [{ product: cd, quantity: 1 }], 560012, { paid: true, fulfillment: "SHIPPED" });
  await assert.rejects(() => createShopCustomerRequest(actors.member, { orderNumber: shipped.orderNumber, type: "PAID_ORDER_CANCELLATION", reason: "Doit être refusée après expédition.", address: null }, NOW, prisma));
  await assert.rejects(() => createShopCustomerRequest(actors.member, { orderNumber: shipped.orderNumber, type: "SHIPPING_ADDRESS_CORRECTION", reason: "Doit être refusée après expédition.", address: { firstName: "Jean", lastName: "Test", addressLine1: "7 rue du Test", addressLine2: null, postalCode: "75007", city: "Paris", countryCode: "FR" } }, NOW, prisma));
  return { cancellation: request.requestNumber, address: address.requestNumber, gatewayCalls, missingInvoiceResults, finalizationReview: finalizationRequest.requestNumber, notifications: notifications.map(({ kind }) => kind) };
}

async function confirmRaceOrder(client: PrismaClient, orderId: string, productId: string, now: Date) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`shop-payments:order:${orderId}`})) IS NULL AS locked`;
    const [order] = await tx.$queryRaw<Array<{ status: string; paymentStatus: string }>>`SELECT "status"::text AS status, "paymentStatus"::text AS "paymentStatus" FROM "shop_orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
    if (!order || order.status !== "OPEN" || order.paymentStatus !== "AWAITING_PAYMENT") return "EXPIRED" as const;
    const changed = await tx.product.updateMany({ where: { id: productId, stock: { gte: 1 } }, data: { stock: { decrement: 1 }, lockVersion: { increment: 1 } } });
    if (changed.count !== 1) throw new Error("Negative-stock prevention failed.");
    await tx.stockReservation.update({ where: { shopOrderId_productId: { shopOrderId: orderId, productId } }, data: { status: "CONFIRMED", confirmedAt: now } });
    await tx.shopOrder.update({ where: { id: orderId }, data: { paymentStatus: "PAID", paidAt: now } });
    return "PAID" as const;
  });
}

async function concurrencyAndSchedulerScenario(actors: RuntimeActors, cd: ProductFixture) {
  const expired = await createOrder(actors, [{ product: cd, quantity: 1 }], 560020, { paid: false, expiresAt: new Date("2026-08-31T10:00:00.000Z") });
  const pending = await createOrder(actors, [{ product: cd, quantity: 1 }], 560021, { paid: false, expiresAt: new Date("2026-09-01T12:00:00.000Z"), paymentStatus: "PENDING" });
  await prisma.shopShippingProviderAttempt.create({ data: {
    shopOrderId: pending.id, provider: "FAKE_LOCAL", scenario: "AMBIGUOUS", status: "REQUIRES_REVIEW", attemptNumber: 1,
    idempotencyKey: `phase5e-shipping-review:${pending.id}`, errorCode: "AMBIGUOUS_PROVIDER_ACCEPTANCE", resolvedAt: NOW,
    createdByUserId: actors.admin.id,
  } });
  const runAt = new Date("2026-08-31T13:00:00.000Z");
  const schedulerClientA = isolatedClient();
  const schedulerClientB = isolatedClient();
  const parallel = await Promise.all([
    runShopReadinessMaintenance(runAt, { client: schedulerClientA, privateRoot: ROOT, skipEnvironmentGuard: true }),
    runShopReadinessMaintenance(runAt, { client: schedulerClientB, privateRoot: ROOT, skipEnvironmentGuard: true }),
  ]).finally(async () => {
    await schedulerClientA.$disconnect();
    await schedulerClientB.$disconnect();
  });
  assert.equal(parallel.filter((row) => row.outcome === "COMPLETED").length, 1);
  assert.ok(parallel.every((row) => ["COMPLETED", "SKIPPED_OVERLAP", "REPLAYED"].includes(row.outcome)));
  const completed = parallel.find((row) => row.outcome === "COMPLETED");
  assert.ok(completed && completed.reservationsExpired >= 1 && completed.evidencePurged === 5);
  assert.ok(completed.savAlerts >= 1 && completed.paymentAlerts >= 1 && completed.refundAlerts >= 1 && completed.shippingAlerts >= 1);
  const replay = await runShopReadinessMaintenance(runAt, { client: prisma, privateRoot: ROOT, skipEnvironmentGuard: true });
  assert.equal(replay.outcome, "REPLAYED");
  assert.equal(await prisma.shopMaintenanceRun.count({ where: { idempotencyKey: `phase5e:${runAt.toISOString()}` } }), 1);
  assert.equal((await prisma.shopOrder.findUniqueOrThrow({ where: { id: expired.id } })).status, "EXPIRED");
  assert.equal(await prisma.shopOrderEvent.count({ where: { shopOrderId: expired.id, type: "STOCK_RESERVATION_EXPIRED" } }), 1);
  assert.equal(await prisma.shopReturnEvidence.count({ where: { status: "PURGED" } }), 5);
  assert.equal(await prisma.shopReturnAuditEvent.count({ where: { action: "EVIDENCE_PURGED" } }), 5);
  const activeAlerts = await prisma.shopReadinessAlert.groupBy({ by: ["kind"], where: { status: "OPEN" }, _count: { _all: true } });
  assert.ok(activeAlerts.every((row) => row._count._all >= 1));

  const raceProduct = await createProduct(actors.admin.id, "race", { priceCents: 2_500, stock: 1, weight: 25 });
  const raceOrder = await createOrder(actors, [{ product: raceProduct, quantity: 1 }], 560022, { paid: false, expiresAt: new Date("2026-08-31T14:00:00.000Z") });
  const raceAt = new Date("2026-08-31T14:00:01.000Z");
  const paymentClient = isolatedClient();
  const expiryClient = isolatedClient();
  const [paymentOutcome] = await Promise.all([
    confirmRaceOrder(paymentClient, raceOrder.id, raceProduct.id, raceAt),
    runShopReadinessMaintenance(raceAt, { client: expiryClient, privateRoot: ROOT, skipEnvironmentGuard: true }),
  ]).finally(async () => {
    await paymentClient.$disconnect();
    await expiryClient.$disconnect();
  });
  const raceState = await prisma.shopOrder.findUniqueOrThrow({ where: { id: raceOrder.id } });
  const reservation = await prisma.stockReservation.findUniqueOrThrow({ where: { shopOrderId_productId: { shopOrderId: raceOrder.id, productId: raceProduct.id } } });
  const product = await prisma.product.findUniqueOrThrow({ where: { id: raceProduct.id } });
  assert.ok(
    (raceState.paymentStatus === "PAID" && raceState.status === "OPEN" && reservation.status === "CONFIRMED" && product.stock === 0 && paymentOutcome === "PAID")
    || (raceState.paymentStatus === "AWAITING_PAYMENT" && raceState.status === "EXPIRED" && reservation.status === "EXPIRED" && product.stock === 1 && paymentOutcome === "EXPIRED"),
  );
  return { firstRun: completed, replay: replay.outcome, race: { paymentOutcome, order: raceState.status, payment: raceState.paymentStatus, reservation: reservation.status, stock: product.stock }, alertKinds: activeAlerts.map(({ kind }) => kind) };
}

async function run() {
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  const migrationCount = await guard();
  assert.equal(migrationCount, 29);
  assert.equal(await prisma.user.count(), 0);
  const actors = await createActors();
  const cd = await createProduct(actors.admin.id, "cd-25g", { priceCents: 2_500, stock: 40, weight: 25 });
  const badge = await createProduct(actors.admin.id, "badge-fictif-15g", { priceCents: 500, stock: 10, weight: 15 });
  const goodie = await createProduct(actors.admin.id, "goodie-fictif-100g", { priceCents: 1_000, stock: 10, weight: 100 });
  const shipping = await shippingScenario(actors, cd, badge, goodie);
  const sav = await savScenario(actors, cd, badge);
  const customerRequests = await customerRequestsScenario(actors, cd);
  const scheduler = await concurrencyAndSchedulerScenario(actors, cd);
  for (const evidenceId of sav.evidenceIds) await assert.rejects(() => getAuthorizedShopReturnEvidence(actors.admin, evidenceId, { client: prisma, root: ROOT }));
  await access(ROOT);
  console.info(JSON.stringify({
    event: "shop.phase5e.runtime.completed", outcome: "passed", migrationCount,
    shipping: {
      candidate: shipping.candidate,
      oneCd: [shipping.one.productWeightGrams, shipping.one.packagingWeightGrams, shipping.one.physicalWeightGrams, shipping.one.billableWeightGrams, shipping.one.tierMaximumWeightGrams, shipping.one.amountCents],
      tenCd: [shipping.ten.productWeightGrams, shipping.ten.packagingWeightGrams, shipping.ten.physicalWeightGrams, shipping.ten.billableWeightGrams, shipping.ten.tierMaximumWeightGrams, shipping.ten.amountCents],
      elevenCd: [shipping.eleven.productWeightGrams, shipping.eleven.packagingWeightGrams, shipping.eleven.physicalWeightGrams, shipping.eleven.billableWeightGrams, shipping.eleven.tierMaximumWeightGrams, shipping.eleven.amountCents],
      sixteenCd: [shipping.sixteen.productWeightGrams, shipping.sixteen.packagingWeightGrams, shipping.sixteen.physicalWeightGrams, shipping.sixteen.billableWeightGrams, shipping.sixteen.tierMaximumWeightGrams, shipping.sixteen.amountCents],
      mixed: [shipping.mixed.productWeightGrams, shipping.mixed.packagingWeightGrams, shipping.mixed.physicalWeightGrams, shipping.mixed.billableWeightGrams, shipping.mixed.tierMaximumWeightGrams, shipping.mixed.amountCents],
    },
    sav: { singleRefund: sav.single, multiRefund: sav.multi, evidencePurged: 5, overdue: sav.overdue, ambiguous: sav.ambiguous },
    customerRequests,
    scheduler,
    externalProvidersContacted: false,
  }));
}

run().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "shop.phase5e.runtime.failed", outcome: "failed" }));
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
