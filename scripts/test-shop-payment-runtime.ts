import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createPrismaPaymentDiagnosticRepository } from "@/lib/payments/production-diagnostic";
import {
  processVerifiedPaypalFinancialEvent,
  processVerifiedStripeFinancialEvent,
} from "@/lib/payments/provider-financial-events";
import { prisma } from "@/lib/prisma";
import { markShopOrderPreparing, markShopOrderShipped, ShopFulfillmentError } from "@/lib/shop/fulfillment-service";
import {
  SHOP_LEGAL_QA_CONFIRMATION,
  SHOP_LEGAL_QA_TERMS_VERSION,
} from "@/lib/shop/legal";
import { createShopPaymentDatabaseRepository } from "@/lib/shop/payment-repository";
import {
  createPaypalPaymentSourceLookup,
  enrichShopStripeWebhookEvent,
  processVerifiedPaypalWebhookEventByPaymentSource,
  processVerifiedShopStripeWebhookEvent,
  resolveShopStripePaymentSource,
} from "@/lib/shop/payment-webhooks";
import { expireShopOrderReservations, releaseShopOrderReservation, ShopServiceError } from "@/lib/shop/order-service";
import {
  loadAndAssertShopPhase2QaEnvironment,
  shopPhase3QaRuntimeOverrides,
} from "@/lib/shop/qa-guard";
import { SHOP_PAYMENT_PRICING_VERSION, type ShopPaymentProviderEvent } from "@/lib/shop/payment-types";

const EXPECTED_MIGRATION_COUNT = 21;
const TECHNICAL_DATABASE = "template1";
const FIXTURE_PREFIX = "lnx-v110-phase3-runtime";
const ORDER_NUMBER_PREFIX = "LNX-SHOP-2026-93";
const FIXTURE_EMAILS = {
  member: `${FIXTURE_PREFIX}-member@example.invalid`,
  admin: `${FIXTURE_PREFIX}-admin@example.invalid`,
} as const;
const FIXTURE_PRODUCT_SLUG_PREFIX = `${FIXTURE_PREFIX}-product`;

type Fixture = Readonly<{
  memberId: string;
  adminId: string;
  productId: string;
  shopOrderId: string;
  orderNumber: string;
  reservationId: string;
  initialStock: number;
  quantity: number;
  totalCents: number;
  reservationExpiresAt: Date;
}>;

function exactEnvironment(name: string, expected: string) {
  assert.equal(process.env[name], expected, `${name} must be exactly ${expected}.`);
}

