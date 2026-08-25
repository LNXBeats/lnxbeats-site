import assert from "node:assert/strict";

import type { OrderActor, OrderDraftInput } from "@/lib/orders/domain";
import { finalizeOrder } from "@/lib/orders/service";
import { hashPassword } from "@/lib/auth/password";
import { loadAndAssertPaymentQaDatabaseEnvironment } from "@/lib/payments/qa-guard";
import { prisma } from "@/lib/prisma";

const QA_USER_ID = "70000000-0000-4700-8700-000000000001";
const QA_ACCOUNT_ID = "70000000-0000-4700-8700-000000000002";
const QA_EMAIL = "lnx-v070-stripe-browser-admin@example.invalid";
const QA_DISPLAY_NAME = "LNX Stripe Browser QA";
let fixtureStage = "startup";

const scenarios = [
  {
    name: "success",
    orderId: "70000000-0000-4700-8700-000000000050",
    initialEventId: "71000000-0000-4700-8700-000000000050",
    orderNumber: "LNX-2070-000050",
    title: "Stripe Test — succès 20 EUR",
    coverIncluded: false,
    priorityProcessing: false,
    basePriceCents: 2_000,
    coverPriceCents: 0,
    priorityPriceCents: 0,
    totalCents: 2_000,
  },
  {
    name: "decline",
    orderId: "70000000-0000-4700-8700-000000000060",
    initialEventId: "71000000-0000-4700-8700-000000000060",
    orderNumber: "LNX-2070-000060",
    title: "Stripe Test — refus 30 EUR",
    coverIncluded: true,
    priorityProcessing: false,
    basePriceCents: 2_000,
    coverPriceCents: 1_000,
    priorityPriceCents: 0,
    totalCents: 3_000,
  },
  {
    name: "three-d-secure",
    orderId: "70000000-0000-4700-8700-000000000080",
    initialEventId: "71000000-0000-4700-8700-000000000080",
    orderNumber: "LNX-2070-000080",
    title: "Stripe Test — 3DS 50 EUR",
    coverIncluded: false,
    priorityProcessing: true,
    basePriceCents: 2_000,
    coverPriceCents: 0,
    priorityPriceCents: 3_000,
    totalCents: 5_000,
  },
  {
    name: "cancel",
    orderId: "70000000-0000-4700-8700-000000000090",
    initialEventId: "71000000-0000-4700-8700-000000000090",
    orderNumber: "LNX-2070-000090",
    title: "Stripe Test — annulation 60 EUR",
    coverIncluded: true,
    priorityProcessing: true,
    basePriceCents: 2_000,
    coverPriceCents: 1_000,
    priorityPriceCents: 3_000,
    totalCents: 6_000,
  },
] as const;

const orderNumbers = scenarios.map(({ orderNumber }) => orderNumber);
const expectedOrderIds = new Map<string, string>(
  scenarios.map(({ orderNumber, orderId }) => [orderNumber, orderId]),
);
const fixtureRateLimitKeys = [
  "127.0.0.1|/sign-in/email",
  `payments:checkout:${QA_USER_ID}`,
  `orders:draft:${QA_USER_ID}`,
  `orders:finalize:${QA_USER_ID}`,
  `orders:upload:${QA_USER_ID}`,
  `orders:delete:${QA_USER_ID}`,
  `orders:rights:${QA_USER_ID}`,
] as const;

function inputForScenario(
  scenario: (typeof scenarios)[number],
): OrderDraftInput {
  return {
    title: scenario.title,
    recipient: "Personne fictive QA",
    occasion: "Validation Stripe Test locale",
    brief: "Cette commande fictive et jetable valide exclusivement le parcours navigateur Stripe Test V0.7.0.",
    musicalDirection: "Pop cinématographique",
    emotion: "Lumineuse",
    importantDetails: "Aucune donnée personnelle réelle.",
    wordsToInclude: "",
    avoid: "",
    pronunciationNotes: "",
    coverIncluded: scenario.coverIncluded,
    priorityProcessing: scenario.priorityProcessing,
  };
}

