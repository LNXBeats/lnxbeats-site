import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";

import { dispatchOrderNotification } from "@/lib/notifications/service";
import { prisma } from "@/lib/prisma";
import { createShopOrder } from "@/lib/shop/order-service";
import { createShopPaymentDatabaseRepository } from "@/lib/shop/payment-repository";
import {
  loadAndAssertShopPhase2QaEnvironment,
  shopPhase3QaRuntimeOverrides,
  SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH,
  SHOP_PHASE2_QA_ORIGIN,
} from "@/lib/shop/qa-guard";
import {
  SHOP_PHASE3_QA_CREATION_TOKEN,
  SHOP_PHASE3_QA_OWNER_EMAIL,
  SHOP_PHASE3_QA_PROVIDER_CHECKOUT_ID,
  SHOP_PHASE3_QA_PROVIDER_EVENT_ID,
  SHOP_PHASE3_QA_PROVIDER_PAYMENT_ID,
} from "@/lib/shop/qa-contract";

const MEMBER_EMAIL = "lnx-v110-phase2-member@example.invalid";
const ADMIN_EMAIL = "lnx-v110-phase2-admin@example.invalid";
const MEMBER_DISPLAY_NAME = "Membre fictif Boutique Phase 2";
const ADMIN_DISPLAY_NAME = "Admin fictif Boutique Phase 2";
const PRODUCT_SLUGS = [
  "lnx-v110-phase2-qa-product-a",
  "lnx-v110-phase2-qa-product-b",
] as const;
const INITIAL_STOCK: ReadonlyMap<string, number> = new Map([
  [PRODUCT_SLUGS[0], 3],
  [PRODUCT_SLUGS[1], 2],
]);
const ALLOWED_NOTIFICATION_KINDS = new Set([
  "OWNER_SHOP_ORDER_PAID",
  "CUSTOMER_SHOP_PAYMENT_CONFIRMED",
  "CUSTOMER_SHOP_PREPARING",
  "CUSTOMER_SHOP_SHIPPED",
]);
const ALLOWED_LIFECYCLE_TYPES = new Set([
  "SHOP_TERMS_ACCEPTED",
  "SHOP_PAYMENT_PROCESSING",
  "SHOP_PAYMENT_CONFIRMED",
  "PREPARATION_STARTED",
  "ORDER_SHIPPED",
]);

let stage = "startup";

function armOfflinePhase3Runtime() {
  Object.assign(process.env, shopPhase3QaRuntimeOverrides(process.env));
}

async function assertDatabaseState() {
  stage = "database-proof";
  const metadata = await prisma.$queryRaw<Array<{ database: string; schema: string }>>`
    SELECT current_database() AS database, current_schema() AS schema
  `;
  assert.deepEqual(metadata[0], { database: "template1", schema: "public" }, "The fixture reached an unexpected PostgreSQL database.");
  const migration = await prisma.$queryRaw<Array<{ count: bigint; latest: bigint }>>`
    SELECT
      count(*) FILTER (WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL)::bigint AS count,
      count(*) FILTER (
        WHERE "migration_name" = '20260827220000_shop_payment_fulfillment_foundation'
          AND "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
      )::bigint AS latest
    FROM "_prisma_migrations"
  `;
  assert.equal(Number(migration[0]?.count), 21, "The Phase 3 fixture requires exactly 21 applied migrations.");
  assert.equal(Number(migration[0]?.latest), 1, "The Shop payment/fulfillment migration is not applied exactly once.");
}