async function assertMigrationState() {
  const migrationRoot = path.join(process.cwd(), "prisma", "migrations");
  const expected = await Promise.all((await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map(async (name) => ({
      name,
      checksum: createHash("sha256")
        .update(await readFile(path.join(migrationRoot, name, "migration.sql")))
        .digest("hex"),
    })));
  assert.equal(expected.length, EXPECTED_MIGRATION_COUNT, "The repository must contain exactly 21 migrations.");

  const applied = await prisma.$queryRaw<Array<{
    migrationName: string;
    checksum: string;
    finishedAt: Date | null;
    rolledBackAt: Date | null;
  }>>`
    SELECT "migration_name" AS "migrationName", "checksum",
      "finished_at" AS "finishedAt", "rolled_back_at" AS "rolledBackAt"
    FROM "_prisma_migrations"
    ORDER BY "migration_name" ASC, "started_at" ASC
  `;
  assert.equal(applied.length, EXPECTED_MIGRATION_COUNT, "All 21 migrations must be applied.");
  assert.ok(applied.every((row) => row.finishedAt !== null && row.rolledBackAt === null));
  assert.deepEqual(
    applied.map((row) => ({ name: row.migrationName, checksum: row.checksum })),
    expected,
    "The disposable database migration history must exactly match the repository.",
  );
}

async function assertRuntimeIdentity(expectedPort: string) {
  const rows = await prisma.$queryRaw<Array<{
    database: string;
    schema: string;
    serverAddress: string | null;
    serverPort: number | null;
  }>>`
    SELECT current_database() AS database, current_schema() AS schema,
      inet_server_addr()::text AS "serverAddress", inet_server_port() AS "serverPort"
  `;
  const identity = rows[0];
  assert.ok(identity, "The disposable PostgreSQL identity is unavailable.");
  assert.equal(identity.database, TECHNICAL_DATABASE);
  assert.equal(identity.schema, "public");
  if (identity.serverAddress === null && identity.serverPort === null) return;
  assert.ok(identity.serverAddress === "127.0.0.1" || identity.serverAddress === "::1");
  assert.equal(identity.serverPort, Number(expectedPort));
}

async function fixtureIds() {
  const [orders, products, users] = await Promise.all([
    prisma.shopOrder.findMany({
      where: { orderNumber: { startsWith: ORDER_NUMBER_PREFIX } },
      select: { id: true },
    }),
    prisma.product.findMany({
      where: { slug: { startsWith: FIXTURE_PRODUCT_SLUG_PREFIX } },
      select: { id: true },
    }),
    prisma.user.findMany({
      where: { email: { in: Object.values(FIXTURE_EMAILS) } },
      select: { id: true },
    }),
  ]);
  return {
    shopOrderIds: orders.map(({ id }) => id),
    productIds: products.map(({ id }) => id),
    userIds: users.map(({ id }) => id),
  };
}

async function cleanupFixtures() {
  const { shopOrderIds, productIds, userIds } = await fixtureIds();
  await prisma.$transaction(async (transaction) => {
    if (shopOrderIds.length) {
      const paymentIds = (await transaction.payment.findMany({
        where: { shopOrderId: { in: shopOrderIds } },
        select: { id: true },
      })).map(({ id }) => id);
      const notificationIds = (await transaction.orderNotification.findMany({
        where: { shopOrderId: { in: shopOrderIds } },
        select: { id: true },
      })).map(({ id }) => id);
      if (notificationIds.length) {
        await transaction.notificationEvent.deleteMany({ where: { notificationId: { in: notificationIds } } });
      }
      await transaction.orderNotification.deleteMany({ where: { shopOrderId: { in: shopOrderIds } } });
      if (paymentIds.length) {
        await transaction.paymentAuditEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
        await transaction.providerEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
      }
      await transaction.shopOrderLifecycleEvent.deleteMany({ where: { shopOrderId: { in: shopOrderIds } } });
      await transaction.payment.deleteMany({ where: { shopOrderId: { in: shopOrderIds } } });
      await transaction.shopOrderEvent.deleteMany({ where: { shopOrderId: { in: shopOrderIds } } });
      await transaction.stockReservation.deleteMany({ where: { shopOrderId: { in: shopOrderIds } } });
      await transaction.shopOrderItem.deleteMany({ where: { shopOrderId: { in: shopOrderIds } } });
      await transaction.shopOrder.deleteMany({ where: { id: { in: shopOrderIds } } });
    }
    if (productIds.length) {
      await transaction.productStockAdjustment.deleteMany({ where: { productId: { in: productIds } } });
      await transaction.productAuditEvent.deleteMany({ where: { productId: { in: productIds } } });
      await transaction.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (userIds.length) {
      await transaction.rateLimit.deleteMany({
        where: { key: { in: userIds.map((id) => `payments:checkout:${id}`) } },
      });
      await transaction.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });
}

async function assertFixturesAbsent(stage: string) {
  const ids = await fixtureIds();
  assert.deepEqual(ids, { shopOrderIds: [], productIds: [], userIds: [] }, `${stage}: Phase 3 fixtures remain.`);
  const providerEvents = await prisma.providerEvent.count({
    where: { providerEventId: { startsWith: `${FIXTURE_PREFIX}:` } },
  });
  const notifications = await prisma.orderNotification.count({
    where: { idempotencyKey: { contains: ":shop-" }, resourceReference: { startsWith: ORDER_NUMBER_PREFIX } },
  });
  assert.equal(providerEvents, 0, `${stage}: provider evidence remains.`);
  assert.equal(notifications, 0, `${stage}: notification fixtures remain.`);
}

async function ensureActors() {
  const now = new Date();
  const [member, admin] = await prisma.$transaction([
    prisma.user.create({
      data: {
        email: FIXTURE_EMAILS.member,
        emailVerified: true,
        emailVerifiedAt: now,
        displayName: "Phase 3 runtime Member",
        role: "MEMBER",
        status: "ACTIVE",
      },
      select: { id: true },
    }),
    prisma.user.create({
      data: {
        email: FIXTURE_EMAILS.admin,
        emailVerified: true,
        emailVerifiedAt: now,
        displayName: "Phase 3 runtime Admin",
        role: "ADMIN",
        status: "ACTIVE",
      },
      select: { id: true },
    }),
  ]);
  return { memberId: member.id, adminId: admin.id };
}

async function createFixture(
  actors: Awaited<ReturnType<typeof ensureActors>>,
  sequence: number,
  options: Readonly<{ initialStock?: number; quantity?: number; reservationMinutes?: number }> = {},
): Promise<Fixture> {
  const initialStock = options.initialStock ?? 9;
  const quantity = options.quantity ?? 2;
  const now = new Date();
  const reservationExpiresAt = new Date(now.getTime() + (options.reservationMinutes ?? 30) * 60_000);
  const orderNumber = `${ORDER_NUMBER_PREFIX}${String(sequence).padStart(4, "0")}`;
  const unitPriceCents = 2_500;
  const subtotalCents = unitPriceCents * quantity;
  const unitShippingCents = 500;
  const shippingCents = unitShippingCents * quantity;
  const totalCents = subtotalCents + shippingCents;
  const product = await prisma.product.create({
    data: {
      slug: `${FIXTURE_PRODUCT_SLUG_PREFIX}-${sequence}`,
      title: `Produit Phase 3 runtime ${sequence}`,
      description: "Fixture locale fictive pour la preuve PostgreSQL Phase 3.",
      status: "PUBLISHED",
      priceCents: unitPriceCents,
      trackInventory: true,
      stock: initialStock,
      shippingRequired: true,
      shippingPriceCents: unitShippingCents,
      position: sequence,
      publishedAt: now,
    },
    select: { id: true },
  });
  const shopOrder = await prisma.shopOrder.create({
    data: {
      orderNumber,
      userId: actors.memberId,
      creationToken: randomUUID(),
      requestFingerprintSha256: createHash("sha256").update(`${FIXTURE_PREFIX}:${sequence}`).digest("hex"),
      subtotalCents,
      shippingCents,
      totalCents,
      shippingRequired: true,
      shippingFirstName: "Membre",
      shippingLastName: "Fictif",
      shippingAddressLine1: "1 rue du Test",
      shippingPostalCode: "75001",
      shippingCity: "Paris",
      shippingCountryCode: "FR",
      reservationExpiresAt,
    },
    select: { id: true },
  });
  await prisma.shopOrderItem.create({
    data: {
      shopOrderId: shopOrder.id,
      productId: product.id,
      position: 0,
      productTitle: `Produit Phase 3 runtime ${sequence}`,
      inventoryTracked: true,
      unitPriceCents,
      quantity,
      lineTotalCents: subtotalCents,
      shippingRequired: true,
      unitShippingCents,
      lineShippingCents: shippingCents,
    },
  });
  const reservation = await prisma.stockReservation.create({
    data: {
      shopOrderId: shopOrder.id,
      productId: product.id,
      quantity,
      expiresAt: reservationExpiresAt,
    },
    select: { id: true },
  });
  await prisma.shopOrderEvent.createMany({ data: [
    {
      shopOrderId: shopOrder.id,
      type: "SHOP_ORDER_CREATED",
      actorUserId: actors.memberId,
      metadata: { source: "phase3-runtime" },
      occurredAt: now,
    },
    {
      shopOrderId: shopOrder.id,
      stockReservationId: reservation.id,
      type: "STOCK_RESERVED",
      actorUserId: actors.memberId,
      metadata: { productId: product.id, quantity },
      occurredAt: now,
    },
  ] });
  return {
    ...actors,
    productId: product.id,
    shopOrderId: shopOrder.id,
    orderNumber,
    reservationId: reservation.id,
    initialStock,
    quantity,
    totalCents,
    reservationExpiresAt,
  };
}

function successEvent(
  fixture: Fixture,
  input: Readonly<{
    provider: "STRIPE" | "PAYPAL";
    paymentId: string;
    providerCheckoutId: string;
    sequence: string;
    occurredAt?: Date;
  }>,
): ShopPaymentProviderEvent {
  return {
    eventId: `${FIXTURE_PREFIX}:${input.provider.toLowerCase()}:${input.sequence}`,
    type: input.provider === "STRIPE" ? "checkout.session.completed" : "PAYMENT.CAPTURE.COMPLETED",
    provider: input.provider,
    livemode: false,
    paymentId: input.paymentId,
    providerCheckoutId: input.providerCheckoutId,
    providerPaymentId: `${input.provider === "STRIPE" ? "pi" : "CAPTURE"}-${input.sequence}`,
    amountCents: fixture.totalCents,
    currency: "EUR",
    status: "SUCCEEDED",
    occurredAt: input.occurredAt ?? new Date(),
    paymentMethod: input.provider === "STRIPE" ? "CARD" : "PAYPAL",
  };
}

async function reserveAndRecord(
  fixture: Fixture,
  provider: "STRIPE" | "PAYPAL",
  providerCheckoutId: string,
) {
  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const attempt = await repository.reserveAttempt(
    fixture.memberId,
    fixture.orderNumber,
    provider,
    "TEST",
    true,
  );
  await repository.recordSession(attempt.paymentId, provider, {
    id: providerCheckoutId,
    url: `http://127.0.0.1:31760/mock/${provider.toLowerCase()}`,
  });
  return attempt;
}

async function assertPaymentOutcomeExactlyOnce(
  fixture: Fixture,
  expected: Readonly<{ notifications: number; lifecycleConfirmed: number; lifecycleReview: number; stock: number }>,
) {
  const [order, reservation, stockAdjustments, notifications, lifecycleConfirmed, lifecycleReview] = await Promise.all([
    prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.shopOrderId } }),
    prisma.stockReservation.findUniqueOrThrow({ where: { id: fixture.reservationId } }),
    prisma.productStockAdjustment.count({ where: { productId: fixture.productId } }),
    prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }),
    prisma.shopOrderLifecycleEvent.count({
      where: { shopOrderId: fixture.shopOrderId, type: "SHOP_PAYMENT_CONFIRMED" },
    }),
    prisma.shopOrderLifecycleEvent.count({
      where: { shopOrderId: fixture.shopOrderId, type: "SHOP_PAYMENT_REQUIRES_REVIEW" },
    }),
  ]);
  assert.equal(await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } }).then((row) => row.stock), expected.stock);
  assert.equal(stockAdjustments, order.paymentStatus === "PAID" ? 1 : 0);
  assert.equal(notifications, expected.notifications);
  if (expected.notifications >= 2) {
    assert.equal(await prisma.orderNotification.count({
      where: { shopOrderId: fixture.shopOrderId, kind: "OWNER_SHOP_ORDER_PAID" },
    }), 1);
    assert.equal(await prisma.orderNotification.count({
      where: { shopOrderId: fixture.shopOrderId, kind: "CUSTOMER_SHOP_PAYMENT_CONFIRMED" },
    }), 1);
  }
  assert.equal(lifecycleConfirmed, expected.lifecycleConfirmed);
  assert.equal(lifecycleReview, expected.lifecycleReview);
  assert.equal(reservation.status, order.paymentStatus === "PAID" ? "CONFIRMED" : reservation.status);
  return { order, reservation };
}

