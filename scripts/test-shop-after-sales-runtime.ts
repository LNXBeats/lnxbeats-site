import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { prisma } from "@/lib/prisma";
import { assertShopAfterSalesQaEnabled, SHOP_AFTER_SALES_QA_TARGET } from "@/lib/shop/after-sales-config";
import {
  closeShopReturn,
  createFakeShopRefundGateway,
  createMemberShopReturn,
  decideShopReturn,
  getMemberShopReturn,
  inspectShopReturn,
  markShopReturnReceived,
  reconcileShopReturnRefund,
  requestShopReturnRefund,
  restockShopReturn,
  startShopReturnReview,
} from "@/lib/shop/after-sales-service";

const MEMBER_EMAIL = "lnx-v110-phase5b-runtime-member@example.invalid";
const OTHER_EMAIL = "lnx-v110-phase5b-runtime-other@example.invalid";
const ADMIN_EMAIL = "lnx-v110-phase5b-runtime-admin@example.invalid";

type Actors = Readonly<{
  member: { id: string; role: "MEMBER"; status: "ACTIVE"; emailVerified: true };
  other: { id: string; role: "MEMBER"; status: "ACTIVE"; emailVerified: true };
  admin: { id: string; role: "ADMIN"; status: "ACTIVE"; emailVerified: true };
}>;

type PaidFixture = Readonly<{
  productId: string;
  orderNumber: string;
  paymentId: string;
  quantity: number;
  unitPriceCents: number;
  shippingCents: number;
  initialStock: number;
}>;

