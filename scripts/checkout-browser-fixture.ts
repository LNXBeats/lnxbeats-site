import assert from "node:assert/strict";

import { hashPassword } from "@/lib/auth/password";
import { deletePrivateOrderFile } from "@/lib/orders/storage";
import { loadAndAssertPaymentQaDatabaseEnvironment } from "@/lib/payments/qa-guard";
import { prisma } from "@/lib/prisma";

const QA_USER_ID = "71000000-0000-4700-8700-000000000001";
const QA_ACCOUNT_ID = "71000000-0000-4700-8700-000000000002";
const QA_EMAIL = "lnx-v071-checkout-member@example.invalid";
const QA_DISPLAY_NAME = "LNX Checkout Browser QA";
const QA_ADMIN_USER_ID = "71000000-0000-4700-8700-000000000003";
const QA_ADMIN_ACCOUNT_ID = "71000000-0000-4700-8700-000000000004";
const QA_ADMIN_EMAIL = "lnx-v071-checkout-admin@example.invalid";
const QA_ADMIN_DISPLAY_NAME = "LNX Checkout Admin QA";
const QA_USER_IDS = [QA_USER_ID, QA_ADMIN_USER_ID] as const;
const QA_ACCOUNT_IDS = [QA_ACCOUNT_ID, QA_ADMIN_ACCOUNT_ID] as const;
const QA_EMAILS = [QA_EMAIL, QA_ADMIN_EMAIL] as const;
let stage = "startup";

const rateLimitKeys = [
  "127.0.0.1|/sign-in/email",
  "127.0.0.1|/sign-out",
  "0000:0000:0000:0000:0000:0000:0000:0000|/sign-in/email",
  "0000:0000:0000:0000:0000:0000:0000:0000|/sign-out",
  ...QA_USER_IDS.flatMap((userId) => [
    `payments:checkout:${userId}`,
    `orders:draft:${userId}`,
    `orders:finalize:${userId}`,
    `orders:upload:${userId}`,
    `orders:delete:${userId}`,
    `orders:rights:${userId}`,
  ]),
] as const;

async function assertFixtureIdentity() {
  stage = "identity";
  const [usersById, usersByEmail, foreignOrders] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...QA_USER_IDS] } }, select: { id: true, email: true } }),
    prisma.user.findMany({ where: { email: { in: [...QA_EMAILS] } }, select: { id: true, email: true } }),
    prisma.order.count({
      where: {
        customerEmail: { in: [...QA_EMAILS] },
        userId: { notIn: [...QA_USER_IDS] },
      },
    }),
  ]);
  const expectedById = new Map([[QA_USER_ID, QA_EMAIL], [QA_ADMIN_USER_ID, QA_ADMIN_EMAIL]]);
  const expectedByEmail = new Map([[QA_EMAIL, QA_USER_ID], [QA_ADMIN_EMAIL, QA_ADMIN_USER_ID]]);
  for (const user of usersById) {
    assert.equal(user.email, expectedById.get(user.id), "A V0.7.1 QA user ID is occupied by another identity.");
  }
  for (const user of usersByEmail) {
    assert.equal(user.id, expectedByEmail.get(user.email), "A V0.7.1 QA email is occupied by another identity.");
  }
  assert.equal(foreignOrders, 0, "The V0.7.1 QA email is linked to an unexpected Order.");
}

async function fixtureScope() {
  stage = "scope";
  const orders = await prisma.order.findMany({
    where: { userId: { in: [...QA_USER_IDS] } },
    select: {
      id: true,
      assets: { include: { asset: true } },
      payments: { select: { id: true } },
    },
  });
  return {
    orderIds: orders.map(({ id }) => id),
    paymentIds: orders.flatMap(({ payments }) => payments.map(({ id }) => id)),
    assets: orders.flatMap(({ assets }) => assets.map(({ asset }) => asset)),
  };
}

async function cleanup() {
  await assertFixtureIdentity();
  const scope = await fixtureScope();
  stage = "private-media-cleanup";
  for (const asset of scope.assets) await deletePrivateOrderFile(asset);

  stage = "database-cleanup";
  await prisma.$transaction(async (transaction) => {
    if (scope.paymentIds.length) {
      await transaction.providerEvent.deleteMany({ where: { paymentId: { in: scope.paymentIds } } });
      await transaction.payment.deleteMany({ where: { id: { in: scope.paymentIds } } });
    }
    if (scope.orderIds.length) {
      await transaction.orderNotification.deleteMany({ where: { orderId: { in: scope.orderIds } } });
      await transaction.orderEvent.deleteMany({ where: { orderId: { in: scope.orderIds } } });
      await transaction.orderAsset.deleteMany({ where: { orderId: { in: scope.orderIds } } });
      await transaction.commercialLicense.deleteMany({ where: { orderId: { in: scope.orderIds } } });
      await transaction.order.deleteMany({ where: { id: { in: scope.orderIds }, userId: { in: [...QA_USER_IDS] } } });
    }
    const assetIds = [...new Set(scope.assets.map(({ id }) => id))];
    if (assetIds.length) {
      await transaction.asset.deleteMany({
        where: { id: { in: assetIds }, projects: { none: {} }, orders: { none: {} } },
      });
    }
    await transaction.customer.deleteMany({ where: { userId: { in: [...QA_USER_IDS] }, email: { in: [...QA_EMAILS] } } });
    await transaction.session.deleteMany({ where: { userId: { in: [...QA_USER_IDS] } } });
    await transaction.account.deleteMany({ where: { OR: [{ id: { in: [...QA_ACCOUNT_IDS] } }, { userId: { in: [...QA_USER_IDS] } }] } });
    await transaction.registrationAttempt.deleteMany({ where: { email: { in: [...QA_EMAILS] } } });
    await transaction.verification.deleteMany({ where: { identifier: { in: [...QA_EMAILS] } } });
    await transaction.rateLimit.deleteMany({ where: { key: { in: [...rateLimitKeys] } } });
    await transaction.user.deleteMany({ where: { id: { in: [...QA_USER_IDS] }, email: { in: [...QA_EMAILS] } } });
  });
}