async function concurrentProviderWinnerRuntime(fixture: Fixture, passed: string[]) {
  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const stripe = await reserveAndRecord(fixture, "STRIPE", `cs-${fixture.orderNumber}`);
  const paypal = await reserveAndRecord(fixture, "PAYPAL", `PAYPAL-${fixture.orderNumber}`);
  const stripeEvent = successEvent(fixture, {
    provider: "STRIPE", paymentId: stripe.paymentId,
    providerCheckoutId: `cs-${fixture.orderNumber}`, sequence: `${fixture.orderNumber}:winner`,
  });
  const paypalEvent = successEvent(fixture, {
    provider: "PAYPAL", paymentId: paypal.paymentId,
    providerCheckoutId: `PAYPAL-${fixture.orderNumber}`, sequence: `${fixture.orderNumber}:winner`,
  });

  const results = await Promise.all([
    repository.reconcile(stripeEvent),
    repository.reconcile(paypalEvent),
  ]);
  assert.equal(results.filter((result) => result.shopOrderPaid).length, 1);
  assert.equal(results.filter((result) => result.outcome === "REQUIRES_REVIEW").length, 1);
  const payments = await prisma.payment.findMany({ where: { shopOrderId: fixture.shopOrderId } });
  assert.ok(payments.every((payment) => payment.orderId === null && payment.shopOrderId === fixture.shopOrderId));
  assert.equal(payments.filter((payment) => payment.status === "SUCCEEDED").length, 1);
  assert.equal(payments.filter((payment) => payment.status === "REQUIRES_REVIEW").length, 1);
  const reviewedCapture = payments.find((payment) => payment.status === "REQUIRES_REVIEW");
  assert.ok(reviewedCapture?.paidAt, "The second authentic capture must retain its provider-paid timestamp.");
  assert.ok(reviewedCapture.providerPaymentId, "The second authentic capture must retain its provider payment id.");
  assert.ok(reviewedCapture.paymentMethod, "The second authentic capture must retain its payment method.");
  const state = await assertPaymentOutcomeExactlyOnce(fixture, {
    notifications: 2,
    lifecycleConfirmed: 1,
    lifecycleReview: 1,
    stock: fixture.initialStock - fixture.quantity,
  });
  assert.equal(state.order.paymentStatus, "PAID");
  assert.ok(state.order.paymentReviewAt);
  assert.equal(state.reservation.status, "CONFIRMED");
  assert.equal(await prisma.shopOrderEvent.count({
    where: { shopOrderId: fixture.shopOrderId, type: "STOCK_CONFIRMED" },
  }), 1);
  assert.deepEqual(
    (await Promise.all([
      repository.reconcile(stripeEvent),
      repository.reconcile(paypalEvent),
    ])).map((result) => result.duplicate),
    [true, true],
  );
  await assertPaymentOutcomeExactlyOnce(fixture, {
    notifications: 2,
    lifecycleConfirmed: 1,
    lifecycleReview: 1,
    stock: fixture.initialStock - fixture.quantity,
  });
  await assert.rejects(
    () => markShopOrderPreparing(fixture.orderNumber, fixture.adminId),
    (error: unknown) => error instanceof ShopFulfillmentError && error.code === "PAYMENT_REQUIRED",
  );
  assert.equal(
    await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.shopOrderId } }).then((order) => order.fulfillmentStatus),
    "PENDING",
  );
  passed.push("PostgreSQL serializes concurrent Stripe/PayPal success and preserves one winner");
  passed.push("duplicate Stripe/PayPal provider events do not repeat stock, lifecycle or notifications");
  passed.push("an open financial review blocks fulfillment even after one provider won");
}

async function disabledAfterAttemptAndFulfillmentRuntime(fixture: Fixture, passed: string[]) {
  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const previousShopEnabled = process.env.SHOP_ENABLED;
  const previousShopPaymentsEnabled = process.env.SHOP_PAYMENTS_ENABLED;
  process.env.SHOP_ENABLED = "true";
  process.env.SHOP_PAYMENTS_ENABLED = "true";
  try {
    const attempt = await reserveAndRecord(fixture, "STRIPE", `cs-${fixture.orderNumber}`);
    const event = successEvent(fixture, {
      provider: "STRIPE",
      paymentId: attempt.paymentId,
      providerCheckoutId: `cs-${fixture.orderNumber}`,
      sequence: `${fixture.orderNumber}:disabled-after-attempt`,
    });
    process.env.SHOP_ENABLED = "false";
    process.env.SHOP_PAYMENTS_ENABLED = "false";
    const reconciled = await repository.reconcile(event);
    assert.equal(reconciled.shopOrderPaid, true);
  } finally {
    if (previousShopEnabled === undefined) delete process.env.SHOP_ENABLED;
    else process.env.SHOP_ENABLED = previousShopEnabled;
    if (previousShopPaymentsEnabled === undefined) delete process.env.SHOP_PAYMENTS_ENABLED;
    else process.env.SHOP_PAYMENTS_ENABLED = previousShopPaymentsEnabled;
  }
  const state = await assertPaymentOutcomeExactlyOnce(fixture, {
    notifications: 2,
    lifecycleConfirmed: 1,
    lifecycleReview: 0,
    stock: fixture.initialStock - fixture.quantity,
  });
  assert.equal(state.order.paymentStatus, "PAID");
  assert.equal(state.order.paymentReviewAt, null);
  passed.push("persisted provider evidence reconciles after SHOP_ENABLED and SHOP_PAYMENTS_ENABLED close");

  await assert.rejects(
    () => markShopOrderPreparing(fixture.orderNumber, fixture.memberId),
    (error: unknown) => error instanceof ShopFulfillmentError && error.code === "ACTOR_NOT_ADMIN",
  );
  await markShopOrderPreparing(fixture.orderNumber, fixture.adminId);
  await markShopOrderPreparing(fixture.orderNumber, fixture.adminId);
  await markShopOrderShipped(fixture.orderNumber, fixture.adminId, {
    carrier: "Transporteur fictif",
    trackingNumber: "QA-PHASE3-0001",
    trackingUrl: "https://example.invalid/tracking/QA-PHASE3-0001",
  });
  await markShopOrderShipped(fixture.orderNumber, fixture.adminId, {
    carrier: "Autre valeur ignorée par idempotence",
    trackingNumber: null,
    trackingUrl: null,
  });
  const fulfilled = await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.shopOrderId } });
  assert.equal(fulfilled.fulfillmentStatus, "SHIPPED");
  assert.equal(fulfilled.shippingCarrier, "Transporteur fictif");
  assert.equal(fulfilled.trackingNumber, "QA-PHASE3-0001");
  assert.equal(await prisma.shopOrderLifecycleEvent.count({
    where: { shopOrderId: fixture.shopOrderId, type: "PREPARATION_STARTED" },
  }), 1);
  assert.equal(await prisma.shopOrderLifecycleEvent.count({
    where: { shopOrderId: fixture.shopOrderId, type: "ORDER_SHIPPED" },
  }), 1);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }), 4);
  assert.equal(await prisma.orderNotification.count({
    where: { shopOrderId: fixture.shopOrderId, kind: "CUSTOMER_SHOP_PREPARING" },
  }), 1);
  assert.equal(await prisma.orderNotification.count({
    where: { shopOrderId: fixture.shopOrderId, kind: "CUSTOMER_SHOP_SHIPPED" },
  }), 1);
  passed.push("ADMIN PREPARING/SHIPPED transitions and notifications are idempotent");
}

