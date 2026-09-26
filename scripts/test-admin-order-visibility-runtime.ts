import assert from "node:assert/strict";

import {
  hideAdminOrderFromCurrentViews,
  hideAdminOrdersFromCurrentViews,
  listAdminOrders,
  restoreAdminOrderToCurrentViews,
} from "@/lib/admin/service";
import { searchAdminRecords } from "@/lib/admin/search";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { prisma } from "@/lib/prisma";

const TARGET = "lnx-admin-hidden-views-test";
const ORDER_NUMBERS = ["LNX-2199-000001", "LNX-2199-000002", "LNX-2199-000003", "LNX-2199-000004"] as const;
const ADMIN_EMAIL = "order-visibility-admin@example.invalid";

function guardLocalDatabase() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, TARGET);
  const database = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(database.hostname));
  assert.ok(database.port && database.port !== "5432");
  for (const variable of ["RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "STRIPE_SECRET_KEY", "PAYPAL_CLIENT_SECRET", "RESEND_API_KEY"]) {
    assert.equal(Boolean(process.env[variable]), false, `${variable} must remain absent`);
  }
}

async function cleanup() {
  const orders = await prisma.order.findMany({ where: { orderNumber: { in: [...ORDER_NUMBERS] } }, select: { id: true } });
  const ids = orders.map(({ id }) => id);
  await prisma.$transaction([
    prisma.orderCurrentViewVisibilityEvent.deleteMany({ where: { orderId: { in: ids } } }),
    prisma.payment.deleteMany({ where: { orderId: { in: ids } } }),
    prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } }),
    prisma.order.deleteMany({ where: { id: { in: ids } } }),
    prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } }),
  ]);
}

async function createOrder(orderNumber: string, status: "REFUSED" | "CANCELLED" | "DELIVERED") {
  return prisma.order.create({
    data: {
      orderNumber,
      customerEmail: `${orderNumber.toLowerCase()}@example.invalid`,
      customerName: "Fixture visibilité",
      title: "Titre neutre sans inférence QA",
      brief: "Fixture PostgreSQL locale jetable.",
      status,
      ...(status === "CANCELLED" ? { cancelledAt: new Date() } : {}),
      ...(status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
    },
  });
}

async function run() {
  guardLocalDatabase();
  await cleanup();
  const passed: string[] = [];
  try {
    const admin = await prisma.user.create({ data: { email: ADMIN_EMAIL, displayName: "Admin visibilité", role: "ADMIN", status: "ACTIVE", emailVerified: true } });
    const resolved = await createOrder(ORDER_NUMBERS[0], "REFUSED");
    const refundDue = await createOrder(ORDER_NUMBERS[1], "CANCELLED");
    const ambiguous = await createOrder(ORDER_NUMBERS[2], "REFUSED");
    const batchResolved = await createOrder(ORDER_NUMBERS[3], "DELIVERED");
    await prisma.payment.createMany({ data: [
      { orderId: refundDue.id, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 5_000, currency: "EUR", pricingVersion: "runtime", refundedAmountCents: 0, idempotencyKey: `visibility-refund:${refundDue.id}`, paidAt: new Date() },
      { orderId: ambiguous.id, provider: "PAYPAL", mode: "TEST", status: "REQUIRES_REVIEW", amountCents: 5_000, currency: "EUR", pricingVersion: "runtime", refundedAmountCents: 0, idempotencyKey: `visibility-ambiguous:${ambiguous.id}` },
    ] });

    const hidden = await hideAdminOrderFromCurrentViews(resolved.orderNumber, "TEST", "Ancienne commande de test résolue.", admin.id);
    assert.equal(hidden.changed, true);
    assert.equal((await listAdminOrders("all")).some(({ id }) => id === resolved.id), false);
    assert.equal((await listAdminOrders("hidden")).some(({ id }) => id === resolved.id), true);
    assert.equal((await searchAdminRecords(resolved.orderNumber)).some(({ key }) => key === `order:${resolved.id}`), false);
    assert.equal((await searchAdminRecords(resolved.orderNumber, { includeHiddenOrders: true })).some(({ key }) => key === `order:${resolved.id}`), true);
    assert.equal(await prisma.order.count({ where: { id: resolved.id } }), 1);
    passed.push("hide preserves the order, removes current views and supports explicit hidden search");

    const replay = await hideAdminOrderFromCurrentViews(resolved.orderNumber, "TEST", "Replay", admin.id);
    assert.equal(replay.changed, false);
    assert.equal(await prisma.orderCurrentViewVisibilityEvent.count({ where: { orderId: resolved.id, action: "HIDDEN" } }), 1);
    passed.push("double submission is idempotent");

    const restored = await restoreAdminOrderToCurrentViews(resolved.orderNumber, admin.id);
    assert.equal(restored.changed, true);
    assert.equal((await listAdminOrders("completed")).some(({ id }) => id === resolved.id), true);
    assert.equal(await prisma.orderCurrentViewVisibilityEvent.count({ where: { orderId: resolved.id } }), 2);
    passed.push("restore returns the order to current views and preserves a separate audit");

    await assert.rejects(
      hideAdminOrderFromCurrentViews(refundDue.orderNumber, "TEST", null, admin.id),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "REFUND_DECISION"),
    );
    await assert.rejects(
      hideAdminOrderFromCurrentViews(ambiguous.orderNumber, "DUPLICATE", null, admin.id),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "PAYMENT_REVIEW"),
    );
    assert.equal(await prisma.order.count({ where: { id: { in: [refundDue.id, ambiguous.id] }, hiddenFromCurrentViewsAt: { not: null } } }), 0);
    assert.equal(await prisma.payment.count({ where: { orderId: { in: [refundDue.id, ambiguous.id] } } }), 2);
    passed.push("refund decision and ambiguous payment reject hiding without financial deletion");

    const bulk = await hideAdminOrdersFromCurrentViews([batchResolved.orderNumber, refundDue.orderNumber], "OTHER", "Lot mixte", admin.id);
    assert.deepEqual(bulk.map(({ orderNumber, ok }) => ({ orderNumber, ok })), [
      { orderNumber: batchResolved.orderNumber, ok: true },
      { orderNumber: refundDue.orderNumber, ok: false },
    ]);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: batchResolved.id } })).hiddenFromCurrentViewsAt instanceof Date, true);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: refundDue.id } })).hiddenFromCurrentViewsAt, null);
    passed.push("mixed bulk revalidates each order and allows partial safe success");

    console.info(`Admin order visibility PostgreSQL runtime passed (${passed.length}/${passed.length}).`);
    for (const item of passed) console.info(`- PASS: ${item}`);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

run().catch(async (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
