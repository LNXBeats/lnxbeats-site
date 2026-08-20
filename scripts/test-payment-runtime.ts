import assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

import { transitionOrderStatus } from "@/lib/admin/service";
import type { OrderActor, OrderDraftInput } from "@/lib/orders/domain";
import { finalizeOrder, saveDraftOrder } from "@/lib/orders/service";
import {
  createPaymentDatabaseEditRepository,
  createStripeCheckoutForOrder,
  createPaymentDatabaseCheckoutRepository,
  paymentDatabaseCheckoutRepository,
  PaymentServiceError,
  prepareOrderForEditing,
} from "@/lib/payments/service";
import type {
  HostedCheckoutRequest,
  HostedCheckoutSession,
  StripeCheckoutGateway,
} from "@/lib/payments/stripe-client";
import {
  loadAndAssertPaymentQaDatabaseEnvironment,
  PAYMENT_QA_TARGET,
} from "@/lib/payments/qa-guard";
import {
  processVerifiedStripeWebhookEvent,
  type VerifiedStripeWebhookEvent,
} from "@/lib/payments/webhook";
import { prisma } from "@/lib/prisma";

const QA_EMAIL = "lnx-v070-payments-admin@example.invalid";
const QA_SECOND_EMAIL = "lnx-v070-payments-other@example.invalid";
const QA_EMAILS = [QA_EMAIL, QA_SECOND_EMAIL] as const;
const QA_ORDER_NUMBERS = [
  "LNX-2099-070001",
  "LNX-2099-070002",
  "LNX-2099-070003",
  "LNX-2099-070004",
  "LNX-2099-070005",
] as const;
const QA_EVENT_PREFIX = "evt_v070_qa_";

type PricingFixture = Readonly<{
  orderNumber: (typeof QA_ORDER_NUMBERS)[number];
  coverIncluded: boolean;
  priorityProcessing: boolean;
  coverPriceCents: number;
  priorityPriceCents: number;
  totalCents: number;
}>;

const pricingFixtures: readonly PricingFixture[] = [
  {
    orderNumber: QA_ORDER_NUMBERS[0],
    coverIncluded: false,
    priorityProcessing: false,
    coverPriceCents: 0,
    priorityPriceCents: 0,
    totalCents: 5_000,
  },
  {
    orderNumber: QA_ORDER_NUMBERS[1],
    coverIncluded: true,
    priorityProcessing: false,
    coverPriceCents: 1_000,
    priorityPriceCents: 0,
    totalCents: 6_000,
  },
  {
    orderNumber: QA_ORDER_NUMBERS[2],
    coverIncluded: false,
    priorityProcessing: true,
    coverPriceCents: 0,
    priorityPriceCents: 3_000,
    totalCents: 8_000,
  },
  {
    orderNumber: QA_ORDER_NUMBERS[3],
    coverIncluded: true,
    priorityProcessing: true,
    coverPriceCents: 1_000,
    priorityPriceCents: 3_000,
    totalCents: 9_000,
  },
] as const;