async function lateCaptureRuntime(fixture: Fixture, passed: string[]) {
  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const attempt = await reserveAndRecord(fixture, "PAYPAL", `PAYPAL-${fixture.orderNumber}`);
  const expiration = new Date(fixture.reservationExpiresAt.getTime() + 1_000);
  assert.equal(await expireShopOrderReservations(expiration, 10), 1);
  const event = successEvent(fixture, {
    provider: "PAYPAL",
    paymentId: attempt.paymentId,
    providerCheckoutId: `PAYPAL-${fixture.orderNumber}`,
    sequence: `${fixture.orderNumber}:late-capture`,
    occurredAt: new Date(expiration.getTime() + 1_000),
  });
  const result = await repository.reconcile(event, event.occurredAt);
  assert.equal(result.outcome, "REQUIRES_REVIEW");
  assert.equal(result.reviewCode, "SHOP_RESERVATION_EXPIRED_AFTER_CAPTURE");
  assert.equal(result.shopOrderPaid, false);
  assert.equal(result.stockConfirmed, false);
  const [order, payment, reservation, providerEvent] = await Promise.all([
    prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.shopOrderId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: attempt.paymentId } }),
    prisma.stockReservation.findUniqueOrThrow({ where: { id: fixture.reservationId } }),
    prisma.providerEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: "PAYPAL", providerEventId: event.eventId } },
    }),
  ]);
  assert.equal(order.status, "EXPIRED");
  assert.equal(order.paymentStatus, "AWAITING_PAYMENT");
  assert.equal(order.fulfillmentStatus, "PENDING");
  assert.equal(order.paidAt, null);
  assert.ok(order.paymentReviewAt);
  assert.equal(order.paymentReviewCode, "SHOP_RESERVATION_EXPIRED_AFTER_CAPTURE");
  assert.equal(payment.status, "SUCCEEDED", "Authentic captured money remains financial truth.");
  assert.ok(payment.paidAt);
  assert.equal(payment.failureCode, "SHOP_RESERVATION_EXPIRED_AFTER_CAPTURE");
  assert.equal(reservation.status, "EXPIRED");
  assert.equal(providerEvent.outcome, "REQUIRES_REVIEW");
  assert.equal(await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } }).then((row) => row.stock), fixture.initialStock);
  assert.equal(await prisma.productStockAdjustment.count({ where: { productId: fixture.productId } }), 0);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }), 0);
  assert.equal(await prisma.shopOrderLifecycleEvent.count({
    where: { shopOrderId: fixture.shopOrderId, type: "SHOP_PAYMENT_REQUIRES_REVIEW" },
  }), 1);
  const replay = await repository.reconcile(event, event.occurredAt);
  assert.equal(replay.duplicate, true);
  assert.equal(await prisma.providerEvent.count({
    where: { provider: "PAYPAL", providerEventId: event.eventId },
  }), 1);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }), 0);
  passed.push("late authentic capture preserves Payment/evidence and review without stock, fulfillment or notification");
}

async function terminalAttemptWithPendingSiblingRuntime(
  fixture: Fixture,
  terminalStatus: "FAILED" | "EXPIRED",
  passed: string[],
) {
  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const firstCheckoutId = `cs-terminal-a-${terminalStatus.toLowerCase()}-${fixture.orderNumber}`;
  const secondCheckoutId = `cs-terminal-b-${terminalStatus.toLowerCase()}-${fixture.orderNumber}`;
  const first = await reserveAndRecord(fixture, "STRIPE", firstCheckoutId);
  const terminalAt = new Date(Date.now() + 1_000);
  const terminalEvent: ShopPaymentProviderEvent = {
    eventId: `${FIXTURE_PREFIX}:stripe:${fixture.orderNumber}:${terminalStatus.toLowerCase()}`,
    type: terminalStatus === "FAILED" ? "payment_intent.payment_failed" : "checkout.session.expired",
    provider: "STRIPE",
    livemode: false,
    paymentId: first.paymentId,
    providerCheckoutId: firstCheckoutId,
    status: terminalStatus,
    occurredAt: terminalAt,
    failureCode: terminalStatus === "FAILED" ? "SHOP_PAYMENT_FAILED" : "SHOP_CHECKOUT_EXPIRED",
  };
  const terminal = await repository.reconcile(terminalEvent, terminalAt);
  assert.equal(terminal.outcome, "PROCESSED");
  assert.equal(terminal.shopOrderPaid, false);

  const second = await reserveAndRecord(fixture, "STRIPE", secondCheckoutId);
  assert.notEqual(second.paymentId, first.paymentId);
  assert.equal(
    await prisma.payment.findUniqueOrThrow({ where: { id: second.paymentId } }).then((payment) => payment.status),
    "PENDING",
  );

  const capturedAt = new Date(terminalAt.getTime() + 1_000);
  const lateMismatchEvent: ShopPaymentProviderEvent = {
    ...successEvent(fixture, {
      provider: "STRIPE",
      paymentId: first.paymentId,
      providerCheckoutId: firstCheckoutId,
      sequence: `${fixture.orderNumber}:${terminalStatus.toLowerCase()}:late-mismatch`,
      occurredAt: capturedAt,
    }),
    amountCents: fixture.totalCents + 1,
  };
  const reviewed = await repository.reconcile(lateMismatchEvent, capturedAt);
  assert.equal(reviewed.outcome, "REQUIRES_REVIEW");
  assert.equal(reviewed.reviewCode, "SHOP_PAYMENT_EVIDENCE_MISMATCH");
  assert.equal(reviewed.shopOrderPaid, false);
  assert.equal(reviewed.stockConfirmed, false);

  const [order, firstPayment, secondPayment, receipt, reservation] = await Promise.all([
    prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.shopOrderId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: first.paymentId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: second.paymentId } }),
    prisma.providerEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: {
          provider: "STRIPE",
          providerEventId: lateMismatchEvent.eventId,
        },
      },
    }),
    prisma.stockReservation.findUniqueOrThrow({ where: { id: fixture.reservationId } }),
  ]);
  assert.equal(order.status, "OPEN");
  assert.equal(order.paymentStatus, "AWAITING_PAYMENT");
  assert.equal(order.fulfillmentStatus, "PENDING");
  assert.ok(order.paymentReviewAt);
  assert.equal(order.paymentReviewCode, "SHOP_PAYMENT_EVIDENCE_MISMATCH");
  assert.equal(firstPayment.status, "REQUIRES_REVIEW");
  assert.ok(firstPayment.paidAt, "The late captured attempt must retain its authentic paid timestamp.");
  assert.equal(firstPayment.providerPaymentId, lateMismatchEvent.providerPaymentId);
  assert.equal(firstPayment.paymentMethod, lateMismatchEvent.paymentMethod);
  assert.equal(firstPayment.failureCode, "SHOP_PAYMENT_EVIDENCE_MISMATCH");
  assert.equal(secondPayment.status, "CANCELED");
  assert.equal(secondPayment.paidAt, null);
  assert.ok(secondPayment.canceledAt);
  assert.equal(secondPayment.failureCode, "SHOP_PAYMENT_SUPERSEDED_BY_REVIEW");
  assert.equal(receipt.paymentId, first.paymentId);
  assert.equal(receipt.outcome, "REQUIRES_REVIEW");
  assert.equal(
    receipt.objectId,
    lateMismatchEvent.providerPaymentId,
    "The linked immutable ProviderEvent must retain the mismatched provider evidence for review.",
  );
  assert.equal(reservation.status, "ACTIVE");
  assert.equal(
    await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } }).then((product) => product.stock),
    fixture.initialStock,
  );
  assert.equal(await prisma.productStockAdjustment.count({ where: { productId: fixture.productId } }), 0);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }), 0);
  assert.equal(await prisma.shopOrderLifecycleEvent.count({
    where: { shopOrderId: fixture.shopOrderId, type: "SHOP_PAYMENT_REQUIRES_REVIEW" },
  }), 1);

  const replay = await repository.reconcile(lateMismatchEvent, capturedAt);
  assert.equal(replay.duplicate, true);
  assert.equal(await prisma.providerEvent.count({
    where: { provider: "STRIPE", providerEventId: lateMismatchEvent.eventId },
  }), 1);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }), 0);
  assert.equal(
    await prisma.payment.findUniqueOrThrow({ where: { id: second.paymentId } }).then((payment) => payment.status),
    "CANCELED",
  );
  passed.push(`${terminalStatus} attempt late mismatch closes its same-provider PENDING sibling and persists review`);
}