async function guard() {
  assertShopAfterSalesQaEnabled();
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, SHOP_AFTER_SALES_QA_TARGET);
  assert.ok(!process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_ENVIRONMENT_NAME);
  const databaseUrl = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "");
  assert.equal(decodeURIComponent(databaseUrl.pathname), "/template1");
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  assert.ok(proofPath);
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as {
    name?: string;
    pid?: number;
    exports?: { database?: { connectionString?: string } };
  };
  assert.equal(proof.name, SHOP_AFTER_SALES_QA_TARGET);
  const proofUrl = assertSafeLocalPostgresUrl(proof.exports?.database?.connectionString ?? "");
  assert.equal(proofUrl.port, databaseUrl.port);
  process.kill(Number(proof.pid), 0);
  const identity = await prisma.$queryRaw<Array<{ database: string; schema: string }>>`
    SELECT current_database() AS database, current_schema() AS schema
  `;
  assert.deepEqual(identity[0], { database: "template1", schema: "public" });

  const root = path.join(process.cwd(), "prisma", "migrations");
  const expected = await Promise.all((await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map(async (name) => ({
      name,
      checksum: createHash("sha256").update(await readFile(path.join(root, name, "migration.sql"))).digest("hex"),
    })));
  const applied = await prisma.$queryRaw<Array<{
    name: string;
    checksum: string;
    finishedAt: Date | null;
    rolledBackAt: Date | null;
  }>>`
    SELECT "migration_name" AS name, checksum, "finished_at" AS "finishedAt", "rolled_back_at" AS "rolledBackAt"
    FROM "_prisma_migrations" ORDER BY "migration_name", "started_at"
  `;
  assert.deepEqual(applied.map(({ name, checksum }) => ({ name, checksum })), expected);
  assert.ok(applied.every(({ finishedAt, rolledBackAt }) => finishedAt && !rolledBackAt));
  return expected.length;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function createActors(): Promise<Actors> {
  const now = new Date();
  const [member, other, admin] = await Promise.all([
    prisma.user.create({ data: { email: MEMBER_EMAIL, displayName: "Membre SAV QA", role: "MEMBER", status: "ACTIVE", emailVerified: true, emailVerifiedAt: now } }),
    prisma.user.create({ data: { email: OTHER_EMAIL, displayName: "Autre membre SAV QA", role: "MEMBER", status: "ACTIVE", emailVerified: true, emailVerifiedAt: now } }),
    prisma.user.create({ data: { email: ADMIN_EMAIL, displayName: "Admin SAV QA", role: "ADMIN", status: "ACTIVE", emailVerified: true, emailVerifiedAt: now } }),
  ]);
  return {
    member: { id: member.id, role: "MEMBER", status: "ACTIVE", emailVerified: true },
    other: { id: other.id, role: "MEMBER", status: "ACTIVE", emailVerified: true },
    admin: { id: admin.id, role: "ADMIN", status: "ACTIVE", emailVerified: true },
  };
}

async function createPaidFixture(
  actors: Actors,
  input: Readonly<{
    suffix: string;
    sequence: number;
    quantity: number;
    unitPriceCents: number;
    shippingCents: number;
    initialStock: number;
  }>,
): Promise<PaidFixture> {
  const now = new Date();
  const orderNumber = `LNX-SHOP-2026-${input.sequence.toString().padStart(6, "0")}`;
  const title = `CD fictif SAV Phase 5B ${input.suffix}`;
  const subtotalCents = input.quantity * input.unitPriceCents;
  const totalCents = subtotalCents + input.shippingCents;
  const product = await prisma.product.create({ data: {
    slug: `lnx-v110-phase5b-runtime-${input.suffix}`,
    title,
    description: "Fixture locale jetable.",
    status: "PUBLISHED",
    priceCents: input.unitPriceCents,
    currency: "EUR",
    trackInventory: true,
    stock: input.initialStock,
    shippingRequired: true,
    shippingPriceCents: input.shippingCents,
    shippingWeightGrams: 120,
    publishedAt: now,
    createdByAdminId: actors.admin.id,
    updatedByAdminId: actors.admin.id,
  } });
  const order = await prisma.shopOrder.create({ data: {
    orderNumber,
    userId: actors.member.id,
    creationToken: randomUUID(),
    requestFingerprintSha256: sha256(`order:${input.suffix}`),
    status: "OPEN",
    paymentStatus: "PAID",
    fulfillmentStatus: "SHIPPED",
    currency: "EUR",
    subtotalCents,
    shippingCents: input.shippingCents,
    totalCents,
    shippingRequired: true,
    shippingFirstName: "Membre",
    shippingLastName: "SAV QA",
    shippingAddressLine1: "5 rue du Test local",
    shippingPostalCode: "75005",
    shippingCity: "Paris",
    shippingCountryCode: "FR",
    termsVersion: "shop-cgv-phase5b-qa-v1",
    termsHashSha256: sha256("shop-cgv-phase5b-qa-v1"),
    termsAcceptedAt: now,
    createdAt: now,
    updatedAt: now,
    reservationExpiresAt: new Date(now.getTime() + 30 * 60_000),
    paidAt: now,
    preparingAt: new Date(now.getTime() + 1_000),
    shippedAt: new Date(now.getTime() + 2_000),
    items: { create: [{
      productId: product.id,
      position: 0,
      productTitle: product.title,
      inventoryTracked: true,
      unitPriceCents: input.unitPriceCents,
      quantity: input.quantity,
      lineTotalCents: subtotalCents,
      shippingRequired: true,
      unitShippingCents: 0,
      lineShippingCents: 0,
      unitShippingWeightGrams: 120,
      lineShippingWeightGrams: 120 * input.quantity,
      currency: "EUR",
    }] },
  } });
  await prisma.stockReservation.create({ data: {
    shopOrderId: order.id,
    productId: product.id,
    quantity: input.quantity,
    status: "CONFIRMED",
    expiresAt: order.reservationExpiresAt,
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  } });
  const payment = await prisma.payment.create({ data: {
    shopOrderId: order.id,
    provider: "STRIPE",
    mode: "TEST",
    status: "SUCCEEDED",
    amountCents: totalCents,
    currency: "EUR",
    pricingVersion: "shop-order-snapshot-v1",
    idempotencyKey: `phase5b-payment:${input.suffix}`,
    providerCheckoutId: `cs_test_phase5b_${input.suffix}`,
    providerPaymentId: `pi_phase5b_${input.suffix}`,
    paymentMethod: "CARD",
    paidAt: now,
    createdAt: now,
    updatedAt: now,
  } });
  await prisma.invoice.create({ data: {
    invoiceNumber: `LNX-20260830-${input.sequence}`,
    sequenceNumber: BigInt(input.sequence),
    issuedAt: now,
    documentType: "SHOP",
    operationCategory: "GOODS",
    shopOrderId: order.id,
    paymentId: payment.id,
    orderNumberSnapshot: order.orderNumber,
    customerType: "INDIVIDUAL",
    customerNameSearch: "Membre SAV QA",
    customerEmailSearch: MEMBER_EMAIL,
    sellerSnapshot: { name: "LNX Beats QA" },
    customerSnapshot: { email: MEMBER_EMAIL },
    lineItemsSnapshot: [{ title: product.title, unitPriceCents: input.unitPriceCents, quantity: input.quantity }],
    currency: "EUR",
    subtotalCents,
    shippingCents: input.shippingCents,
    totalCents,
    vatRegime: "FRANCHISE_EN_BASE_TVA",
    vatAmountCents: 0,
    vatLegalNotice: "TVA non applicable — QA",
    paymentMethodLabel: "Carte test",
    paidAt: now,
    termsVersion: "shop-cgv-phase5b-qa-v1",
    termsHashSha256: sha256("shop-cgv-phase5b-qa-v1"),
    snapshotHashSha256: sha256(`invoice:${input.suffix}`),
    createdAt: now,
  } });
  return {
    productId: product.id,
    orderNumber,
    paymentId: payment.id,
    quantity: input.quantity,
    unitPriceCents: input.unitPriceCents,
    shippingCents: input.shippingCents,
    initialStock: input.initialStock,
  };
}

async function preparePhysicalReturn(
  actors: Actors,
  fixture: PaidFixture,
  input: Readonly<{
    quantity: number;
    refundableQuantity: number;
    restockableQuantity: number;
    condition: "SEALED" | "UNSEALED" | "DAMAGED" | "DEFECTIVE" | "OTHER";
    decision: "RESTOCKABLE" | "NOT_RESTOCKABLE";
  }>,
) {
  const created = await createMemberShopReturn(actors.member, {
    orderNumber: fixture.orderNumber,
    type: "DEFECTIVE",
    comment: `Scénario ${fixture.orderNumber}`,
    quantities: new Map([[fixture.productId, input.quantity]]),
  });
  await startShopReturnReview(actors.admin, created.requestNumber);
  await decideShopReturn(actors.admin, {
    requestNumber: created.requestNumber,
    decision: "APPROVE",
    authorizedQuantities: new Map([[fixture.productId, input.quantity]]),
    physicalReturnRequired: true,
    returnCostDecision: "MANUAL_REVIEW",
    instructions: "Retour QA local uniquement.",
    comment: "Accepté en QA.",
  });
  await markShopReturnReceived(actors.admin, created.requestNumber, new Map([[fixture.productId, input.quantity]]));
  await inspectShopReturn(actors.admin, {
    requestNumber: created.requestNumber,
    lines: new Map([[fixture.productId, {
      condition: input.condition,
      decision: input.decision,
      restockableQuantity: input.restockableQuantity,
      refundableQuantity: input.refundableQuantity,
      comment: "Inspection QA locale.",
    }]]),
  });
  return created;
}

async function prepareNoPhysicalReturn(actors: Actors, fixture: PaidFixture) {
  const created = await createMemberShopReturn(actors.member, {
    orderNumber: fixture.orderNumber,
    type: "NON_CONFORMING",
    comment: `Scénario provider ${fixture.orderNumber}`,
    quantities: new Map([[fixture.productId, 1]]),
  });
  await startShopReturnReview(actors.admin, created.requestNumber);
  await decideShopReturn(actors.admin, {
    requestNumber: created.requestNumber,
    decision: "APPROVE",
    authorizedQuantities: new Map([[fixture.productId, 1]]),
    physicalReturnRequired: false,
    returnCostDecision: "MERCHANT",
    instructions: null,
    comment: "Remboursement QA sans retour physique.",
  });
  return created;
}

async function scenarioPartialReturn(actors: Actors) {
  const fixture = await createPaidFixture(actors, { suffix: "partial", sequence: 500001, quantity: 3, unitPriceCents: 2_500, shippingCents: 800, initialStock: 7 });
  const outcomes = await Promise.allSettled([
    createMemberShopReturn(actors.member, { orderNumber: fixture.orderNumber, type: "DEFECTIVE", comment: "Défaut local A", quantities: new Map([[fixture.productId, 2]]) }),
    createMemberShopReturn(actors.member, { orderNumber: fixture.orderNumber, type: "DEFECTIVE", comment: "Défaut local B", quantities: new Map([[fixture.productId, 2]]) }),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  const created = outcomes.find((outcome): outcome is PromiseFulfilledResult<{ id: string; requestNumber: string }> => outcome.status === "fulfilled")!.value;
  assert.equal(await getMemberShopReturn(actors.other.id, created.requestNumber), null, "cross-member SAV access must fail DB-first");
  await startShopReturnReview(actors.admin, created.requestNumber);
  await decideShopReturn(actors.admin, { requestNumber: created.requestNumber, decision: "APPROVE", authorizedQuantities: new Map([[fixture.productId, 2]]), physicalReturnRequired: true, returnCostDecision: "MANUAL_REVIEW", instructions: "Retour QA local uniquement.", comment: "Accepté en QA." });
  await markShopReturnReceived(actors.admin, created.requestNumber, new Map([[fixture.productId, 2]]));
  await inspectShopReturn(actors.admin, { requestNumber: created.requestNumber, lines: new Map([[fixture.productId, { condition: "DAMAGED", decision: "RESTOCKABLE", restockableQuantity: 1, refundableQuantity: 2, comment: "Une unité restockable." }]]) });
  assert.equal((await requestShopReturnRefund(actors.admin, created.requestNumber, "NONE", createFakeShopRefundGateway("SUCCEEDED"))).status, "SUCCEEDED");
  assert.equal((await requestShopReturnRefund(actors.admin, created.requestNumber, "NONE", createFakeShopRefundGateway("SUCCEEDED"))).status, "SUCCEEDED");
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock, fixture.initialStock, "refund must never restock");
  assert.equal((await restockShopReturn(actors.admin, created.requestNumber)).restockedQuantity, 1);
  assert.equal((await restockShopReturn(actors.admin, created.requestNumber)).restockedQuantity, 0);
  await closeShopReturn(actors.admin, created.requestNumber);

  const [request, payment, product, refundAttempts, creditNotes, restocks, notifications] = await Promise.all([
    prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: created.id }, include: { items: true } }),
    prisma.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } }),
    prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } }),
    prisma.refundAttempt.count({ where: { shopReturnRequestId: created.id } }),
    prisma.creditNote.count({ where: { shopReturnRequestId: created.id } }),
    prisma.productStockAdjustment.count({ where: { shopReturnRequestId: created.id } }),
    prisma.orderNotification.groupBy({ by: ["kind"], where: { shopReturnRequestId: created.id }, _count: { _all: true } }),
  ]);
  assert.equal(request.status, "CLOSED");
  assert.deepEqual({ items: request.itemsRefundCents, shipping: request.shippingRefundCents, total: request.totalRefundCents }, { items: 5_000, shipping: 0, total: 5_000 });
  assert.equal(request.items[0]?.restockedQuantity, 1);
  assert.equal(payment.status, "PARTIALLY_REFUNDED");
  assert.equal(payment.refundedAmountCents, 5_000);
  assert.equal(product.stock, 8);
  assert.deepEqual({ refundAttempts, creditNotes, restocks }, { refundAttempts: 1, creditNotes: 1, restocks: 1 });
  for (const row of notifications) assert.equal(row._count._all, 1);
  assert.equal(notifications.some(({ kind }) => kind === "OWNER_SHOP_RETURN_REQUESTED"), true);
  assert.equal(notifications.some(({ kind }) => kind === "CUSTOMER_SHOP_REFUND_CONFIRMED"), true);
  return { requestNumber: created.requestNumber, refundCents: 5_000, stockBefore: 7, stockAfter: 8 };
}