async function fixtureIdentity() {
  const [member, admin, products] = await Promise.all([
    prisma.user.findUnique({
      where: { email: MEMBER_EMAIL },
      select: { id: true, email: true, displayName: true, role: true, status: true, emailVerified: true },
    }),
    prisma.user.findUnique({
      where: { email: ADMIN_EMAIL },
      select: { id: true, email: true, displayName: true, role: true, status: true, emailVerified: true },
    }),
    prisma.product.findMany({
      where: { slug: { in: [...PRODUCT_SLUGS] } },
      orderBy: { slug: "asc" },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        priceCents: true,
        currency: true,
        stock: true,
        trackInventory: true,
        shippingRequired: true,
        shippingPriceCents: true,
        lockVersion: true,
        createdByAdminId: true,
      },
    }),
  ]);
  assert.deepEqual(member && {
    email: member.email,
    displayName: member.displayName,
    role: member.role,
    status: member.status,
    emailVerified: member.emailVerified,
  }, {
    email: MEMBER_EMAIL,
    displayName: MEMBER_DISPLAY_NAME,
    role: "MEMBER",
    status: "ACTIVE",
    emailVerified: true,
  }, "The Phase 3 MEMBER fixture is missing or has drifted.");
  assert.deepEqual(admin && {
    email: admin.email,
    displayName: admin.displayName,
    role: admin.role,
    status: admin.status,
    emailVerified: admin.emailVerified,
  }, {
    email: ADMIN_EMAIL,
    displayName: ADMIN_DISPLAY_NAME,
    role: "ADMIN",
    status: "ACTIVE",
    emailVerified: true,
  }, "The Phase 3 ADMIN fixture is missing or has drifted.");
  assert.ok(member && admin, "The Phase 2 identities must be prepared before the Phase 3 fixture.");
  assert.equal(products.length, PRODUCT_SLUGS.length, "The two synthetic products must exist before the Phase 3 fixture.");
  for (const product of products) {
    assert.equal(product.createdByAdminId, admin.id, "A synthetic product belongs to another administrator.");
    assert.equal(product.status, "PUBLISHED");
    assert.equal(product.currency, "EUR");
    assert.equal(product.trackInventory, true);
    assert.equal(product.shippingRequired, true);
    assert.ok(Number.isSafeInteger(product.priceCents) && (product.priceCents ?? 0) > 0);
    assert.ok(Number.isSafeInteger(product.shippingPriceCents) && product.shippingPriceCents > 0);
    assert.equal(product.stock, INITIAL_STOCK.get(product.slug), "A synthetic product stock is not at its clean baseline.");
  }
  return { member, admin, products };
}