async function cancellationVsCaptureRuntime(fixture: Fixture, passed: string[]) {
  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const attempt = await reserveAndRecord(fixture, "STRIPE", `cs-${fixture.orderNumber}`);
  const event = successEvent(fixture, {
    provider: "STRIPE",
    paymentId: attempt.paymentId,
    providerCheckoutId: `cs-${fixture.orderNumber}`,
    sequence: `${fixture.orderNumber}:cancel-race`,
  });

  const [cancellation, reconciliation] = await Promise.allSettled([
    releaseShopOrderReservation(fixture.shopOrderId, event.occurredAt),
    repository.reconcile(event, event.occurredAt),
  ]);
  const [order, payment, reservation, stockAdjustments, notifications] = await Promise.all([
    prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.shopOrderId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: attempt.paymentId } }),
    prisma.stockReservation.findUniqueOrThrow({ where: { id: fixture.reservationId } }),
    prisma.productStockAdjustment.count({ where: { productId: fixture.productId } }),
    prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }),
  ]);
  assert.ok(payment.paidAt, "Authentic provider capture evidence must be retained in either serialization order.");

  if (order.paymentStatus === "PAID") {
    assert.equal(order.status, "OPEN");
    assert.equal(order.fulfillmentStatus, "PENDING");
    assert.equal(reservation.status, "CONFIRMED");
    assert.equal(stockAdjustments, 1);
    assert.equal(notifications, 2);
    assert.equal(reconciliation.status, "fulfilled");
    assert.equal(reconciliation.value.shopOrderPaid, true);
    assert.equal(cancellation.status, "rejected");
    assert.ok(cancellation.reason instanceof ShopServiceError);
    assert.ok(["RESERVATION_CONFIRMED", "PAYMENT_REVIEW_REQUIRED"].includes(cancellation.reason.code));
  } else {
    assert.equal(order.status, "CANCELLED");
    assert.equal(order.paymentStatus, "CANCELLED");
    assert.equal(order.fulfillmentStatus, "CANCELLED");
    assert.equal(reservation.status, "RELEASED");
    assert.equal(stockAdjustments, 0);
    assert.equal(notifications, 0);
    assert.ok(order.paymentReviewAt);
    assert.equal(cancellation.status, "fulfilled");
    assert.equal(reconciliation.status, "fulfilled");
    assert.equal(reconciliation.value.outcome, "REQUIRES_REVIEW");
    assert.equal(reconciliation.value.shopOrderPaid, false);
  }
  assert.notEqual(
    order.status === "CANCELLED" && stockAdjustments > 0,
    true,
    "A cancellation must never overwrite a committed paid/stock-confirmed order.",
  );
  passed.push("member cancellation and authentic capture serialize without paid-CANCELLED state");
}

async function openReviewBarrierRuntime(fixture: Fixture, passed: string[]) {
  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const stripe = await reserveAndRecord(fixture, "STRIPE", `cs-${fixture.orderNumber}`);
  const paypal = await reserveAndRecord(fixture, "PAYPAL", `PAYPAL-${fixture.orderNumber}`);
  const mismatched = successEvent(fixture, {
    provider: "STRIPE",
    paymentId: stripe.paymentId,
    providerCheckoutId: `cs-${fixture.orderNumber}`,
    sequence: `${fixture.orderNumber}:review-first`,
  });
  const first = await repository.reconcile({
    ...mismatched,
    amountCents: fixture.totalCents + 1,
  });
  assert.equal(first.outcome, "REQUIRES_REVIEW");
  assert.equal(first.reviewCode, "SHOP_PAYMENT_EVIDENCE_MISMATCH");
  await assert.rejects(
    () => repository.reservePaypalCapture(
      fixture.memberId,
      fixture.orderNumber,
      `PAYPAL-${fixture.orderNumber}`,
      "TEST",
    ),
    (error: unknown) => error instanceof Error && "code" in error,
  );

  const second = await repository.reconcile(successEvent(fixture, {
    provider: "PAYPAL",
    paymentId: paypal.paymentId,
    providerCheckoutId: `PAYPAL-${fixture.orderNumber}`,
    sequence: `${fixture.orderNumber}:review-second`,
  }));
  assert.equal(second.outcome, "REQUIRES_REVIEW");
  assert.equal(second.reviewCode, "SHOP_PAYMENT_ALREADY_CAPTURED");
  assert.equal(second.shopOrderPaid, false);

  const [order, payments, reservation] = await Promise.all([
    prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.shopOrderId } }),
    prisma.payment.findMany({ where: { shopOrderId: fixture.shopOrderId }, orderBy: { provider: "asc" } }),
    prisma.stockReservation.findUniqueOrThrow({ where: { id: fixture.reservationId } }),
  ]);
  assert.equal(order.status, "OPEN");
  assert.equal(order.paymentStatus, "AWAITING_PAYMENT");
  assert.equal(order.fulfillmentStatus, "PENDING");
  assert.ok(order.paymentReviewAt);
  assert.equal(reservation.status, "ACTIVE");
  assert.equal(payments.length, 2);
  assert.ok(payments.every((payment) => payment.status === "REQUIRES_REVIEW" && payment.paidAt !== null));
  assert.equal(await prisma.providerEvent.count({ where: { paymentId: { in: payments.map(({ id }) => id) } } }), 2);
  assert.equal(await prisma.shopOrderLifecycleEvent.count({
    where: { shopOrderId: fixture.shopOrderId, type: "SHOP_PAYMENT_REQUIRES_REVIEW" },
  }), 2);
  assert.equal(await prisma.productStockAdjustment.count({ where: { productId: fixture.productId } }), 0);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }), 0);
  passed.push("an open financial review persists a later provider capture without stock or notification");
}

async function assertSignedMismatchReview(
  fixture: Fixture,
  input: Readonly<{
    paymentId: string;
    eventId: string;
    provider: "STRIPE" | "PAYPAL";
    providerObjectId: string;
  }>,
) {
  const [order, payment, receipt, reservation] = await Promise.all([
    prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.shopOrderId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: input.paymentId } }),
    prisma.providerEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: {
          provider: input.provider,
          providerEventId: input.eventId,
        },
      },
    }),
    prisma.stockReservation.findUniqueOrThrow({ where: { id: fixture.reservationId } }),
  ]);
  assert.equal(order.status, "OPEN");
  assert.equal(order.paymentStatus, "AWAITING_PAYMENT");
  assert.equal(order.fulfillmentStatus, "PENDING");
  assert.ok(order.paymentReviewAt);
  assert.equal(order.paymentReviewCode, "SHOP_PAYMENT_EVIDENCE_MISMATCH");
  assert.equal(payment.status, "REQUIRES_REVIEW");
  assert.ok(payment.paidAt, "Authentic signed success evidence must retain its provider-paid timestamp.");
  assert.equal(payment.failureCode, "SHOP_PAYMENT_EVIDENCE_MISMATCH");
  assert.equal(receipt.paymentId, payment.id);
  assert.equal(receipt.outcome, "REQUIRES_REVIEW");
  assert.equal(receipt.objectId, input.providerObjectId);
  assert.equal(reservation.status, "ACTIVE");
  assert.equal(await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } }).then((row) => row.stock), fixture.initialStock);
  assert.equal(await prisma.productStockAdjustment.count({ where: { productId: fixture.productId } }), 0);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }), 0);
}