async function scenarioFullConcurrent(actors: Actors) {
  const fixture = await createPaidFixture(actors, { suffix: "full", sequence: 500003, quantity: 1, unitPriceCents: 2_000, shippingCents: 600, initialStock: 4 });
  const created = await preparePhysicalReturn(actors, fixture, { quantity: 1, refundableQuantity: 1, restockableQuantity: 1, condition: "SEALED", decision: "RESTOCKABLE" });
  const refundResults = await Promise.all([
    requestShopReturnRefund(actors.admin, created.requestNumber, "FULL", createFakeShopRefundGateway("SUCCEEDED")),
    requestShopReturnRefund(actors.admin, created.requestNumber, "FULL", createFakeShopRefundGateway("SUCCEEDED")),
  ]);
  assert.deepEqual(refundResults.map(({ status }) => status), ["SUCCEEDED", "SUCCEEDED"]);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock, 4);
  const restockResults = await Promise.all([
    restockShopReturn(actors.admin, created.requestNumber),
    restockShopReturn(actors.admin, created.requestNumber),
  ]);
  assert.equal(restockResults.reduce((sum, row) => sum + row.restockedQuantity, 0), 1);
  const [request, payment, product, attempts, creditNotes, adjustments, refundNotifications] = await Promise.all([
    prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: created.id } }),
    prisma.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } }),
    prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } }),
    prisma.refundAttempt.count({ where: { shopReturnRequestId: created.id } }),
    prisma.creditNote.count({ where: { shopReturnRequestId: created.id } }),
    prisma.productStockAdjustment.count({ where: { shopReturnRequestId: created.id } }),
    prisma.orderNotification.count({
      where: { shopReturnRequestId: created.id, kind: "CUSTOMER_SHOP_REFUND_CONFIRMED" },
    }),
  ]);
  assert.equal(request.totalRefundCents, 2_600);
  assert.equal(payment.status, "REFUNDED");
  assert.equal(product.stock, 5);
  assert.deepEqual({ attempts, creditNotes, adjustments }, { attempts: 1, creditNotes: 1, adjustments: 1 });
  assert.equal(refundNotifications, 1);
  return { requestNumber: created.requestNumber, refundCents: 2_600, stockBefore: 4, stockAfter: 5 };
}

