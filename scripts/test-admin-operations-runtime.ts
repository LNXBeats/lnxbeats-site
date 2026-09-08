import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  executeAdminCleanupPlan,
  listAdminArchives,
  listAdminCleanupCandidates,
} from "@/lib/admin/cleanup";
import { commanderCockpitWhere, commanderCriticalWhere, getAdminCockpit } from "@/lib/admin/cockpit";
import { adminUncorrelatedPaymentReviewEventWhere } from "@/lib/admin/operation-queries";
import { listAdminOrders } from "@/lib/admin/service";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { prisma } from "@/lib/prisma";

const TARGET = "lnx-studio-v120-admin-test";
const PROOF_FILE = `/Users/lnxbeats/Library/Application Support/prisma-dev-nodejs/${TARGET}/server.json`;
const ADMIN_EMAIL = "v120-admin@example.invalid";
const ORDER_NUMBERS = ["LNX-2120-000001", "LNX-2120-000002", "LNX-2120-000003", "LNX-2120-000004"] as const;
const UNCORRELATED_EVENT_ID = "evt-v120-admin-runtime-uncorrelated";
const SHOP_ORDER_NUMBERS = ["LNX-SHOP-2120-000001", "LNX-SHOP-2120-000002", "LNX-SHOP-2120-000003"] as const;

async function assertDisposableRuntime() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, TARGET);
  assert.equal(process.env.LNX_PRISMA_DEV_SERVER_FILE, PROOF_FILE);
  assert.ok(process.env.DATABASE_URL);
  const url = assertSafeLocalPostgresUrl(process.env.DATABASE_URL);
  assert.equal(decodeURIComponent(url.pathname), "/template1");
  for (const name of [
    "RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
    "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_DEPLOYMENT_ID",
  ]) {
    assert.equal(Boolean(process.env[name]), false, `${name} must not be present`);
  }
  for (const name of ["STRIPE_SECRET_KEY", "PAYPAL_CLIENT_SECRET", "RESEND_API_KEY", "MEDIA_S3_SECRET_ACCESS_KEY"]) {
    assert.equal(Boolean(process.env[name]), false, `${name} must not be present`);
  }
  const proof = JSON.parse(await readFile(PROOF_FILE, "utf8")) as { name?: string; exports?: { database?: { connectionString?: string } } };
  assert.equal(proof.name, TARGET);
  assert.equal(proof.exports?.database?.connectionString, process.env.DATABASE_URL);
}

async function cleanup() {
  await prisma.$transaction(async (transaction) => {
    await transaction.providerEvent.deleteMany({ where: { providerEventId: UNCORRELATED_EVENT_ID } });
    await transaction.adminCleanupAuditEvent.deleteMany({ where: { recordReference: { in: [...ORDER_NUMBERS] } } });
    await transaction.adminCleanupAuditEvent.deleteMany({ where: { recordReference: { in: [...SHOP_ORDER_NUMBERS] } } });
    await transaction.adminRecordArchive.deleteMany({ where: { recordReference: { in: [...ORDER_NUMBERS, ...SHOP_ORDER_NUMBERS] } } });
    const orders = await transaction.order.findMany({ where: { orderNumber: { in: [...ORDER_NUMBERS] } }, select: { id: true } });
    const ids = orders.map(({ id }) => id);
    await transaction.notificationEvent.deleteMany({ where: { notification: { orderId: { in: ids } } } });
    await transaction.orderNotification.deleteMany({ where: { orderId: { in: ids } } });
    await transaction.paymentAuditEvent.deleteMany({ where: { payment: { orderId: { in: ids } } } });
    await transaction.providerEvent.deleteMany({ where: { payment: { orderId: { in: ids } } } });
    await transaction.refundAttempt.deleteMany({ where: { payment: { orderId: { in: ids } } } });
    await transaction.paymentIncident.deleteMany({ where: { payment: { orderId: { in: ids } } } });
    await transaction.payment.deleteMany({ where: { orderId: { in: ids } } });
    await transaction.orderEvent.deleteMany({ where: { orderId: { in: ids } } });
    await transaction.order.deleteMany({ where: { id: { in: ids } } });
    const shopOrders = await transaction.shopOrder.findMany({ where: { orderNumber: { in: [...SHOP_ORDER_NUMBERS] } }, select: { id: true } });
    const shopOrderIds = shopOrders.map(({ id }) => id);
    await transaction.shopShippingProviderAttempt.deleteMany({ where: { shopOrderId: { in: shopOrderIds } } });
    await transaction.paymentAuditEvent.deleteMany({ where: { payment: { shopOrderId: { in: shopOrderIds } } } });
    await transaction.providerEvent.deleteMany({ where: { payment: { shopOrderId: { in: shopOrderIds } } } });
    await transaction.refundAttempt.deleteMany({ where: { payment: { shopOrderId: { in: shopOrderIds } } } });
    await transaction.paymentIncident.deleteMany({ where: { payment: { shopOrderId: { in: shopOrderIds } } } });
    await transaction.payment.deleteMany({ where: { shopOrderId: { in: shopOrderIds } } });
    await transaction.shopOrder.deleteMany({ where: { id: { in: shopOrderIds } } });
    await transaction.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  });
}