async function stripeSignedMismatchRuntime(
  fixture: Fixture,
  misleadingFixture: Fixture,
  passed: string[],
) {
  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const checkoutId = `cs-mismatch-${fixture.orderNumber}`;
  const providerPaymentId = `pi-mismatch-${fixture.orderNumber}`;
  const stripe = await reserveAndRecord(fixture, "STRIPE", checkoutId);
  const paypal = await reserveAndRecord(fixture, "PAYPAL", `PAYPAL-${fixture.orderNumber}`);
  const misleadingStripe = await reserveAndRecord(
    misleadingFixture,
    "STRIPE",
    `cs-metadata-source-${misleadingFixture.orderNumber}`,
  );
  const eventId = `${FIXTURE_PREFIX}:stripe:${fixture.orderNumber}:signed-mismatch`;
  const occurredAt = new Date(Date.now() + 2_000);
  const rawEvent = {
    id: eventId,
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(occurredAt.getTime() / 1_000),
    data: {
      object: {
        id: checkoutId,
        object: "checkout.session",
        mode: "payment",
        livemode: false,
        client_reference_id: misleadingFixture.shopOrderId,
        metadata: {
          paymentSource: "SHOP_ORDER",
          paymentId: misleadingStripe.paymentId,
          shopOrderId: misleadingFixture.shopOrderId,
          pricingVersion: SHOP_PAYMENT_PRICING_VERSION,
        },
        amount_total: fixture.totalCents,
        currency: "eur",
        payment_status: "paid",
        status: "complete",
        payment_intent: providerPaymentId,
      },
    },
  } as const;
  const sourced = await resolveShopStripePaymentSource(rawEvent);
  assert.equal("shopPaymentSourceResolved" in sourced && sourced.shopPaymentSourceResolved, true);
  assert.equal("shopResolvedPaymentId" in sourced ? sourced.shopResolvedPaymentId : null, stripe.paymentId);
  assert.equal("shopResolvedOrderId" in sourced ? sourced.shopResolvedOrderId : null, fixture.shopOrderId);
  const enriched = await enrichShopStripeWebhookEvent(
    sourced,
    { mode: "test", secretKey: "sk_test_not_used" },
    async (requestedCheckoutId) => {
      assert.equal(requestedCheckoutId, checkoutId);
      return {
        ...rawEvent.data.object,
        amount_total: fixture.totalCents,
        currency: "eur",
        payment_intent: {
          id: providerPaymentId,
          object: "payment_intent",
          livemode: false,
          status: "succeeded",
          amount: fixture.totalCents,
          currency: "eur",
          metadata: {
            paymentSource: "SHOP_ORDER",
            paymentId: misleadingStripe.paymentId,
            shopOrderId: misleadingFixture.shopOrderId,
            pricingVersion: SHOP_PAYMENT_PRICING_VERSION,
          },
          payment_method: { id: `pm-${fixture.orderNumber}`, object: "payment_method", type: "card" },
        },
      };
    },
  );
  const mismatch = await processVerifiedShopStripeWebhookEvent(enriched, repository);
  const replay = await processVerifiedShopStripeWebhookEvent(enriched, repository);
  assert.equal(mismatch.outcome, "REQUIRES_REVIEW");
  assert.equal(mismatch.reviewCode, "SHOP_PAYMENT_EVIDENCE_MISMATCH");
  assert.equal(mismatch.duplicate, false);
  assert.equal(replay.duplicate, true);
  await assertSignedMismatchReview(fixture, {
    paymentId: stripe.paymentId,
    eventId,
    provider: "STRIPE",
    providerObjectId: providerPaymentId,
  });

  const laterProvider = await repository.reconcile(successEvent(fixture, {
    provider: "PAYPAL",
    paymentId: paypal.paymentId,
    providerCheckoutId: `PAYPAL-${fixture.orderNumber}`,
    sequence: `${fixture.orderNumber}:after-stripe-mismatch`,
  }));
  assert.equal(laterProvider.outcome, "REQUIRES_REVIEW");
  assert.equal(laterProvider.reviewCode, "SHOP_PAYMENT_ALREADY_CAPTURED");
  const laterPayment = await prisma.payment.findUniqueOrThrow({ where: { id: paypal.paymentId } });
  assert.equal(laterPayment.status, "REQUIRES_REVIEW");
  assert.ok(laterPayment.paidAt);
  assert.equal(await prisma.productStockAdjustment.count({ where: { productId: fixture.productId } }), 0);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }), 0);
  const [misleadingOrder, misleadingPayment] = await Promise.all([
    prisma.shopOrder.findUniqueOrThrow({ where: { id: misleadingFixture.shopOrderId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: misleadingStripe.paymentId } }),
  ]);
  assert.equal(misleadingOrder.paymentStatus, "AWAITING_PAYMENT");
  assert.equal(misleadingOrder.paymentReviewAt, null);
  assert.equal(misleadingPayment.status, "PENDING");
  assert.equal(misleadingPayment.paidAt, null);
  assert.equal(await prisma.productStockAdjustment.count({ where: { productId: misleadingFixture.productId } }), 0);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: misleadingFixture.shopOrderId } }), 0);
  passed.push("signed Stripe metadata/source mismatch resolves by persisted checkout, stays linked and blocks a later provider winner");
}

async function paypalSignedMismatchRuntime(fixture: Fixture, passed: string[]) {
  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const providerOrderId = `PAYPAL-MISMATCH-${fixture.orderNumber}`;
  const providerPaymentId = `CAPTURE-MISMATCH-${fixture.orderNumber}`;
  const paypal = await reserveAndRecord(fixture, "PAYPAL", providerOrderId);
  const stripe = await reserveAndRecord(fixture, "STRIPE", `cs-${fixture.orderNumber}`);
  const eventId = `${FIXTURE_PREFIX}:paypal:${fixture.orderNumber}:signed-mismatch`;
  const event = {
    id: eventId,
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    create_time: new Date().toISOString(),
    resource: {
      id: providerPaymentId,
      status: "COMPLETED",
      custom_id: paypal.paymentId,
      amount: {
        currency_code: "USD",
        value: `${Math.floor(fixture.totalCents / 100)}.${String((fixture.totalCents % 100) + 1).padStart(2, "0")}`,
      },
      supplementary_data: { related_ids: { order_id: providerOrderId } },
    },
  } as const;
  const dependencies = {
    sourceLookup: createPaypalPaymentSourceLookup(),
    shopRepository: repository,
  };
  const mismatch = await processVerifiedPaypalWebhookEventByPaymentSource(event, "sandbox", dependencies);
  const replay = await processVerifiedPaypalWebhookEventByPaymentSource(event, "sandbox", dependencies);
  assert.equal(mismatch.outcome, "REQUIRES_REVIEW");
  assert.ok("shopOrderPaid" in mismatch, "The persisted Shop Payment must use Shop reconciliation.");
  assert.equal(mismatch.reviewCode, "SHOP_PAYMENT_EVIDENCE_MISMATCH");
  assert.equal(mismatch.duplicate, false);
  assert.equal(replay.duplicate, true);
  await assertSignedMismatchReview(fixture, {
    paymentId: paypal.paymentId,
    eventId,
    provider: "PAYPAL",
    providerObjectId: providerPaymentId,
  });

  const laterProvider = await repository.reconcile(successEvent(fixture, {
    provider: "STRIPE",
    paymentId: stripe.paymentId,
    providerCheckoutId: `cs-${fixture.orderNumber}`,
    sequence: `${fixture.orderNumber}:after-paypal-mismatch`,
  }));
  assert.equal(laterProvider.outcome, "REQUIRES_REVIEW");
  assert.equal(laterProvider.reviewCode, "SHOP_PAYMENT_ALREADY_CAPTURED");
  const laterPayment = await prisma.payment.findUniqueOrThrow({ where: { id: stripe.paymentId } });
  assert.equal(laterPayment.status, "REQUIRES_REVIEW");
  assert.ok(laterPayment.paidAt);
  assert.equal(await prisma.productStockAdjustment.count({ where: { productId: fixture.productId } }), 0);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }), 0);
  passed.push("signed PayPal amount/currency mismatch stays linked, idempotent and blocks a later provider winner");
}