async function scenarioNonRestockable(actors: Actors) {
  const fixture = await createPaidFixture(actors, { suffix: "non-restockable", sequence: 500004, quantity: 1, unitPriceCents: 3_000, shippingCents: 700, initialStock: 6 });
  const created = await preparePhysicalReturn(actors, fixture, { quantity: 1, refundableQuantity: 1, restockableQuantity: 0, condition: "UNSEALED", decision: "NOT_RESTOCKABLE" });
  assert.equal((await requestShopReturnRefund(actors.admin, created.requestNumber, "NONE", createFakeShopRefundGateway("SUCCEEDED"))).status, "SUCCEEDED");
  assert.equal((await restockShopReturn(actors.admin, created.requestNumber)).restockedQuantity, 0);
  const [request, product, adjustments] = await Promise.all([
    prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: created.id } }),
    prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } }),
    prisma.productStockAdjustment.count({ where: { shopReturnRequestId: created.id } }),
  ]);
  assert.equal(request.totalRefundCents, 3_000);
  assert.equal(product.stock, fixture.initialStock);
  assert.equal(adjustments, 0);
  return { requestNumber: created.requestNumber, refundCents: 3_000, stockBefore: 6, stockAfter: 6 };
}

async function scenarioProviderStates(actors: Actors) {
  const failedFixture = await createPaidFixture(actors, { suffix: "failed", sequence: 500005, quantity: 1, unitPriceCents: 2_200, shippingCents: 500, initialStock: 3 });
  const failed = await prepareNoPhysicalReturn(actors, failedFixture);
  assert.equal((await requestShopReturnRefund(actors.admin, failed.requestNumber, "NONE", createFakeShopRefundGateway("FAILED"))).status, "FAILED");
  assert.equal((await requestShopReturnRefund(actors.admin, failed.requestNumber, "NONE", createFakeShopRefundGateway("SUCCEEDED"))).status, "FAILED");
  const failedState = await prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: failed.id }, include: { refundAttempt: true } });
  assert.equal(failedState.status, "REFUND_PENDING");
  assert.equal(failedState.refundStatus, "FAILED");
  assert.equal(failedState.refundAttempt?.status, "FAILED");
  assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: failed.id } }), 0);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: failedFixture.productId } })).stock, failedFixture.initialStock);

  const pendingFixture = await createPaidFixture(actors, { suffix: "pending", sequence: 500006, quantity: 1, unitPriceCents: 2_400, shippingCents: 500, initialStock: 3 });
  const pending = await prepareNoPhysicalReturn(actors, pendingFixture);
  assert.equal((await requestShopReturnRefund(actors.admin, pending.requestNumber, "NONE", createFakeShopRefundGateway("PENDING"))).status, "PENDING");
  assert.equal((await prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: pending.id } })).refundStatus, "PENDING");
  assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: pending.id } }), 0);
  assert.equal((await reconcileShopReturnRefund(actors.admin, pending.requestNumber, createFakeShopRefundGateway("PENDING"))).status, "SUCCEEDED");
  assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: pending.id } }), 1);

  const ambiguousFixture = await createPaidFixture(actors, { suffix: "ambiguous", sequence: 500007, quantity: 1, unitPriceCents: 2_600, shippingCents: 500, initialStock: 3 });
  const ambiguous = await prepareNoPhysicalReturn(actors, ambiguousFixture);
  assert.equal((await requestShopReturnRefund(actors.admin, ambiguous.requestNumber, "NONE", createFakeShopRefundGateway("AMBIGUOUS"))).status, "REQUIRES_REVIEW");
  const ambiguousState = await prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: ambiguous.id }, include: { refundAttempt: true } });
  assert.equal(ambiguousState.status, "REFUND_PENDING");
  assert.equal(ambiguousState.refundStatus, "REQUIRES_REVIEW");
  assert.equal(ambiguousState.refundAttempt?.failureCode, "AMBIGUOUS_PROVIDER_ACCEPTANCE");
  assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: ambiguous.id } }), 0);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: ambiguousFixture.productId } })).stock, ambiguousFixture.initialStock);
  return { failed: failed.requestNumber, pendingReconciled: pending.requestNumber, ambiguousReview: ambiguous.requestNumber };
}

async function run() {
  const migrationCount = await guard();
  assert.equal(await prisma.user.count({ where: { email: { in: [MEMBER_EMAIL, OTHER_EMAIL, ADMIN_EMAIL] } } }), 0);
  const actors = await createActors();
  const partial = await scenarioPartialReturn(actors);
  const full = await scenarioFullConcurrent(actors);
  const nonRestockable = await scenarioNonRestockable(actors);
  const providerStates = await scenarioProviderStates(actors);
  console.info(JSON.stringify({
    event: "shop.after-sales.runtime.completed",
    outcome: "passed",
    migrationCount,
    scenarios: {
      fullRestockable: full,
      partial,
      nonRestockable,
      providerFailure: providerStates.failed,
      providerPendingReconciled: providerStates.pendingReconciled,
      providerAmbiguousReview: providerStates.ambiguousReview,
    },
    concurrency: {
      cumulativeReturnQuantity: "one-winner",
      doubleRefund: "one-attempt-one-credit-note",
      doubleRestock: "one-adjustment-one-stock-increment",
    },
  }));
}

run().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "shop.after-sales.runtime.failed", outcome: "failed" }));
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