async function fixtureScope() {
  fixtureStage = "scope-orders-users";
  const [orders, userById, userByEmail] = await Promise.all([
    prisma.order.findMany({
      where: { orderNumber: { in: orderNumbers } },
      select: { id: true, orderNumber: true, userId: true, customerEmail: true },
    }),
    prisma.user.findUnique({
      where: { id: QA_USER_ID },
      select: { id: true, email: true },
    }),
    prisma.user.findUnique({
      where: { email: QA_EMAIL },
      select: { id: true, email: true },
    }),
  ]);

  fixtureStage = "scope-order-identities";
  for (const order of orders) {
    assert.equal(order.id, expectedOrderIds.get(order.orderNumber), "A deterministic QA order number is owned by an unexpected row.");
    assert.equal(order.userId, QA_USER_ID, "A deterministic QA order is owned by an unexpected user.");
    assert.equal(order.customerEmail, QA_EMAIL, "A deterministic QA order contains an unexpected email.");
  }
  if (userById) assert.equal(userById.email, QA_EMAIL, "The deterministic QA user ID is already occupied.");
  if (userByEmail) assert.equal(userByEmail.id, QA_USER_ID, "The deterministic QA email is already occupied.");

  const orderIds = orders.map(({ id }) => id);
  fixtureStage = "scope-payments-assets";
  const [payments, orderAssets] = await Promise.all([
    orderIds.length === 0
      ? []
      : prisma.payment.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        }),
    orderIds.length === 0
      ? []
      : prisma.orderAsset.findMany({
          where: { orderId: { in: orderIds } },
          select: { assetId: true },
        }),
  ]);
  return {
    orderIds,
    paymentIds: payments.map(({ id }) => id),
    assetIds: [...new Set(orderAssets.map(({ assetId }) => assetId))],
  } as const;
}

async function cleanupFixtures() {
  fixtureStage = "cleanup-scope";
  const scope = await fixtureScope();
  fixtureStage = "cleanup-transaction";
  await prisma.$transaction(async (transaction) => {
    if (scope.paymentIds.length > 0) {
      await transaction.providerEvent.deleteMany({
        where: { paymentId: { in: scope.paymentIds } },
      });
      await transaction.payment.deleteMany({
        where: { id: { in: scope.paymentIds } },
      });
    }
    if (scope.orderIds.length > 0) {
      await transaction.orderNotification.deleteMany({
        where: { orderId: { in: scope.orderIds } },
      });
      await transaction.orderEvent.deleteMany({
        where: { orderId: { in: scope.orderIds } },
      });
      await transaction.orderAsset.deleteMany({
        where: { orderId: { in: scope.orderIds } },
      });
      await transaction.commercialLicense.deleteMany({
        where: { orderId: { in: scope.orderIds } },
      });
      await transaction.order.deleteMany({
        where: {
          id: { in: scope.orderIds },
          orderNumber: { in: orderNumbers },
          userId: QA_USER_ID,
        },
      });
    }
    if (scope.assetIds.length > 0) {
      await transaction.asset.deleteMany({
        where: {
          id: { in: [...scope.assetIds] },
          projects: { none: {} },
          orders: { none: {} },
        },
      });
    }
    await transaction.session.deleteMany({ where: { userId: QA_USER_ID } });
    await transaction.account.deleteMany({ where: { userId: QA_USER_ID } });
    await transaction.user.deleteMany({
      where: { id: QA_USER_ID, email: QA_EMAIL },
    });
    await transaction.rateLimit.deleteMany({
      where: { key: { in: [...fixtureRateLimitKeys] } },
    });
  });
}

async function assertNoFixtures() {
  fixtureStage = "cleanup-postcondition";
  const [users, accounts, sessions, orders, events, assets, licenses, payments, providerEvents, notifications, rateLimits] = await Promise.all([
    prisma.user.count({ where: { OR: [{ id: QA_USER_ID }, { email: QA_EMAIL }] } }),
    prisma.account.count({ where: { OR: [{ id: QA_ACCOUNT_ID }, { userId: QA_USER_ID }] } }),
    prisma.session.count({ where: { userId: QA_USER_ID } }),
    prisma.order.count({ where: { orderNumber: { in: orderNumbers } } }),
    prisma.orderEvent.count({ where: { orderId: { in: scenarios.map(({ orderId }) => orderId) } } }),
    prisma.orderAsset.count({ where: { orderId: { in: scenarios.map(({ orderId }) => orderId) } } }),
    prisma.commercialLicense.count({ where: { orderId: { in: scenarios.map(({ orderId }) => orderId) } } }),
    prisma.payment.count({ where: { orderId: { in: scenarios.map(({ orderId }) => orderId) } } }),
    prisma.providerEvent.count({
      where: { payment: { orderId: { in: scenarios.map(({ orderId }) => orderId) } } },
    }),
    prisma.orderNotification.count({
      where: { orderId: { in: scenarios.map(({ orderId }) => orderId) } },
    }),
    prisma.rateLimit.count({ where: { key: { in: [...fixtureRateLimitKeys] } } }),
  ]);
  assert.ok(
    [users, accounts, sessions, orders, events, assets, licenses, payments, providerEvents, notifications, rateLimits]
      .every((count) => count === 0),
    "Stripe browser QA fixture cleanup is incomplete.",
  );
}