async function financialReviewVsFulfillmentRuntime(fixture: Fixture, passed: string[]) {
  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const attempt = await reserveAndRecord(fixture, "STRIPE", `cs-${fixture.orderNumber}`);
  const paymentEvent = successEvent(fixture, {
    provider: "STRIPE",
    paymentId: attempt.paymentId,
    providerCheckoutId: `cs-${fixture.orderNumber}`,
    sequence: `${fixture.orderNumber}:financial-race-winner`,
  });
  assert.equal((await repository.reconcile(paymentEvent)).shopOrderPaid, true);
  const providerPaymentId = paymentEvent.providerPaymentId;
  assert.ok(providerPaymentId);
  const financialEventId = `${FIXTURE_PREFIX}:stripe:${fixture.orderNumber}:refund-race`;
  const financialEvent = {
    id: financialEventId,
    type: "refund.created",
    livemode: false,
    created: Math.floor(Date.now() / 1_000) + 1,
    data: {
      object: {
        id: `re-${fixture.orderNumber}`,
        object: "refund",
        status: "succeeded",
        amount: fixture.totalCents,
        currency: "eur",
        payment_intent: providerPaymentId,
      },
    },
  } as const;

  const [fulfillment, financial] = await Promise.allSettled([
    markShopOrderPreparing(fixture.orderNumber, fixture.adminId),
    processVerifiedStripeFinancialEvent(financialEvent),
  ]);
  assert.equal(financial.status, "fulfilled");
  assert.equal(financial.value.outcome, "REQUIRES_REVIEW");
  assert.equal(financial.value.duplicate, false);
  if (fulfillment.status === "rejected") {
    assert.ok(fulfillment.reason instanceof ShopFulfillmentError);
    assert.equal(fulfillment.reason.code, "PAYMENT_REQUIRED");
  }

  const [order, payment, receipt] = await Promise.all([
    prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.shopOrderId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: attempt.paymentId } }),
    prisma.providerEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: "STRIPE", providerEventId: financialEventId } },
    }),
  ]);
  assert.equal(order.paymentStatus, "PAID");
  assert.ok(order.paymentReviewAt);
  assert.equal(order.paymentReviewCode, "SHOP_PROVIDER_FINANCIAL_EVENT_REVIEW");
  assert.ok(order.fulfillmentStatus === "PENDING" || order.fulfillmentStatus === "PREPARING");
  assert.equal(payment.status, "SUCCEEDED");
  assert.equal(receipt.paymentId, payment.id);
  assert.equal(receipt.outcome, "REQUIRES_REVIEW");
  assert.equal(await prisma.refundAttempt.count({ where: { paymentId: payment.id } }), 0);
  assert.equal(await prisma.productStockAdjustment.count({ where: { productId: fixture.productId } }), 1);
  assert.equal(await prisma.shopOrderLifecycleEvent.count({
    where: { shopOrderId: fixture.shopOrderId, type: "SHOP_PAYMENT_REQUIRES_REVIEW" },
  }), 1);
  const preparingNotifications = order.fulfillmentStatus === "PREPARING" ? 1 : 0;
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }), 2 + preparingNotifications);
  await assert.rejects(
    () => markShopOrderShipped(fixture.orderNumber, fixture.adminId, {
      carrier: "Transporteur fictif",
      trackingNumber: "QA-FINANCIAL-REVIEW",
      trackingUrl: "https://example.invalid/tracking/QA-FINANCIAL-REVIEW",
    }),
    (error: unknown) => error instanceof ShopFulfillmentError && error.code === "PAYMENT_REQUIRED",
  );
  const replay = await processVerifiedStripeFinancialEvent(financialEvent);
  assert.equal(replay.duplicate, true);
  assert.equal(await prisma.providerEvent.count({
    where: { provider: "STRIPE", providerEventId: financialEventId },
  }), 1);
  passed.push("Shop financial review and ADMIN fulfillment serialize without shipment, refund mutation or duplicate evidence");
}

async function assertMalformedFinancialReview(
  fixture: Fixture,
  input: Readonly<{
    paymentId: string;
    eventId: string;
    provider: "STRIPE" | "PAYPAL";
    providerObjectId: string;
  }>,
) {
  const [order, payment, receipt] = await Promise.all([
    prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.shopOrderId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: input.paymentId } }),
    prisma.providerEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: {
          provider: input.provider,
          providerEventId: input.eventId,
        },
      },
    }),
  ]);
  assert.equal(order.paymentStatus, "PAID");
  assert.equal(order.fulfillmentStatus, "PENDING");
  assert.ok(order.paymentReviewAt);
  assert.equal(order.paymentReviewCode, "SHOP_PROVIDER_FINANCIAL_EVENT_REVIEW");
  assert.equal(payment.status, "SUCCEEDED");
  assert.equal(receipt.paymentId, input.paymentId);
  assert.equal(receipt.outcome, "REQUIRES_REVIEW");
  assert.equal(receipt.objectId, input.providerObjectId);
  assert.equal(await prisma.refundAttempt.count({ where: { paymentId: input.paymentId } }), 0);
  assert.equal(await prisma.productStockAdjustment.count({ where: { productId: fixture.productId } }), 1);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }), 2);
  assert.equal(await prisma.shopOrderLifecycleEvent.count({
    where: { shopOrderId: fixture.shopOrderId, type: "SHOP_PAYMENT_REQUIRES_REVIEW" },
  }), 1);
}