async function cleanupFixtures() {
  const users = await prisma.user.findMany({
    where: { email: { in: [...QA_EMAILS] } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  const orders = await prisma.order.findMany({
    where: { orderNumber: { in: [...QA_ORDER_NUMBERS] } },
    select: { id: true },
  });
  const orderIds = orders.map(({ id }) => id);
  const payments = orderIds.length === 0
    ? []
    : await prisma.payment.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      });
  const paymentIds = payments.map(({ id }) => id);

  await prisma.$transaction(async (transaction) => {
    await transaction.providerEvent.deleteMany({
      where: {
        OR: [
          { providerEventId: { startsWith: QA_EVENT_PREFIX } },
          ...(paymentIds.length > 0 ? [{ paymentId: { in: paymentIds } }] : []),
        ],
      },
    });
    if (paymentIds.length > 0) {
      await transaction.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    if (orderIds.length > 0) {
      await transaction.orderNotification.deleteMany({ where: { orderId: { in: orderIds } } });
      await transaction.orderAsset.deleteMany({ where: { orderId: { in: orderIds } } });
      await transaction.commercialLicense.deleteMany({ where: { orderId: { in: orderIds } } });
      await transaction.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await transaction.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    for (const userId of userIds) {
      await transaction.rateLimit.deleteMany({
        where: { key: `payments:checkout:${userId}` },
      });
    }
    if (userIds.length > 0) {
      await transaction.session.deleteMany({ where: { userId: { in: userIds } } });
      await transaction.account.deleteMany({ where: { userId: { in: userIds } } });
      await transaction.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });
}

async function assertFixturesClean(stage: string) {
  const [users, orders, events, notifications] = await Promise.all([
    prisma.user.count({ where: { email: { in: [...QA_EMAILS] } } }),
    prisma.order.count({ where: { orderNumber: { in: [...QA_ORDER_NUMBERS] } } }),
    prisma.providerEvent.count({
      where: { providerEventId: { startsWith: QA_EVENT_PREFIX } },
    }),
    prisma.orderNotification.count({ where: { order: { orderNumber: { in: [...QA_ORDER_NUMBERS] } } } }),
  ]);
  assert.equal(users, 0, `${stage}: the disposable payment user remains.`);
  assert.equal(orders, 0, `${stage}: disposable payment orders remain.`);
  assert.equal(events, 0, `${stage}: disposable Stripe event receipts remain.`);
  assert.equal(notifications, 0, `${stage}: disposable Order notifications remain.`);
}

function createMockGateway() {
  const requests: Array<{
    request: HostedCheckoutRequest;
    idempotencyKey: string;
  }> = [];
  const retrieved: string[] = [];
  const sessionsByKey = new Map<string, HostedCheckoutSession>();
  const sessionsById = new Map<string, HostedCheckoutSession>();

  const gateway: StripeCheckoutGateway = {
    async createHostedCheckout(request, idempotencyKey) {
      requests.push({ request, idempotencyKey });
      const existing = sessionsByKey.get(idempotencyKey);
      if (existing) return existing;
      const shortId = request.paymentId.replaceAll("-", "");
      const session = {
        id: `cs_test_v070_${shortId}`,
        url: `https://checkout.example.invalid/v070/${shortId}`,
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
        paymentIntentId: `pi_test_v070_${shortId}`,
      } satisfies HostedCheckoutSession;
      sessionsByKey.set(idempotencyKey, session);
      sessionsById.set(session.id, session);
      return session;
    },
    async retrieveHostedCheckout(checkoutId) {
      retrieved.push(checkoutId);
      const session = sessionsById.get(checkoutId);
      assert.ok(session, "The DB referenced an unknown mock Checkout Session.");
      return session;
    },
  };

  return { gateway, requests, retrieved };
}

function observedRepository(
  label: string,
  repository: ReturnType<typeof createPaymentDatabaseCheckoutRepository>,
) {
  async function observe<T>(phase: string, operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        && typeof error.code === "string"
        ? error.code
        : "UNKNOWN";
      const meta = error && typeof error === "object" && "meta" in error
        && error.meta && typeof error.meta === "object"
        ? error.meta as Record<string, unknown>
        : null;
      const driver = meta?.driverAdapterError && typeof meta.driverAdapterError === "object"
        ? meta.driverAdapterError as { cause?: Record<string, unknown> }
        : null;
      const cause = driver?.cause;
      const databaseCode = typeof cause?.originalCode === "string"
        ? cause.originalCode
        : "UNKNOWN";
      const constraint = typeof cause?.constraint === "string"
        ? cause.constraint
        : "UNKNOWN";
      console.error(
        `Payment runtime ${label}/${phase} failed (${code}; database ${databaseCode}; constraint ${constraint}).`,
      );
      throw error;
    }
  }
  return {
    enforceRateLimit: (actorId: string) => observe(
      "rate-limit",
      () => repository.enforceRateLimit(actorId),
    ),
    reserveAttempt: (actorId: string, orderNumber: string) => observe(
      "reservation",
      () => repository.reserveAttempt(actorId, orderNumber),
    ),
    recordSession: (paymentId: string, session: HostedCheckoutSession) => observe(
      "session",
      () => repository.recordSession(paymentId, session),
    ),
  };
}

function checkoutEvent(input: {
  eventId: string;
  type?: string;
  paymentId: string;
  orderId: string;
  checkoutId: string;
  paymentIntentId: string;
  amountCents: number;
  pricingVersion?: string;
  paymentStatus?: "paid" | "unpaid";
  checkoutStatus?: "complete" | "expired";
}): VerifiedStripeWebhookEvent {
  return {
    id: input.eventId,
    type: input.type ?? "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1_000),
    data: {
      object: {
        id: input.checkoutId,
        object: "checkout.session",
        mode: "payment",
        client_reference_id: input.orderId,
        metadata: {
          paymentId: input.paymentId,
          orderId: input.orderId,
          pricingVersion: input.pricingVersion ?? "2026-08-v1",
        },
        amount_total: input.amountCents,
        currency: "eur",
        payment_status: input.paymentStatus ?? "paid",
        status: input.checkoutStatus ?? "complete",
        livemode: false,
        payment_intent: input.paymentIntentId,
      },
    },
    paymentIntentEvidence: {
      id: input.paymentIntentId,
      amountCents: input.amountCents,
      currency: "EUR",
      livemode: false,
      status: "succeeded",
      paymentId: input.paymentId,
      orderId: input.orderId,
      pricingVersion: input.pricingVersion ?? "2026-08-v1",
      paymentMethod: "CARD",
    },
  };
}

function paymentIntentFailureEvent(input: {
  eventId: string;
  paymentId: string;
  orderId: string;
  paymentIntentId: string;
  amountCents: number;
  pricingVersion?: string;
}): VerifiedStripeWebhookEvent {
  return {
    id: input.eventId,
    type: "payment_intent.payment_failed",
    livemode: false,
    created: Math.floor(Date.now() / 1_000),
    data: {
      object: {
        id: input.paymentIntentId,
        object: "payment_intent",
        amount: input.amountCents,
        currency: "eur",
        livemode: false,
        status: "requires_payment_method",
        metadata: {
          paymentId: input.paymentId,
          orderId: input.orderId,
          pricingVersion: input.pricingVersion ?? "2026-08-v1",
        },
        last_payment_error: {
          payment_method: {
            id: `pm_test_v070_${input.paymentId.replaceAll("-", "")}`,
            object: "payment_method",
            type: "card",
          },
        },
      },
    },
  };
}

async function createOrders(userId: string) {
  await prisma.order.createMany({
    data: [
      ...pricingFixtures.map((fixture) => ({
        orderNumber: fixture.orderNumber,
        userId,
        customerEmail: QA_EMAIL,
        customerName: "LNX Payment QA",
        status: "AWAITING_PAYMENT" as const,
        title: `Payment runtime ${fixture.totalCents}`,
        brief: "Commande strictement fictive pour la QA PostgreSQL jetable V0.7.0.",
        usage: "PERSONAL" as const,
        coverIncluded: fixture.coverIncluded,
        priorityProcessing: fixture.priorityProcessing,
        basePriceCents: 5_000,
        coverPriceCents: fixture.coverPriceCents,
        priorityPriceCents: fixture.priorityPriceCents,
        totalCents: fixture.totalCents,
        currency: "EUR",
        pricingVersion: "2026-08-v1",
        contractRequired: false,
        submittedAt: new Date(),
      })),
      {
        orderNumber: QA_ORDER_NUMBERS[4],
        userId,
        customerEmail: QA_EMAIL,
        customerName: "LNX Payment QA",
        status: "AWAITING_PAYMENT" as const,
        title: "Payment SQL constraints",
        brief: "Commande strictement fictive pour les contraintes SQL de paiement.",
        usage: "PERSONAL" as const,
        totalCents: 5_000,
        submittedAt: new Date(),
      },
    ],
  });
}

async function run() {
  const runtime = await loadAndAssertPaymentQaDatabaseEnvironment();
  assert.equal(runtime.target, PAYMENT_QA_TARGET);

  await cleanupFixtures();
  await assertFixturesClean("precondition");
  const passed: string[] = [];

  try {
    const [user, secondUser] = await Promise.all([
      prisma.user.create({
        data: {
          email: QA_EMAIL,
          displayName: "LNX Payment Runtime QA",
          emailVerified: true,
          emailVerifiedAt: new Date(),
          role: "MEMBER",
          status: "ACTIVE",
        },
      }),
      prisma.user.create({
        data: {
          email: QA_SECOND_EMAIL,
          displayName: "LNX Payment Other QA",
          emailVerified: true,
          emailVerifiedAt: new Date(),
          role: "MEMBER",
          status: "ACTIVE",
        },
      }),
    ]);
    await createOrders(user.id);
    const actor = {
      id: user.id,
      email: user.email,
      name: user.displayName,
      role: "MEMBER",
      status: "ACTIVE",
      emailVerified: true,
    } satisfies OrderActor;
    assert.equal(user.role, actor.role);
    assert.equal(user.status, actor.status);
    assert.equal(user.emailVerified, actor.emailVerified);
    const secondActor = {
      id: secondUser.id,
      email: secondUser.email,
      name: secondUser.displayName,
      role: "MEMBER",
      status: "ACTIVE",
      emailVerified: true,
    } satisfies OrderActor;
    const mock = createMockGateway();
    const dependencies = {
      repository: paymentDatabaseCheckoutRepository,
      gateway: mock.gateway,
      baseUrl: runtime.baseUrl,
    } as const;

    const callsBeforeIdor = mock.requests.length + mock.retrieved.length;
    await assert.rejects(
      createStripeCheckoutForOrder(
        secondActor,
        pricingFixtures[0].orderNumber,
        dependencies,
      ),
      (error: unknown) => error instanceof PaymentServiceError
        && error.code === "ORDER_NOT_PAYABLE",
    );
    assert.equal(mock.requests.length + mock.retrieved.length, callsBeforeIdor);
    assert.equal(await prisma.payment.count({
      where: { order: { orderNumber: { in: [...QA_ORDER_NUMBERS] } } },
    }), 0);
    passed.push("IDOR rejected for a second verified MEMBER without gateway side effects");

    for (const fixture of pricingFixtures.slice(0, 3)) {
      const result = await createStripeCheckoutForOrder(
        actor,
        fixture.orderNumber,
        dependencies,
      );
      assert.match(result.checkoutUrl, /^https:\/\/checkout\.example\.invalid\//);
    }
    const connectionString = process.env.DATABASE_URL as string;
    const concurrentClients = [
      new PrismaClient({ adapter: new PrismaPg({ connectionString }) }),
      new PrismaClient({ adapter: new PrismaPg({ connectionString }) }),
    ] as const;
    let concurrentResults;
    try {
      concurrentResults = await Promise.all(concurrentClients.map((client, index) => (
        createStripeCheckoutForOrder(actor, pricingFixtures[3].orderNumber, {
          ...dependencies,
          repository: observedRepository(
            `client-${index + 1}`,
            createPaymentDatabaseCheckoutRepository(client),
          ),
        })
      )));
    } finally {
      await Promise.all(concurrentClients.map((client) => client.$disconnect()));
    }
    assert.equal(new Set(concurrentResults.map(({ checkoutUrl }) => checkoutUrl)).size, 1);

    const attempts = await prisma.payment.findMany({
      where: { order: { orderNumber: { in: pricingFixtures.map(({ orderNumber }) => orderNumber) } } },
      orderBy: { amountCents: "asc" },
    });
    assert.deepEqual(attempts.map(({ amountCents }) => amountCents), [5_000, 6_000, 8_000, 9_000]);
    assert.ok(attempts.every((attempt) => (
      attempt.provider === "STRIPE"
      && attempt.mode === "TEST"
      && attempt.status === "PENDING"
      && attempt.currency === "EUR"
      && attempt.providerCheckoutId?.startsWith("cs_test_v070_")
      && attempt.providerPaymentId?.startsWith("pi_test_v070_")
    )));
    assert.equal(new Set(mock.requests.map(({ request }) => request.paymentId)).size, 4);
    for (const paymentId of new Set(mock.requests.map(({ request }) => request.paymentId))) {
      assert.equal(
        new Set(mock.requests
          .filter(({ request }) => request.paymentId === paymentId)
          .map(({ idempotencyKey }) => idempotencyKey)).size,
        1,
      );
    }
    const requestTotals = new Map(mock.requests.map(({ request }) => [
      request.orderId,
      request.lineItems.reduce((total, item) => total + item.price_data.unit_amount, 0),
    ]));
    for (const attempt of attempts) {
      assert.equal(requestTotals.get(attempt.orderId), attempt.amountCents);
    }
    passed.push("server pricing 50/60/80/90 EUR and concurrent Checkout idempotency across independent DB clients");

    const constraintOrder = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: QA_ORDER_NUMBERS[4] },
    });
    await assert.rejects(prisma.payment.create({
      data: {
        orderId: constraintOrder.id,
        mode: "TEST",
        amountCents: 0,
        currency: "EUR",
        pricingVersion: "2026-08-v1",
        idempotencyKey: "v070-runtime:invalid-zero",
      },
    }));
    await assert.rejects(prisma.payment.create({
      data: {
        orderId: constraintOrder.id,
        mode: "TEST",
        amountCents: 5_000,
        currency: "USD",
        pricingVersion: "2026-08-v1",
        idempotencyKey: "v070-runtime:invalid-currency",
      },
    }));
    await assert.rejects(prisma.payment.create({
      data: {
        orderId: constraintOrder.id,
        mode: "TEST",
        amountCents: 5_000,
        currency: "EUR",
        pricingVersion: "2026-08-v1",
        idempotencyKey: " ",
      },
    }));
    const pendingNinety = attempts.find(({ amountCents }) => amountCents === 9_000);
    assert.ok(pendingNinety);
    await assert.rejects(prisma.payment.create({
      data: {
        orderId: pendingNinety.orderId,
        mode: "TEST",
        amountCents: 9_000,
        currency: "EUR",
        pricingVersion: "2026-08-v1",
        idempotencyKey: "v070-runtime:second-active",
      },
    }));
    await assert.rejects(prisma.providerEvent.create({
      data: {
        provider: "STRIPE",
        providerEventId: " ",
        type: "checkout.session.completed",
        livemode: false,
        outcome: "IGNORED",
        processedAt: new Date(),
      },
    }));
    passed.push("Payment and ProviderEvent SQL checks plus one-active-attempt index");

    let expiredCheckoutId = "";
    await prepareOrderForEditing(actor, QA_ORDER_NUMBERS[3], {
      repository: createPaymentDatabaseEditRepository(prisma),
      gateway: {
        async expireHostedCheckout(checkoutId) {
          expiredCheckoutId = checkoutId;
          return { id: checkoutId, status: "expired" };
        },
      },
      assertQaRuntime: async () => {},
    });
    assert.equal(expiredCheckoutId, pendingNinety.providerCheckoutId);
    const changedInput = {
      title: "Payment runtime repriced",
      recipient: "Personne fictive QA",
      occasion: "Modification avant paiement",
      brief: "Cette commande fictive vérifie que la session à 90 euros est expirée avant le nouveau snapshot.",
      musicalDirection: "Pop",
      emotion: "Lumineuse",
      importantDetails: "Aucune donnée personnelle réelle.",
      wordsToInclude: "",
      avoid: "",
      pronunciationNotes: "",
      coverIncluded: true,
      priorityProcessing: false,
    } satisfies OrderDraftInput;
    await saveDraftOrder(actor, QA_ORDER_NUMBERS[3], changedInput);
    await finalizeOrder(actor, QA_ORDER_NUMBERS[3], changedInput, true);
    await createStripeCheckoutForOrder(actor, QA_ORDER_NUMBERS[3], dependencies);
    const repricedAttempts = await prisma.payment.findMany({
      where: { orderId: pendingNinety.orderId },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true, amountCents: true, providerCheckoutId: true },
    });
    assert.deepEqual(repricedAttempts.map(({ status, amountCents }) => ({ status, amountCents })), [
      { status: "EXPIRED", amountCents: 9_000 },
      { status: "PENDING", amountCents: 6_000 },
    ]);
    assert.notEqual(repricedAttempts[0]?.providerCheckoutId, repricedAttempts[1]?.providerCheckoutId);
    passed.push("editing expires the old Checkout before a new server-priced snapshot and Session");

    const fifty = attempts.find(({ amountCents }) => amountCents === 5_000);
    assert.ok(fifty?.providerCheckoutId && fifty.providerPaymentId);
    const fiftyEvent = checkoutEvent({
      eventId: `${QA_EVENT_PREFIX}success_50`,
      paymentId: fifty.id,
      orderId: fifty.orderId,
      checkoutId: fifty.providerCheckoutId,
      paymentIntentId: fifty.providerPaymentId,
      amountCents: fifty.amountCents,
    });
    const duplicateResults = [
      await processVerifiedStripeWebhookEvent(fiftyEvent),
      await processVerifiedStripeWebhookEvent(fiftyEvent),
    ];
    assert.deepEqual(duplicateResults.map(({ duplicate }) => duplicate).sort(), [false, true]);
    assert.ok(duplicateResults.every(({ outcome }) => outcome === "PROCESSED"));

    const paid = await prisma.payment.findUniqueOrThrow({
      where: { id: fifty.id },
      include: { order: true },
    });
    assert.equal(paid.status, "SUCCEEDED");
    assert.equal(paid.paymentMethod, "CARD");
    assert.ok(paid.paidAt);
    assert.equal(paid.order.status, "PAYMENT_CONFIRMED");
    assert.equal(await prisma.providerEvent.count({
      where: { providerEventId: fiftyEvent.id },
    }), 1);
    assert.equal(await prisma.orderEvent.count({
      where: {
        orderId: fifty.orderId,
        fromStatus: "AWAITING_PAYMENT",
        toStatus: "PAYMENT_CONFIRMED",
      },
    }), 1);

    const gatewayCallsAfterSuccess = mock.requests.length + mock.retrieved.length;
    await assert.rejects(
      createStripeCheckoutForOrder(actor, pricingFixtures[0].orderNumber, dependencies),
      (error: unknown) => error instanceof PaymentServiceError
        && error.code === "PAYMENT_ALREADY_COMPLETED",
    );
    assert.equal(mock.requests.length + mock.retrieved.length, gatewayCallsAfterSuccess);
    assert.equal(await prisma.payment.count({ where: { orderId: fifty.orderId } }), 1);
    passed.push("a successful order rejects a new Checkout before any gateway call");

    const lateExpired = checkoutEvent({
      eventId: `${QA_EVENT_PREFIX}late_expired_50`,
      type: "checkout.session.expired",
      paymentId: fifty.id,
      orderId: fifty.orderId,
      checkoutId: fifty.providerCheckoutId,
      paymentIntentId: fifty.providerPaymentId,
      amountCents: fifty.amountCents,
      paymentStatus: "unpaid",
      checkoutStatus: "expired",
    });
    assert.equal((await processVerifiedStripeWebhookEvent(lateExpired)).outcome, "PROCESSED");
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: fifty.id } })).status, "SUCCEEDED");
    await assert.rejects(prisma.payment.create({
      data: {
        orderId: fifty.orderId,
        mode: "TEST",
        status: "SUCCEEDED",
        amountCents: 5_000,
        currency: "EUR",
        pricingVersion: "2026-08-v1",
        idempotencyKey: "v070-runtime:second-success",
        paidAt: new Date(),
      },
    }));
    passed.push("atomic success, duplicate event receipt, one order event and monotonic late-event handling");

    const sixty = attempts.find(({ amountCents }) => amountCents === 6_000);
    assert.ok(sixty?.providerCheckoutId && sixty.providerPaymentId);
    const mismatch = await processVerifiedStripeWebhookEvent(checkoutEvent({
      eventId: `${QA_EVENT_PREFIX}mismatch_60`,
      paymentId: sixty.id,
      orderId: sixty.orderId,
      checkoutId: sixty.providerCheckoutId,
      paymentIntentId: sixty.providerPaymentId,
      amountCents: sixty.amountCents + 1,
    }));
    assert.equal(mismatch.outcome, "REQUIRES_REVIEW");
    const reviewed = await prisma.payment.findUniqueOrThrow({
      where: { id: sixty.id },
      include: { order: true },
    });
    assert.equal(reviewed.status, "REQUIRES_REVIEW");
    assert.equal(reviewed.failureCode, "WEBHOOK_AMOUNT_MISMATCH");
    assert.equal(reviewed.order.status, "AWAITING_PAYMENT");
    passed.push("amount mismatch quarantined transactionally without confirming the order");

    const eighty = attempts.find(({ amountCents }) => amountCents === 8_000);
    assert.ok(eighty?.providerCheckoutId && eighty.providerPaymentId);
    const failed = await processVerifiedStripeWebhookEvent(paymentIntentFailureEvent({
      eventId: `${QA_EVENT_PREFIX}card_declined_80`,
      paymentId: eighty.id,
      orderId: eighty.orderId,
      paymentIntentId: eighty.providerPaymentId,
      amountCents: eighty.amountCents,
    }));
    assert.equal(failed.outcome, "PROCESSED");
    const declined = await prisma.payment.findUniqueOrThrow({ where: { id: eighty.id } });
    assert.equal(declined.status, "FAILED");
    assert.equal(declined.failureCode, "STRIPE_PAYMENT_ATTEMPT_FAILED");
    assert.equal(declined.paymentMethod, null);

    const requestsBeforeRetry = mock.requests.length;
    const retrievalsBeforeRetry = mock.retrieved.length;
    await createStripeCheckoutForOrder(actor, QA_ORDER_NUMBERS[2], dependencies);
    assert.equal(mock.requests.length, requestsBeforeRetry);
    assert.equal(mock.retrieved.length, retrievalsBeforeRetry + 1);
    assert.equal(mock.retrieved.at(-1), eighty.providerCheckoutId);
    assert.equal(await prisma.payment.count({ where: { orderId: eighty.orderId } }), 1);

    await processVerifiedStripeWebhookEvent(checkoutEvent({
      eventId: `${QA_EVENT_PREFIX}expired_80`,
      type: "checkout.session.expired",
      paymentId: eighty.id,
      orderId: eighty.orderId,
      checkoutId: eighty.providerCheckoutId,
      paymentIntentId: eighty.providerPaymentId,
      amountCents: eighty.amountCents,
      paymentStatus: "unpaid",
      checkoutStatus: "expired",
    }));
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: eighty.id } })).status, "EXPIRED");

    await createStripeCheckoutForOrder(actor, QA_ORDER_NUMBERS[2], dependencies);
    const secondEighty = await prisma.payment.findFirstOrThrow({
      where: { orderId: eighty.orderId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    assert.notEqual(secondEighty.id, eighty.id);
    assert.ok(secondEighty.providerCheckoutId && secondEighty.providerPaymentId);
    await processVerifiedStripeWebhookEvent(checkoutEvent({
      eventId: `${QA_EVENT_PREFIX}terminal_failed_80`,
      type: "checkout.session.async_payment_failed",
      paymentId: secondEighty.id,
      orderId: secondEighty.orderId,
      checkoutId: secondEighty.providerCheckoutId,
      paymentIntentId: secondEighty.providerPaymentId,
      amountCents: secondEighty.amountCents,
      paymentStatus: "unpaid",
      checkoutStatus: "complete",
    }));
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: secondEighty.id } })).status, "FAILED");

    await createStripeCheckoutForOrder(actor, QA_ORDER_NUMBERS[2], dependencies);
    assert.deepEqual(
      (await prisma.payment.findMany({
        where: { orderId: eighty.orderId },
        select: { status: true },
        orderBy: { createdAt: "asc" },
      })).map(({ status }) => status),
      ["EXPIRED", "FAILED", "PENDING"],
    );
    passed.push("card refusal stays FAILED on the same Checkout until expiration; terminal failure permits a fresh retry");

    // The runtime deliberately exercises more than the public quota of ten
    // Checkout requests. Reset only this disposable actor's bucket before the
    // independent Admin/webhook race scenario; production limits stay intact.
    await prisma.rateLimit.deleteMany({
      where: { key: `payments:checkout:${actor.id}` },
    });

    await createStripeCheckoutForOrder(actor, QA_ORDER_NUMBERS[4], dependencies);
    const racedPayment = await prisma.payment.findFirstOrThrow({
      where: { order: { orderNumber: QA_ORDER_NUMBERS[4] } },
    });
    assert.ok(racedPayment.providerCheckoutId && racedPayment.providerPaymentId);
    const raceResults = await Promise.allSettled([
      processVerifiedStripeWebhookEvent(checkoutEvent({
        eventId: `${QA_EVENT_PREFIX}success_cancel_race`,
        paymentId: racedPayment.id,
        orderId: racedPayment.orderId,
        checkoutId: racedPayment.providerCheckoutId,
        paymentIntentId: racedPayment.providerPaymentId,
        amountCents: racedPayment.amountCents,
      })),
      transitionOrderStatus(QA_ORDER_NUMBERS[4], "CANCELLED", actor.id),
    ]);
    const [racedOrderAfter, racedPaymentAfter] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { orderNumber: QA_ORDER_NUMBERS[4] } }),
      prisma.payment.findUniqueOrThrow({ where: { id: racedPayment.id } }),
    ]);
    assert.equal(
      racedOrderAfter.status === "CANCELLED" && racedPaymentAfter.status === "SUCCEEDED",
      false,
      "An Order must never be cancelled while its Payment is succeeded.",
    );
    if (racedOrderAfter.status === "PAYMENT_CONFIRMED") {
      assert.equal(racedPaymentAfter.status, "SUCCEEDED");
      assert.equal(raceResults.filter(({ status }) => status === "rejected").length, 1);
    } else {
      assert.equal(racedOrderAfter.status, "CANCELLED");
      assert.equal(racedPaymentAfter.status, "REQUIRES_REVIEW");
    }
    assert.equal(await prisma.orderEvent.count({
      where: {
        orderId: racedOrderAfter.id,
        fromStatus: "AWAITING_PAYMENT",
        toStatus: { in: ["PAYMENT_CONFIRMED", "CANCELLED"] },
      },
    }), 1);
    passed.push("Admin cancellation and webhook success serialize to one coherent Order/Payment outcome");

    const unknownPayment = "99999999-9999-4999-8999-999999999999";
    const unknownOrder = "88888888-8888-4888-8888-888888888888";
    const missing = await processVerifiedStripeWebhookEvent(checkoutEvent({
      eventId: `${QA_EVENT_PREFIX}missing_payment`,
      paymentId: unknownPayment,
      orderId: unknownOrder,
      checkoutId: "cs_test_v070_missing",
      paymentIntentId: "pi_test_v070_missing",
      amountCents: 5_000,
    }));
    assert.equal(missing.outcome, "REQUIRES_REVIEW");
    const missingReceipt = await prisma.providerEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: {
          provider: "STRIPE",
          providerEventId: `${QA_EVENT_PREFIX}missing_payment`,
        },
      },
    });
    assert.equal(missingReceipt.paymentId, null);
    await assert.rejects(prisma.order.delete({ where: { id: pendingNinety.orderId } }));
    await assert.rejects(prisma.payment.delete({ where: { id: fifty.id } }));
    passed.push("unknown payment review receipt and restrictive payment foreign keys");

    console.info(`V0.7 payment runtime passed (${passed.length} groups):`);
    for (const label of passed) console.info(`- ${label}`);
  } finally {
    await cleanupFixtures();
    await assertFixturesClean("postcondition");
  }
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Payment runtime validation failed.");
    process.exitCode = 1;
  });