async function createFixtures(password: string) {
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (transaction) => {
    await transaction.user.create({
      data: {
        id: QA_USER_ID,
        email: QA_EMAIL,
        displayName: QA_DISPLAY_NAME,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    await transaction.account.create({
      data: {
        id: QA_ACCOUNT_ID,
        userId: QA_USER_ID,
        accountId: QA_USER_ID,
        providerId: "credential",
        password: passwordHash,
      },
    });
    for (const scenario of scenarios) {
      const input = inputForScenario(scenario);
      await transaction.order.create({
        data: {
          id: scenario.orderId,
          orderNumber: scenario.orderNumber,
          userId: QA_USER_ID,
          customerEmail: QA_EMAIL,
          customerName: QA_DISPLAY_NAME,
          status: "DRAFT",
          title: input.title,
          recipient: input.recipient,
          occasion: input.occasion,
          brief: input.brief,
          musicalDirection: input.musicalDirection,
          emotion: input.emotion,
          importantDetails: input.importantDetails,
          wordsToInclude: input.wordsToInclude,
          avoid: input.avoid,
          pronunciationNotes: input.pronunciationNotes,
          usage: "PERSONAL",
          coverIncluded: scenario.coverIncluded,
          priorityProcessing: scenario.priorityProcessing,
          basePriceCents: scenario.basePriceCents,
          coverPriceCents: scenario.coverPriceCents,
          priorityPriceCents: scenario.priorityPriceCents,
          totalCents: scenario.totalCents,
          currency: "EUR",
          pricingVersion: "2026-08-v2",
          contractRequired: false,
          events: {
            create: {
              id: scenario.initialEventId,
              toStatus: "DRAFT",
              note: "Brouillon Stripe Test V0.7.0 créé.",
              visibility: "CLIENT",
              actorUserId: QA_USER_ID,
            },
          },
        },
      });
    }
  });

  const actor = {
    id: QA_USER_ID,
    email: QA_EMAIL,
    name: QA_DISPLAY_NAME,
    role: "ADMIN",
    status: "ACTIVE",
    emailVerified: true,
  } satisfies OrderActor;
  for (const scenario of scenarios) {
    await finalizeOrder(actor, scenario.orderNumber, inputForScenario(scenario), true);
  }

  const stored = await prisma.order.findMany({
    where: { orderNumber: { in: orderNumbers } },
    select: {
      orderNumber: true,
      status: true,
      userId: true,
      coverIncluded: true,
      priorityProcessing: true,
      basePriceCents: true,
      coverPriceCents: true,
      priorityPriceCents: true,
      totalCents: true,
      currency: true,
      pricingVersion: true,
      submittedAt: true,
    },
    orderBy: { totalCents: "asc" },
  });
  assert.equal(stored.length, scenarios.length);
  for (const [index, order] of stored.entries()) {
    const expected = scenarios[index];
    assert.ok(expected);
    assert.equal(order.orderNumber, expected.orderNumber);
    assert.equal(order.status, "AWAITING_PAYMENT");
    assert.equal(order.userId, QA_USER_ID);
    assert.equal(order.coverIncluded, expected.coverIncluded);
    assert.equal(order.priorityProcessing, expected.priorityProcessing);
    assert.equal(order.basePriceCents, expected.basePriceCents);
    assert.equal(order.coverPriceCents, expected.coverPriceCents);
    assert.equal(order.priorityPriceCents, expected.priorityPriceCents);
    assert.equal(order.totalCents, expected.totalCents);
    assert.equal(order.currency, "EUR");
    assert.equal(order.pricingVersion, "2026-08-v2");
    assert.ok(order.submittedAt);
  }
}

async function run() {
  fixtureStage = "qa-guard";
  const runtime = await loadAndAssertPaymentQaDatabaseEnvironment();
  assert.equal(
    runtime.baseUrl,
    "http://localhost:31740",
    "Stripe browser QA requires its isolated localhost origin.",
  );
  const operation = process.argv[2];
  assert.ok(operation === "setup" || operation === "cleanup", "Use setup or cleanup.");

  await cleanupFixtures();
  await assertNoFixtures();
  if (operation === "cleanup") {
    console.info("Stripe browser QA fixtures removed.");
    return;
  }

  const password = process.env.LNX_AUTH_QA_PASSWORD;
  assert.ok(password && password.length >= 12, "LNX_AUTH_QA_PASSWORD is required.");
  try {
    await createFixtures(password);
  } catch (error) {
    await cleanupFixtures();
    await assertNoFixtures();
    throw error;
  }
  console.info(`Stripe browser QA ADMIN: ${QA_EMAIL}`);
  for (const scenario of scenarios) {
    console.info(`${scenario.name}: ${scenario.orderNumber}`);
  }
}

run()
  .finally(() => prisma.$disconnect())
  .catch(() => {
    console.error(`Stripe browser QA fixture operation failed at ${fixtureStage}.`);
    process.exitCode = 1;
  });