async function assertClean() {
  stage = "postcondition";
  const [users, accounts, sessions, customers, orders, payments, events, notifications, rateLimits, attempts, verifications] = await Promise.all([
    prisma.user.count({ where: { OR: [{ id: { in: [...QA_USER_IDS] } }, { email: { in: [...QA_EMAILS] } }] } }),
    prisma.account.count({ where: { OR: [{ id: { in: [...QA_ACCOUNT_IDS] } }, { userId: { in: [...QA_USER_IDS] } }] } }),
    prisma.session.count({ where: { userId: { in: [...QA_USER_IDS] } } }),
    prisma.customer.count({ where: { OR: [{ userId: { in: [...QA_USER_IDS] } }, { email: { in: [...QA_EMAILS] } }] } }),
    prisma.order.count({ where: { OR: [{ userId: { in: [...QA_USER_IDS] } }, { customerEmail: { in: [...QA_EMAILS] } }] } }),
    prisma.payment.count({ where: { order: { userId: { in: [...QA_USER_IDS] } } } }),
    prisma.providerEvent.count({ where: { payment: { order: { userId: { in: [...QA_USER_IDS] } } } } }),
    prisma.orderNotification.count({ where: { order: { userId: { in: [...QA_USER_IDS] } } } }),
    prisma.rateLimit.count({ where: { key: { in: [...rateLimitKeys] } } }),
    prisma.registrationAttempt.count({ where: { email: { in: [...QA_EMAILS] } } }),
    prisma.verification.count({ where: { identifier: { in: [...QA_EMAILS] } } }),
  ]);
  assert.ok(
    [users, accounts, sessions, customers, orders, payments, events, notifications, rateLimits, attempts, verifications]
      .every((count) => count === 0),
    "The V0.7.1 Checkout browser fixture cleanup is incomplete.",
  );
}

async function setup(password: string) {
  stage = "setup";
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (transaction) => {
    await transaction.user.createMany({ data: [
      { id: QA_USER_ID, email: QA_EMAIL, displayName: QA_DISPLAY_NAME, emailVerified: true, emailVerifiedAt: new Date(), role: "MEMBER", status: "ACTIVE" },
      { id: QA_ADMIN_USER_ID, email: QA_ADMIN_EMAIL, displayName: QA_ADMIN_DISPLAY_NAME, emailVerified: true, emailVerifiedAt: new Date(), role: "ADMIN", status: "ACTIVE" },
    ] });
    await transaction.account.createMany({ data: [
      { id: QA_ACCOUNT_ID, userId: QA_USER_ID, accountId: QA_USER_ID, providerId: "credential", password: passwordHash },
      { id: QA_ADMIN_ACCOUNT_ID, userId: QA_ADMIN_USER_ID, accountId: QA_ADMIN_USER_ID, providerId: "credential", password: passwordHash },
    ] });
  });
  const stored = await prisma.user.findUniqueOrThrow({
    where: { id: QA_USER_ID },
    select: { email: true, role: true, status: true, emailVerified: true, orders: { select: { id: true } } },
  });
  assert.deepEqual(stored, {
    email: QA_EMAIL,
    role: "MEMBER",
    status: "ACTIVE",
    emailVerified: true,
    orders: [],
  });
  assert.deepEqual(await prisma.user.findUniqueOrThrow({
    where: { id: QA_ADMIN_USER_ID },
    select: { email: true, role: true, status: true, emailVerified: true, orders: { select: { id: true } } },
  }), {
    email: QA_ADMIN_EMAIL,
    role: "ADMIN",
    status: "ACTIVE",
    emailVerified: true,
    orders: [],
  });
}

async function run() {
  stage = "guard";
  const runtime = await loadAndAssertPaymentQaDatabaseEnvironment();
  assert.equal(runtime.baseUrl, "http://localhost:31740", "V0.7.4 browser QA requires localhost:31740.");
  const operation = process.argv[2];
  assert.ok(operation === "setup" || operation === "cleanup", "Use setup or cleanup.");
  await cleanup();
  await assertClean();
  if (operation === "cleanup") {
    console.info("Checkout browser QA fixture removed.");
    return;
  }
  const password = process.env.LNX_AUTH_QA_PASSWORD;
  assert.ok(password && password.length >= 12, "LNX_AUTH_QA_PASSWORD is required.");
  try {
    await setup(password);
  } catch (error) {
    await cleanup();
    await assertClean();
    throw error;
  }
  console.info(`Checkout browser QA MEMBER: ${QA_EMAIL}`);
  console.info(`Checkout browser QA ADMIN: ${QA_ADMIN_EMAIL}`);
  console.info("Start at /commander with no pre-created Order.");
}

run()
  .finally(() => prisma.$disconnect())
  .catch(() => {
    console.error(`Checkout browser QA fixture operation failed at ${stage}.`);
    process.exitCode = 1;
  });