async function createOrder(orderNumber: string, email: string) {
  return prisma.order.create({
    data: {
      orderNumber,
      customerEmail: email,
      customerName: "Fixture V1.2",
      title: "Essai cockpit",
      brief: "Fixture locale dédiée au runtime Admin V1.2.",
      status: "CANCELLED",
      cancelledAt: new Date(),
      events: { create: { toStatus: "CANCELLED", visibility: "INTERNAL", note: "Fixture locale." } },
    },
  });
}

async function createShopOrder(orderNumber: string, userId: string) {
  return prisma.shopOrder.create({
    data: {
      orderNumber,
      userId,
      creationToken: crypto.randomUUID(),
      requestFingerprintSha256: "a".repeat(64),
      status: "CANCELLED",
      paymentStatus: "CANCELLED",
      fulfillmentStatus: "CANCELLED",
      subtotalCents: 1_249,
      shippingCents: 0,
      totalCents: 1_249,
      reservationExpiresAt: new Date("2120-01-01T00:30:00.000Z"),
      cancelledAt: new Date("2120-01-01T00:10:00.000Z"),
    },
  });
}

async function run() {
  await assertDisposableRuntime();
  await cleanup();
  const passed: string[] = [];
  try {
    const admin = await prisma.user.create({
      data: { email: ADMIN_EMAIL, displayName: "Admin V1.2 QA", role: "ADMIN", status: "ACTIVE", emailVerified: true },
    });
    const removable = await createOrder(ORDER_NUMBERS[0], "delete-safe@example.invalid");
    const retained = await createOrder(ORDER_NUMBERS[1], "historical@example.invalid");
    await prisma.payment.create({
      data: {
        orderId: retained.id, provider: "STRIPE", mode: "TEST", status: "REFUNDED",
        amountCents: 5_000, currency: "EUR", pricingVersion: "runtime-v1",
        refundedAmountCents: 5_000,
        idempotencyKey: `v120-admin-runtime:${retained.id}`, paidAt: new Date(), refundedAt: new Date(),
      },
    });
    const race = await createOrder(ORDER_NUMBERS[2], "race@example.invalid");
    const archivedAction = await createOrder(ORDER_NUMBERS[3], "archived-action@example.invalid");
    const inconsistentShopOrder = await createShopOrder(SHOP_ORDER_NUMBERS[0], admin.id);
    await prisma.payment.create({
      data: {
        shopOrderId: inconsistentShopOrder.id, provider: "PAYPAL", mode: "TEST", status: "SUCCEEDED",
        amountCents: 1_249, currency: "EUR", pricingVersion: "runtime-v1",
        refundedAmountCents: 0, idempotencyKey: `v120-admin-runtime:${inconsistentShopOrder.id}`, paidAt: new Date(),
      },
    });
    const settledShopOrder = await createShopOrder(SHOP_ORDER_NUMBERS[1], admin.id);
    await prisma.payment.create({
      data: {
        shopOrderId: settledShopOrder.id, provider: "PAYPAL", mode: "TEST", status: "REFUNDED",
        amountCents: 1_249, currency: "EUR", pricingVersion: "runtime-v1",
        refundedAmountCents: 1_249, idempotencyKey: `v120-admin-runtime:${settledShopOrder.id}`,
        paidAt: new Date(), refundedAt: new Date(),
      },
    });
    const shippingShopOrder = await createShopOrder(SHOP_ORDER_NUMBERS[2], admin.id);
    await prisma.shopShippingProviderAttempt.create({
      data: {
        shopOrderId: shippingShopOrder.id, provider: "FAKE_LOCAL", scenario: "PENDING", status: "REQUESTED",
        attemptNumber: 1, idempotencyKey: `v120-admin-runtime:${shippingShopOrder.id}:shipping`, createdByUserId: admin.id,
      },
    });

    const preview = await listAdminCleanupCandidates();
    assert.equal(preview.find(({ id }) => id === removable.id)?.classification, "DELETE_SAFE");
    assert.equal(preview.find(({ id }) => id === retained.id)?.classification, "ARCHIVE_REQUIRED");
    assert.equal(preview.find(({ id }) => id === race.id)?.classification, "DELETE_SAFE");
    passed.push("preview classifies from relations rather than titles");

    assert.equal(preview.find(({ id }) => id === inconsistentShopOrder.id)?.classification, "KEEP_ACTION_REQUIRED");
    assert.equal(preview.find(({ id }) => id === settledShopOrder.id)?.classification, "ARCHIVE_REQUIRED");
    assert.equal(preview.find(({ id }) => id === shippingShopOrder.id)?.classification, "KEEP_ACTION_REQUIRED");
    passed.push("Shop archives fail closed on unsettled payment and in-flight shipping evidence");

    const result = await executeAdminCleanupPlan([
      { type: "MUSIC_ORDER", id: removable.id, expected: "DELETE_SAFE" },
      { type: "MUSIC_ORDER", id: retained.id, expected: "ARCHIVE_REQUIRED" },
    ], admin.id);
    assert.deepEqual({ deleted: result.deleted, archived: result.archived, ignored: result.ignored }, { deleted: 1, archived: 1, ignored: 0 });
    assert.equal(await prisma.order.count({ where: { id: removable.id } }), 0);
    assert.equal(await prisma.order.count({ where: { id: retained.id } }), 1);
    assert.equal(await prisma.payment.count({ where: { orderId: retained.id } }), 1);
    assert.equal(await prisma.adminCleanupAuditEvent.count({ where: { recordReference: { in: [ORDER_NUMBERS[0], ORDER_NUMBERS[1]] } } }), 2);
    passed.push("hard delete and archive are transactional, audited and preserve financial history");

    const replay = await executeAdminCleanupPlan([
      { type: "MUSIC_ORDER", id: retained.id, expected: "ARCHIVE_REQUIRED" },
    ], admin.id);
    assert.deepEqual({ archived: replay.archived, ignored: replay.ignored }, { archived: 0, ignored: 1 });
    assert.equal((await listAdminArchives()).filter(({ recordId }) => recordId === retained.id).length, 1);
    passed.push("archive replay is idempotent");

    const shopArchive = await executeAdminCleanupPlan([
      { type: "SHOP_ORDER", id: settledShopOrder.id, expected: "ARCHIVE_REQUIRED" },
    ], admin.id);
    assert.deepEqual({ archived: shopArchive.archived, deleted: shopArchive.deleted }, { archived: 1, deleted: 0 });
    assert.equal(await prisma.shopOrder.count({ where: { id: settledShopOrder.id } }), 1);
    assert.equal(await prisma.payment.count({ where: { shopOrderId: settledShopOrder.id, status: "REFUNDED" } }), 1);
    passed.push("Shop archive overlay preserves the order and its settled payment");

    await prisma.orderNotification.create({
      data: {
        orderId: race.id, kind: "OWNER_NEW_ORDER", channel: "EMAIL", recipient: ADMIN_EMAIL,
        idempotencyKey: `v120-race-notification:${race.id}`, deploymentEnvironment: "test",
      },
    });
    await assert.rejects(executeAdminCleanupPlan([
      { type: "MUSIC_ORDER", id: race.id, expected: "DELETE_SAFE" },
    ], admin.id), /CLEANUP_CLASSIFICATION_CHANGED/);
    assert.equal(await prisma.order.count({ where: { id: race.id } }), 1);
    assert.equal(await prisma.orderNotification.count({ where: { orderId: race.id } }), 1);
    passed.push("preview/confirmation race fails closed after a new retention relation");

    await prisma.adminRecordArchive.create({
      data: {
        recordType: "MUSIC_ORDER",
        recordId: archivedAction.id,
        recordReference: archivedAction.orderNumber,
        classification: "ARCHIVE_REQUIRED",
        reason: "Fixture locale : archive antérieure à une nouvelle action persistante.",
        archivedByUserId: admin.id,
      },
    });
    const reviewPayment = await prisma.payment.create({
      data: {
        orderId: archivedAction.id,
        provider: "STRIPE",
        mode: "TEST",
        status: "REQUIRES_REVIEW",
        amountCents: 5_000,
        currency: "EUR",
        pricingVersion: "runtime-v1",
        idempotencyKey: `v120-admin-runtime-review:${archivedAction.id}`,
      },
    });
    await prisma.providerEvent.createMany({
      data: [
        {
          provider: "STRIPE",
          providerEventId: `evt-v120-admin-runtime-linked-${archivedAction.id}`,
          type: "payment_intent.processing",
          livemode: false,
          outcome: "REQUIRES_REVIEW",
          paymentId: reviewPayment.id,
          processedAt: new Date(),
        },
        {
          provider: "STRIPE",
          providerEventId: UNCORRELATED_EVENT_ID,
          type: "payment_intent.unmatched",
          livemode: false,
          outcome: "REQUIRES_REVIEW",
          processedAt: new Date(),
        },
      ],
    });

    const [attentionOrders, allOrders, cockpit] = await Promise.all([
      listAdminOrders("attention"),
      listAdminOrders("all"),
      getAdminCockpit(),
    ]);
    assert.ok(attentionOrders.some(({ id }) => id === archivedAction.id));
    assert.equal(allOrders.some(({ id }) => id === archivedAction.id), false);
    assert.ok(cockpit.actions.some((action) => action.domain === "COMMANDER" && action.reference === archivedAction.orderNumber));
    assert.equal(cockpit.actions.filter(({ domain }) => domain === "FINANCIAL_EVENT").length, 1);
    const [expectedCommanderOrders, expectedCommanderCritical, expectedUncorrelatedEvents] = await Promise.all([
      prisma.order.count({ where: commanderCockpitWhere }),
      prisma.order.count({ where: commanderCriticalWhere }),
      prisma.providerEvent.count({ where: adminUncorrelatedPaymentReviewEventWhere }),
    ]);
    assert.equal(cockpit.financialEvents, expectedUncorrelatedEvents);
    assert.equal(cockpit.counts.commander, expectedCommanderOrders + expectedUncorrelatedEvents);
    assert.equal(
      cockpit.criticalActionRequiredCounts["/admin/commandes"],
      expectedCommanderCritical + expectedUncorrelatedEvents,
    );
    passed.push("archived records resurface on durable action and uncorrelated receipts count once");

    console.info(`Admin Operations PostgreSQL runtime passed (${passed.length}/${passed.length}).`);
    for (const item of passed) console.info(`- PASS: ${item}`);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

run().catch(async (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Admin Operations runtime failed safely.");
  await prisma.$disconnect();
  process.exitCode = 1;
});