async function malformedFinancialEvidenceRuntime(
  stripeFixture: Fixture,
  paypalFixture: Fixture,
  passed: string[],
) {
  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const stripeAttempt = await reserveAndRecord(stripeFixture, "STRIPE", `cs-${stripeFixture.orderNumber}`);
  const stripeSuccess = successEvent(stripeFixture, {
    provider: "STRIPE",
    paymentId: stripeAttempt.paymentId,
    providerCheckoutId: `cs-${stripeFixture.orderNumber}`,
    sequence: `${stripeFixture.orderNumber}:malformed-refund-winner`,
  });
  assert.equal((await repository.reconcile(stripeSuccess)).shopOrderPaid, true);
  assert.ok(stripeSuccess.providerPaymentId);
  const stripeEventId = `${FIXTURE_PREFIX}:stripe:${stripeFixture.orderNumber}:malformed-refund`;
  const malformedStripeRefund = {
    id: stripeEventId,
    type: "refund.updated",
    livemode: false,
    created: Math.floor(Date.now() / 1_000) + 1,
    data: {
      object: {
        id: `re-malformed-${stripeFixture.orderNumber}`,
        object: "refund",
        status: "succeeded",
        amount: "invalid",
        currency: "usd",
        payment_intent: stripeSuccess.providerPaymentId,
      },
    },
  } as const;
  const stripeReview = await processVerifiedStripeFinancialEvent(malformedStripeRefund);
  assert.equal(stripeReview.outcome, "REQUIRES_REVIEW");
  assert.equal(stripeReview.duplicate, false);
  assert.equal((await processVerifiedStripeFinancialEvent(malformedStripeRefund)).duplicate, true);
  await assertMalformedFinancialReview(stripeFixture, {
    paymentId: stripeAttempt.paymentId,
    eventId: stripeEventId,
    provider: "STRIPE",
    providerObjectId: malformedStripeRefund.data.object.id,
  });

  const paypalAttempt = await reserveAndRecord(paypalFixture, "PAYPAL", `PAYPAL-${paypalFixture.orderNumber}`);
  const paypalSuccess = successEvent(paypalFixture, {
    provider: "PAYPAL",
    paymentId: paypalAttempt.paymentId,
    providerCheckoutId: `PAYPAL-${paypalFixture.orderNumber}`,
    sequence: `${paypalFixture.orderNumber}:malformed-refund-winner`,
  });
  assert.equal((await repository.reconcile(paypalSuccess)).shopOrderPaid, true);
  assert.ok(paypalSuccess.providerPaymentId);
  const paypalEventId = `${FIXTURE_PREFIX}:paypal:${paypalFixture.orderNumber}:malformed-refund`;
  const malformedPaypalRefund = {
    id: paypalEventId,
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    create_time: new Date().toISOString(),
    resource: {
      id: `REFUND-MALFORMED-${paypalFixture.orderNumber}`,
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "invalid" },
      links: [{
        rel: "up",
        method: "GET",
        href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${paypalSuccess.providerPaymentId}`,
      }],
    },
  } as const;
  const paypalReview = await processVerifiedPaypalFinancialEvent(malformedPaypalRefund, "sandbox");
  assert.equal(paypalReview.outcome, "REQUIRES_REVIEW");
  assert.equal(paypalReview.duplicate, false);
  assert.equal((await processVerifiedPaypalFinancialEvent(malformedPaypalRefund, "sandbox")).duplicate, true);
  await assertMalformedFinancialReview(paypalFixture, {
    paymentId: paypalAttempt.paymentId,
    eventId: paypalEventId,
    provider: "PAYPAL",
    providerObjectId: malformedPaypalRefund.resource.id,
  });
  passed.push("malformed signed Stripe refund and allowlisted PayPal refund evidence remain linked to Shop review");
}

async function paypalCreateCrashRecoveryRuntime(fixture: Fixture, passed: string[]) {
  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const attempt = await repository.reserveAttempt(
    fixture.memberId,
    fixture.orderNumber,
    "PAYPAL",
    "TEST",
    true,
  );
  const providerOrderId = `PAYPAL-CRASH-${fixture.orderNumber}`;
  const event = {
    id: `${FIXTURE_PREFIX}:paypal:${fixture.orderNumber}:create-crash`,
    event_type: "CHECKOUT.ORDER.APPROVED",
    create_time: new Date().toISOString(),
    resource: {
      id: providerOrderId,
      status: "APPROVED",
      purchase_units: [{
        custom_id: attempt.paymentId,
        amount: {
          currency_code: "EUR",
          value: `${Math.floor(fixture.totalCents / 100)}.${String(fixture.totalCents % 100).padStart(2, "0")}`,
        },
      }],
    },
  } as const;
  const dependencies = {
    sourceLookup: createPaypalPaymentSourceLookup(),
    shopRepository: repository,
  };
  const first = await processVerifiedPaypalWebhookEventByPaymentSource(event, "sandbox", dependencies);
  const replay = await processVerifiedPaypalWebhookEventByPaymentSource(event, "sandbox", dependencies);
  assert.equal(first.outcome, "REQUIRES_REVIEW");
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  const [payment, order, receipt] = await Promise.all([
    prisma.payment.findUniqueOrThrow({ where: { id: attempt.paymentId } }),
    prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.shopOrderId } }),
    prisma.providerEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: "PAYPAL", providerEventId: event.id } },
    }),
  ]);
  assert.equal(payment.providerCheckoutId, null, "The runtime simulates a crash before recordSession.");
  assert.equal(payment.status, "REQUIRES_REVIEW");
  assert.equal(receipt.paymentId, attempt.paymentId);
  assert.ok(order.paymentReviewAt);
  assert.equal(order.paymentStatus, "AWAITING_PAYMENT");
  assert.equal(await prisma.productStockAdjustment.count({ where: { productId: fixture.productId } }), 0);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.shopOrderId } }), 0);
  passed.push("PayPal create-order crash recovers by custom_id and preserves a linked idempotent review receipt");
}

async function run() {
  const runtime = await loadAndAssertShopPhase2QaEnvironment();
  const databaseUrl = new URL(runtime.databaseUrl);
  await assertRuntimeIdentity(databaseUrl.port);
  await assertMigrationState();
  Object.assign(process.env, shopPhase3QaRuntimeOverrides(process.env));
  exactEnvironment("SHOP_LEGAL_READY", "true");
  exactEnvironment("SHOP_TERMS_VERSION", SHOP_LEGAL_QA_TERMS_VERSION);
  exactEnvironment("SHOP_LEGAL_QA_CONFIRM", SHOP_LEGAL_QA_CONFIRMATION);

  await cleanupFixtures();
  await assertFixturesAbsent("before test");
  assert.equal(
    await prisma.shopOrder.count(),
    0,
    "The disposable runtime must not contain a foreign ShopOrder before the Phase 3 proof.",
  );
  const passed: string[] = [];
  try {
    const actors = await ensureActors();
    await concurrentProviderWinnerRuntime(await createFixture(actors, 1), passed);
    await disabledAfterAttemptAndFulfillmentRuntime(await createFixture(actors, 2), passed);
    await lateCaptureRuntime(await createFixture(actors, 3, { reservationMinutes: 1 }), passed);
    await cancellationVsCaptureRuntime(await createFixture(actors, 4), passed);
    await openReviewBarrierRuntime(await createFixture(actors, 5), passed);
    await paypalCreateCrashRecoveryRuntime(await createFixture(actors, 6), passed);
    await stripeSignedMismatchRuntime(
      await createFixture(actors, 7),
      await createFixture(actors, 14),
      passed,
    );
    await paypalSignedMismatchRuntime(await createFixture(actors, 8), passed);
    await financialReviewVsFulfillmentRuntime(await createFixture(actors, 9), passed);
    await malformedFinancialEvidenceRuntime(
      await createFixture(actors, 10),
      await createFixture(actors, 11),
      passed,
    );
    await terminalAttemptWithPendingSiblingRuntime(await createFixture(actors, 12), "FAILED", passed);
    await terminalAttemptWithPendingSiblingRuntime(await createFixture(actors, 13), "EXPIRED", passed);
    const diagnostic = await createPrismaPaymentDiagnosticRepository(prisma).inspect("TEST");
    assert.equal(
      diagnostic.relationshipAnomalies,
      0,
      "Distinct ShopOrder winners must not be aggregated through a nullable music Order parent.",
    );
    passed.push("production diagnostics keep payment winners isolated by their exact parent");
  } finally {
    await cleanupFixtures();
    await assertFixturesAbsent("after cleanup");
    await prisma.$disconnect();
  }

  console.info(`Shop payment PostgreSQL runtime: ${passed.length} PASS`);
  for (const proof of passed) console.info(`PASS ${proof}`);
  console.info(`PASS ${EXPECTED_MIGRATION_COUNT} exact migrations on guarded loopback PostgreSQL`);
  console.info("PASS fixture cleanup complete");
}

run().catch((error: unknown) => {
  console.error("Shop payment PostgreSQL runtime failed without contacting a provider.");
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
});