async function removeNotificationCapture() {
  await unlink(SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function findFixtureOrder(memberId: string) {
  return prisma.shopOrder.findUnique({
    where: {
      userId_creationToken: {
        userId: memberId,
        creationToken: SHOP_PHASE3_QA_CREATION_TOKEN,
      },
    },
    include: {
      items: { orderBy: { position: "asc" }, include: { reservation: true, product: { select: { slug: true, stock: true } } } },
      events: true,
      lifecycleEvents: true,
      payments: { include: { events: true, refundAttempts: true, incidents: true, auditEvents: true } },
      notifications: { include: { events: true } },
    },
  });
}

async function cleanup() {
  stage = "phase3-cleanup";
  const member = await prisma.user.findUnique({ where: { email: MEMBER_EMAIL }, select: { id: true, displayName: true, role: true } });
  if (!member) {
    await removeNotificationCapture();
    return null;
  }
  assert.equal(member.displayName, MEMBER_DISPLAY_NAME, "The Phase 3 fixture email belongs to another identity.");
  assert.equal(member.role, "MEMBER", "The Phase 3 fixture identity has an unexpected role.");
  const order = await findFixtureOrder(member.id);
  if (!order) {
    await removeNotificationCapture();
    return null;
  }
  assert.equal(order.userId, member.id);
  assert.equal(order.status, "OPEN");
  assert.ok(["AWAITING_PAYMENT", "PAID"].includes(order.paymentStatus));
  assert.ok(["PENDING", "PREPARING", "SHIPPED"].includes(order.fulfillmentStatus));
  assert.equal(order.currency, "EUR");
  assert.equal(order.items.length, PRODUCT_SLUGS.length);
  assert.ok(order.items.every((item) => PRODUCT_SLUGS.includes(item.product.slug as typeof PRODUCT_SLUGS[number])));
  assert.ok(order.events.every((event) => ["SHOP_ORDER_CREATED", "STOCK_RESERVED", "STOCK_CONFIRMED"].includes(event.type)));
  assert.ok(order.lifecycleEvents.every((event) => ALLOWED_LIFECYCLE_TYPES.has(event.type)));
  assert.ok(order.notifications.every((notification) => (
    notification.shopOrderId === order.id
    && notification.orderId === null
    && ALLOWED_NOTIFICATION_KINDS.has(notification.kind)
    && notification.resourceType === "SHOP_ORDER"
    && notification.resourceId === order.id
  )), "The Phase 3 fixture has a foreign notification.");
  assert.ok(order.payments.length <= 1, "The Phase 3 fixture has an unexpected payment graph.");
  for (const payment of order.payments) {
    assert.equal(payment.orderId, null);
    assert.equal(payment.provider, "STRIPE");
    assert.equal(payment.mode, "TEST");
    assert.ok(["CREATED", "PENDING", "SUCCEEDED"].includes(payment.status));
    assert.ok(payment.providerCheckoutId === null || payment.providerCheckoutId === SHOP_PHASE3_QA_PROVIDER_CHECKOUT_ID);
    assert.ok(payment.providerPaymentId === null || payment.providerPaymentId === SHOP_PHASE3_QA_PROVIDER_PAYMENT_ID);
    assert.equal(payment.refundAttempts.length, 0);
    assert.equal(payment.incidents.length, 0);
    assert.equal(payment.auditEvents.length, 0);
    assert.ok(payment.events.every((event) => event.providerEventId === SHOP_PHASE3_QA_PROVIDER_EVENT_ID && event.livemode === false));
  }

  await prisma.$transaction(async (transaction) => {
    for (const item of order.items) {
      const initialStock = INITIAL_STOCK.get(item.product.slug);
      assert.notEqual(initialStock, undefined);
      if (item.reservation?.status === "CONFIRMED") {
        const reason: string = `Paiement confirmé de la commande ${order.orderNumber}`;
        const adjustment: Array<{ id: string; delta: number; stockBefore: number; stockAfter: number }> = await transaction.productStockAdjustment.findMany({
          where: { productId: item.productId, reason },
          select: { id: true, delta: true, stockBefore: true, stockAfter: true },
        });
        assert.deepEqual(adjustment.map(({ delta, stockBefore, stockAfter }) => ({ delta, stockBefore, stockAfter })), [{
          delta: -item.quantity,
          stockBefore: initialStock!,
          stockAfter: initialStock! - item.quantity,
        }], "A confirmed mock reservation has an unexpected stock adjustment.");
        const restored = await transaction.product.updateMany({
          where: { id: item.productId, stock: initialStock! - item.quantity },
          data: { stock: { increment: item.quantity }, lockVersion: { increment: 1 } },
        });
        assert.equal(restored.count, 1, "The synthetic stock changed outside the Phase 3 fixture.");
        await transaction.productStockAdjustment.delete({ where: { id: adjustment[0]!.id } });
      } else {
        assert.equal(item.reservation?.status, "ACTIVE", "A partial Phase 3 reservation is outside the cleanup policy.");
        assert.equal(item.product.stock, initialStock, "Active reservation cleanup must not restore unconsumed stock.");
      }
    }
    const notificationIds = order.notifications.map(({ id }) => id);
    if (notificationIds.length) {
      await transaction.notificationEvent.deleteMany({ where: { notificationId: { in: notificationIds } } });
      await transaction.orderNotification.deleteMany({ where: { id: { in: notificationIds }, shopOrderId: order.id } });
    }
    const paymentIds = order.payments.map(({ id }) => id);
    if (paymentIds.length) {
      await transaction.providerEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
    }
    await transaction.shopOrderLifecycleEvent.deleteMany({ where: { shopOrderId: order.id } });
    if (paymentIds.length) await transaction.payment.deleteMany({ where: { id: { in: paymentIds }, shopOrderId: order.id } });
    await transaction.shopOrderEvent.deleteMany({ where: { shopOrderId: order.id } });
    await transaction.stockReservation.deleteMany({ where: { shopOrderId: order.id } });
    await transaction.shopOrderItem.deleteMany({ where: { shopOrderId: order.id } });
    await transaction.shopOrder.delete({ where: { id: order.id } });
  });
  await removeNotificationCapture();
  assert.equal(await findFixtureOrder(member.id), null, "The Phase 3 fixture cleanup is incomplete.");
  return order.orderNumber;
}

async function setup() {
  await cleanup();
  stage = "phase3-setup";
  const { member, products } = await fixtureIdentity();
  const order = await createShopOrder({ id: member.id, role: "MEMBER" }, {
    items: products.map((product) => ({
      productId: product.id,
      quantity: 1,
      observedLockVersion: product.lockVersion,
    })),
    shippingAddress: {
      firstName: "Membre",
      lastName: "QA Phase 3",
      addressLine1: "3 rue du Test local",
      addressLine2: null,
      postalCode: "75003",
      city: "Paris",
      countryCode: "FR",
    },
    shippingQuoteVersion: null,
  }, SHOP_PHASE3_QA_CREATION_TOKEN);

  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const attempt = await repository.reserveAttempt(member.id, order.orderNumber, "STRIPE", "TEST", true);
  await repository.recordSession(attempt.paymentId, "STRIPE", {
    id: SHOP_PHASE3_QA_PROVIDER_CHECKOUT_ID,
    url: `${SHOP_PHASE2_QA_ORIGIN}/qa/offline-provider-mock`,
    paymentIntentId: SHOP_PHASE3_QA_PROVIDER_PAYMENT_ID,
  });
  const occurredAt = new Date();
  const result = await repository.reconcile({
    eventId: SHOP_PHASE3_QA_PROVIDER_EVENT_ID,
    type: "checkout.session.completed",
    provider: "STRIPE",
    livemode: false,
    paymentId: attempt.paymentId,
    providerCheckoutId: SHOP_PHASE3_QA_PROVIDER_CHECKOUT_ID,
    providerPaymentId: SHOP_PHASE3_QA_PROVIDER_PAYMENT_ID,
    amountCents: attempt.amountCents,
    currency: "EUR",
    status: "SUCCEEDED",
    occurredAt,
    paymentMethod: "CARD",
  }, occurredAt);
  assert.deepEqual({
    outcome: result.outcome,
    duplicate: result.duplicate,
    shopOrderPaid: result.shopOrderPaid,
    stockConfirmed: result.stockConfirmed,
  }, {
    outcome: "PROCESSED",
    duplicate: false,
    shopOrderPaid: true,
    stockConfirmed: true,
  }, "The offline provider evidence did not confirm the synthetic order.");

  const notifications = await prisma.orderNotification.findMany({
    where: { shopOrderId: order.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, kind: true },
  });
  assert.deepEqual(new Set(notifications.map(({ kind }) => kind)), new Set([
    "OWNER_SHOP_ORDER_PAID",
    "CUSTOMER_SHOP_PAYMENT_CONFIRMED",
  ]), "The offline confirmation must create exactly the owner and client notifications.");
  for (const notification of notifications) {
    const dispatched = await dispatchOrderNotification(notification.id);
    assert.deepEqual(dispatched, { delivered: true, skipped: false }, `${notification.kind} was not captured.`);
  }

  const captured = (await readFile(SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind?: string; providerMessageId?: string; recipient?: string });
  assert.equal(captured.length, 2, "The Phase 3 fixture must capture exactly two messages.");
  assert.deepEqual(new Set(captured.map(({ kind }) => kind)), new Set([
    "OWNER_SHOP_ORDER_PAID",
    "CUSTOMER_SHOP_PAYMENT_CONFIRMED",
  ]));
  assert.ok(captured.every(({ providerMessageId }) => providerMessageId?.startsWith("capture_")));
  assert.ok(captured.some(({ recipient }) => recipient === SHOP_PHASE3_QA_OWNER_EMAIL));
  assert.ok(captured.some(({ recipient }) => recipient === MEMBER_EMAIL));

  const persisted = await findFixtureOrder(member.id);
  assert.ok(persisted, "The Phase 3 ShopOrder disappeared after setup.");
  assert.equal(persisted.paymentStatus, "PAID");
  assert.equal(persisted.fulfillmentStatus, "PENDING");
  assert.equal(persisted.payments.length, 1);
  assert.equal(persisted.payments[0]?.status, "SUCCEEDED");
  assert.equal(persisted.notifications.length, 2);
  assert.ok(persisted.notifications.every(({ status, provider }) => status === "DELIVERED" && provider === "CAPTURE"));
  assert.ok(persisted.items.every(({ reservation }) => reservation?.status === "CONFIRMED"));
  return persisted;
}

async function run() {
  stage = "guard";
  const runtime = await loadAndAssertShopPhase2QaEnvironment();
  assert.equal(runtime.baseUrl, SHOP_PHASE2_QA_ORIGIN);
  await assertDatabaseState();
  armOfflinePhase3Runtime();
  const operation = process.argv[2];
  assert.ok(operation === "setup" || operation === "cleanup", "Use setup or cleanup.");
  if (operation === "cleanup") {
    const orderNumber = await cleanup();
    console.info(orderNumber ? `Shop Phase 3 fixture ${orderNumber} removed.` : "Shop Phase 3 fixture already absent.");
    return;
  }
  const order = await setup();
  console.info("Shop Phase 3 offline browser fixture is ready.");
  console.info(`MEMBER: ${MEMBER_EMAIL}`);
  console.info(`ADMIN: ${ADMIN_EMAIL}`);
  console.info(`SHOP ORDER: ${order.orderNumber}`);
  console.info(`MEMBER URL: /compte/achats/${order.orderNumber}`);
  console.info(`ADMIN URL: /admin/boutique/commandes/${order.orderNumber}`);
  console.info("Payment: TEST mock confirmed locally; no provider endpoint was contacted.");
  console.info("Notifications: two messages captured locally; no e-mail was sent.");
  console.info("Use the separate passwords from LNX_AUTH_QA_MEMBER_PASSWORD and LNX_AUTH_QA_ADMIN_PASSWORD; neither was printed.");
}

run()
  .finally(() => prisma.$disconnect())
  .catch(() => {
    console.error(`Shop Phase 3 fixture operation failed at ${stage}.`);
    process.exitCode = 1;
  });
