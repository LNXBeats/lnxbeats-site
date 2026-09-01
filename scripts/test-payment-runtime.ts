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
import {
  capturePaypalOrderForOrder,
  createPaymentDatabasePaypalCaptureRepository,
  createPaypalOrderForOrder,
} from "@/lib/payments/paypal-service";
import type { PaypalGateway } from "@/lib/payments/paypal-client";
import { processVerifiedPaypalWebhookEvent } from "@/lib/payments/paypal-webhook";
import { prisma } from "@/lib/prisma";

const QA_EMAIL = "lnx-v074-payments-admin@example.invalid";
const QA_SECOND_EMAIL = "lnx-v074-payments-other@example.invalid";
const QA_EMAILS = [QA_EMAIL, QA_SECOND_EMAIL] as const;
const QA_ORDER_NUMBERS = [
  "LNX-2099-074001",
  "LNX-2099-074002",
  "LNX-2099-074003",
  "LNX-2099-074004",
  "LNX-2099-074005",
  "LNX-2099-074006",
] as const;
const QA_EVENT_PREFIX = "evt_v074_qa_";

type PricingFixture = Readonly<{
  orderNumber: (typeof QA_ORDER_NUMBERS)[number];
  coverIncluded: boolean;
  priorityProcessing: boolean;
  coverPriceCents: number;
  priorityPriceCents: number;
  totalCents: number;
}>;

function musicPaymentOrderId(payment: Readonly<{ orderId: string | null; shopOrderId?: string | null }>) {
  assert.equal(payment.shopOrderId ?? null, null, "The V1 payment runtime must never select a Shop payment.");
  assert.ok(payment.orderId, "The V1 payment runtime requires a musical Order.");
  return payment.orderId;
}

function musicCheckoutOrderId(request: HostedCheckoutRequest) {
  assert.notEqual(request.paymentSource, "SHOP_ORDER", "The V1 runtime must create a musical Checkout.");
  if (request.paymentSource === "SHOP_ORDER") throw new Error("Unexpected Shop Checkout request.");
  return request.orderId;
}

const pricingFixtures: readonly PricingFixture[] = [
  {
    orderNumber: QA_ORDER_NUMBERS[0],
    coverIncluded: false,
    priorityProcessing: false,
    coverPriceCents: 0,
    priorityPriceCents: 0,
    totalCents: 2_000,
  },
  {
    orderNumber: QA_ORDER_NUMBERS[1],
    coverIncluded: true,
    priorityProcessing: false,
    coverPriceCents: 1_000,
    priorityPriceCents: 0,
    totalCents: 3_000,
  },
  {
    orderNumber: QA_ORDER_NUMBERS[2],
    coverIncluded: false,
    priorityProcessing: true,
    coverPriceCents: 0,
    priorityPriceCents: 3_000,
    totalCents: 5_000,
  },
  {
    orderNumber: QA_ORDER_NUMBERS[3],
    coverIncluded: true,
    priorityProcessing: true,
    coverPriceCents: 1_000,
    priorityPriceCents: 3_000,
    totalCents: 6_000,
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

async function assertPaymentNotificationPair(orderId: string) {
  const notifications = await prisma.orderNotification.findMany({
    where: { orderId },
    orderBy: { kind: "asc" },
    select: { kind: true, idempotencyKey: true, deploymentEnvironment: true },
  });
  assert.deepEqual(notifications.map(({ kind }) => kind).sort(), [
    "CUSTOMER_PAYMENT_CONFIRMED",
    "OWNER_NEW_ORDER",
  ]);
  assert.deepEqual(notifications.map(({ idempotencyKey }) => idempotencyKey).sort(), [
    `order:${orderId}:owner-new:email`,
    `order:${orderId}:payment-confirmed:email`,
  ]);
  assert.equal(new Set(notifications.map(({ deploymentEnvironment }) => deploymentEnvironment)).size, 1);
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
        id: `cs_test_v074_${shortId}`,
        url: `https://checkout.example.invalid/v074/${shortId}`,
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
        paymentIntentId: `pi_test_v074_${shortId}`,
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

function createMockPaypalGateway() {
  let createCalls = 0;
  let retrieveCalls = 0;
  let captureCalls = 0;
  const gateway: PaypalGateway = {
    async createOrder(request) {
      createCalls += 1;
      const id = `PAYPAL-ORDER-${request.paymentId.replaceAll("-", "")}`;
      return {
        id,
        status: "CREATED",
        approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`,
      };
    },
    async retrieveOrder(providerOrderId) {
      retrieveCalls += 1;
      return {
        id: providerOrderId,
        status: "CREATED",
        approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${providerOrderId}`,
      };
    },
    async captureOrder(providerOrderId) {
      captureCalls += 1;
      throw new Error(`Unexpected PayPal capture for ${providerOrderId.length} character identifier.`);
    },
    async verifyWebhook() { return true; },
  };
  return {
    gateway,
    counts: () => ({ createCalls, retrieveCalls, captureCalls }),
  };
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
          pricingVersion: input.pricingVersion ?? "2026-08-v2",
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
      pricingVersion: input.pricingVersion ?? "2026-08-v2",
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
          pricingVersion: input.pricingVersion ?? "2026-08-v2",
        },
        last_payment_error: {
          payment_method: {
            id: `pm_test_v074_${input.paymentId.replaceAll("-", "")}`,
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
        illustrationFormat: fixture.coverIncluded ? "SQUARE" as const : null,
        illustrationFormatCustom: null,
        basePriceCents: 2_000,
        coverPriceCents: fixture.coverPriceCents,
        priorityPriceCents: fixture.priorityPriceCents,
        totalCents: fixture.totalCents,
        currency: "EUR",
        pricingVersion: "2026-08-v2",
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
      {
        orderNumber: QA_ORDER_NUMBERS[5],
        userId,
        customerEmail: QA_EMAIL,
        customerName: "LNX PayPal QA",
        status: "AWAITING_PAYMENT" as const,
        title: "PayPal runtime reconciliation",
        brief: "Commande strictement fictive pour la réconciliation PayPal PostgreSQL.",
        usage: "PERSONAL" as const,
        coverIncluded: false,
        priorityProcessing: false,
        basePriceCents: 5_000,
        coverPriceCents: 0,
        priorityPriceCents: 0,
        totalCents: 5_000,
        currency: "EUR",
        pricingVersion: "2026-08-v1",
        contractRequired: false,
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
    assert.deepEqual(attempts.map(({ amountCents }) => amountCents), [2_000, 3_000, 5_000, 6_000]);
    assert.ok(attempts.every((attempt) => (
      attempt.provider === "STRIPE"
      && attempt.mode === "TEST"
      && attempt.status === "PENDING"
      && attempt.currency === "EUR"
      && attempt.pricingVersion === "2026-08-v2"
      && attempt.providerCheckoutId?.startsWith("cs_test_v074_")
      && attempt.providerPaymentId?.startsWith("pi_test_v074_")
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
      musicCheckoutOrderId(request),
      request.lineItems.reduce((total, item) => total + item.price_data.unit_amount, 0),
    ]));
    for (const attempt of attempts) {
      assert.equal(requestTotals.get(musicPaymentOrderId(attempt)), attempt.amountCents);
    }
    passed.push("server pricing 20/30/50/60 EUR and concurrent Checkout idempotency across independent DB clients");

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
        idempotencyKey: "v074-runtime:invalid-zero",
      },
    }));
    await assert.rejects(prisma.payment.create({
      data: {
        orderId: constraintOrder.id,
        mode: "TEST",
        amountCents: 5_000,
        currency: "USD",
        pricingVersion: "2026-08-v1",
        idempotencyKey: "v074-runtime:invalid-currency",
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
    const pendingMaximum = attempts.find(({ amountCents }) => amountCents === 6_000);
    assert.ok(pendingMaximum);
    const pendingMaximumOrderId = musicPaymentOrderId(pendingMaximum);
    await assert.rejects(prisma.payment.create({
      data: {
        orderId: pendingMaximumOrderId,
        mode: "TEST",
        amountCents: 6_000,
        currency: "EUR",
        pricingVersion: "2026-08-v2",
        idempotencyKey: "v074-runtime:second-active",
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
    assert.equal(expiredCheckoutId, pendingMaximum.providerCheckoutId);
    const changedInput = {
      title: "Payment runtime repriced",
      recipient: "Personne fictive QA",
      occasion: "Modification avant paiement",
      brief: "Cette commande fictive vérifie que la session à 60 euros est expirée avant le nouveau snapshot.",
      musicalDirection: "Pop",
      emotion: "Lumineuse",
      importantDetails: "Aucune donnée personnelle réelle.",
      wordsToInclude: "",
      avoid: "",
      pronunciationNotes: "",
      illustrationFormat: "SQUARE",
      illustrationFormatCustom: "",
      coverIncluded: true,
      priorityProcessing: false,
    } satisfies OrderDraftInput;
    await saveDraftOrder(actor, QA_ORDER_NUMBERS[3], changedInput);
    await finalizeOrder(actor, QA_ORDER_NUMBERS[3], changedInput, {
      personalUseTermsAccepted: true,
      earlyPerformanceConsentAccepted: true,
    });
    await createStripeCheckoutForOrder(actor, QA_ORDER_NUMBERS[3], dependencies);
    const repricedAttempts = await prisma.payment.findMany({
      where: { orderId: pendingMaximumOrderId },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true, amountCents: true, providerCheckoutId: true },
    });
    assert.deepEqual(repricedAttempts.map(({ status, amountCents }) => ({ status, amountCents })), [
      { status: "EXPIRED", amountCents: 6_000 },
      { status: "PENDING", amountCents: 3_000 },
    ]);
    assert.notEqual(repricedAttempts[0]?.providerCheckoutId, repricedAttempts[1]?.providerCheckoutId);
    passed.push("editing expires the old Checkout before a new server-priced snapshot and Session");

    const repricedStripe = await prisma.payment.findFirstOrThrow({
      where: { orderId: pendingMaximumOrderId, provider: "STRIPE", status: "PENDING" },
    });
    assert.ok(repricedStripe.providerCheckoutId && repricedStripe.providerPaymentId);
    const paypal = createMockPaypalGateway();
    await createPaypalOrderForOrder(actor, QA_ORDER_NUMBERS[3], {
      repository: createPaymentDatabaseCheckoutRepository(prisma, "PAYPAL"),
      gateway: paypal.gateway,
      baseUrl: runtime.baseUrl,
    });
    const paypalAttempt = await prisma.payment.findFirstOrThrow({
      where: { orderId: pendingMaximumOrderId, provider: "PAYPAL", status: "PENDING" },
    });
    assert.ok(paypalAttempt.providerCheckoutId);
    assert.deepEqual(paypal.counts(), { createCalls: 1, retrieveCalls: 0, captureCalls: 0 });

    const stripeWins = await processVerifiedStripeWebhookEvent(checkoutEvent({
      eventId: `${QA_EVENT_PREFIX}stripe_wins_double_provider`,
      paymentId: repricedStripe.id,
      orderId: musicPaymentOrderId(repricedStripe),
      checkoutId: repricedStripe.providerCheckoutId,
      paymentIntentId: repricedStripe.providerPaymentId,
      amountCents: repricedStripe.amountCents,
    }));
    assert.equal(stripeWins.outcome, "PROCESSED");
    const [doubleProviderOrder, doubleProviderStripe, doubleProviderPaypal] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: pendingMaximumOrderId } }),
      prisma.payment.findUniqueOrThrow({ where: { id: repricedStripe.id } }),
      prisma.payment.findUniqueOrThrow({ where: { id: paypalAttempt.id } }),
    ]);
    assert.equal(doubleProviderOrder.status, "PAYMENT_CONFIRMED");
    assert.equal(doubleProviderStripe.status, "SUCCEEDED");
    assert.equal(doubleProviderPaypal.status, "CANCELED");
    assert.equal(doubleProviderPaypal.failureCode, "ORDER_PAID_BY_OTHER_PROVIDER");
    assert.equal(await prisma.payment.count({
      where: { orderId: pendingMaximumOrderId, status: { in: ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"] } },
    }), 1);
    await assertPaymentNotificationPair(pendingMaximumOrderId);
    const latePaypalCapture = await processVerifiedPaypalWebhookEvent({
      id: `${QA_EVENT_PREFIX}paypal_after_stripe`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      create_time: new Date().toISOString(),
      resource: {
        id: "PAYPAL-CAPTURE-AFTER-STRIPE",
        status: "COMPLETED",
        amount: { currency_code: "EUR", value: "30.00" },
        supplementary_data: {
          related_ids: { order_id: paypalAttempt.providerCheckoutId },
        },
      },
    });
    assert.equal(latePaypalCapture.outcome, "REQUIRES_REVIEW");
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: paypalAttempt.id } })).status, "REQUIRES_REVIEW");
    assert.equal(await prisma.payment.count({
      where: { orderId: pendingMaximumOrderId, status: { in: ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"] } },
    }), 1);
    await assertPaymentNotificationPair(pendingMaximumOrderId);
    await assert.rejects(
      capturePaypalOrderForOrder(actor, QA_ORDER_NUMBERS[3], paypalAttempt.providerCheckoutId, {
        repository: createPaymentDatabasePaypalCaptureRepository(prisma),
        gateway: paypal.gateway,
      }),
      (error: unknown) => error instanceof PaymentServiceError
        && error.code === "PAYMENT_ALREADY_COMPLETED",
    );
    assert.equal(paypal.counts().captureCalls, 0);
    await assertPaymentNotificationPair(pendingMaximumOrderId);
    passed.push("Stripe and PayPal may be prepared concurrently; Stripe wins once and late PayPal capture is quarantined without duplicate notifications");

    const baseOnly = attempts.find(({ amountCents }) => amountCents === 2_000);
    assert.ok(baseOnly?.providerCheckoutId && baseOnly.providerPaymentId);
    const baseOnlyOrderId = musicPaymentOrderId(baseOnly);
    const baseOnlyEvent = checkoutEvent({
      eventId: `${QA_EVENT_PREFIX}success_20`,
      paymentId: baseOnly.id,
      orderId: baseOnlyOrderId,
      checkoutId: baseOnly.providerCheckoutId,
      paymentIntentId: baseOnly.providerPaymentId,
      amountCents: baseOnly.amountCents,
    });
    const duplicateResults = [
      await processVerifiedStripeWebhookEvent(baseOnlyEvent),
      await processVerifiedStripeWebhookEvent(baseOnlyEvent),
    ];
    assert.deepEqual(duplicateResults.map(({ duplicate }) => duplicate).sort(), [false, true]);
    assert.ok(duplicateResults.every(({ outcome }) => outcome === "PROCESSED"));

    const paid = await prisma.payment.findUniqueOrThrow({
      where: { id: baseOnly.id },
      include: { order: true },
    });
    assert.equal(paid.status, "SUCCEEDED");
    assert.equal(paid.paymentMethod, "CARD");
    assert.ok(paid.paidAt);
    assert.ok(paid.order);
    assert.equal(paid.order.status, "PAYMENT_CONFIRMED");
    assert.equal(await prisma.providerEvent.count({
      where: { providerEventId: baseOnlyEvent.id },
    }), 1);
    assert.equal(await prisma.orderEvent.count({
      where: {
        orderId: baseOnlyOrderId,
        fromStatus: "AWAITING_PAYMENT",
        toStatus: "PAYMENT_CONFIRMED",
      },
    }), 1);
    await assertPaymentNotificationPair(baseOnlyOrderId);

    const gatewayCallsAfterSuccess = mock.requests.length + mock.retrieved.length;
    await assert.rejects(
      createStripeCheckoutForOrder(actor, pricingFixtures[0].orderNumber, dependencies),
      (error: unknown) => error instanceof PaymentServiceError
        && error.code === "PAYMENT_ALREADY_COMPLETED",
    );
    assert.equal(mock.requests.length + mock.retrieved.length, gatewayCallsAfterSuccess);
    assert.equal(await prisma.payment.count({ where: { orderId: baseOnlyOrderId } }), 1);
    passed.push("a successful order rejects a new Checkout before any gateway call");

    const lateExpired = checkoutEvent({
      eventId: `${QA_EVENT_PREFIX}late_expired_20`,
      type: "checkout.session.expired",
      paymentId: baseOnly.id,
      orderId: baseOnlyOrderId,
      checkoutId: baseOnly.providerCheckoutId,
      paymentIntentId: baseOnly.providerPaymentId,
      amountCents: baseOnly.amountCents,
      paymentStatus: "unpaid",
      checkoutStatus: "expired",
    });
    assert.equal((await processVerifiedStripeWebhookEvent(lateExpired)).outcome, "PROCESSED");
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: baseOnly.id } })).status, "SUCCEEDED");
    await assert.rejects(prisma.payment.create({
      data: {
        orderId: baseOnlyOrderId,
        mode: "TEST",
        status: "SUCCEEDED",
        amountCents: 2_000,
        currency: "EUR",
        pricingVersion: "2026-08-v2",
        idempotencyKey: "v074-runtime:second-success",
        paidAt: new Date(),
      },
    }));
    passed.push("atomic success, duplicate event receipt, one order event and monotonic late-event handling");

    const coverOnly = attempts.find(({ amountCents }) => amountCents === 3_000);
    assert.ok(coverOnly?.providerCheckoutId && coverOnly.providerPaymentId);
    const coverOnlyOrderId = musicPaymentOrderId(coverOnly);
    const mismatch = await processVerifiedStripeWebhookEvent(checkoutEvent({
      eventId: `${QA_EVENT_PREFIX}mismatch_30`,
      paymentId: coverOnly.id,
      orderId: coverOnlyOrderId,
      checkoutId: coverOnly.providerCheckoutId,
      paymentIntentId: coverOnly.providerPaymentId,
      amountCents: coverOnly.amountCents + 1,
    }));
    assert.equal(mismatch.outcome, "REQUIRES_REVIEW");
    const reviewed = await prisma.payment.findUniqueOrThrow({
      where: { id: coverOnly.id },
      include: { order: true },
    });
    assert.equal(reviewed.status, "REQUIRES_REVIEW");
    assert.equal(reviewed.failureCode, "WEBHOOK_AMOUNT_MISMATCH");
    assert.ok(reviewed.order);
    assert.equal(reviewed.order.status, "AWAITING_PAYMENT");
    assert.equal(await prisma.orderNotification.count({ where: { orderId: coverOnlyOrderId } }), 0);
    passed.push("amount mismatch quarantined transactionally without confirming the order");

    const priorityOnly = attempts.find(({ amountCents }) => amountCents === 5_000);
    assert.ok(priorityOnly?.providerCheckoutId && priorityOnly.providerPaymentId);
    const priorityOnlyOrderId = musicPaymentOrderId(priorityOnly);
    const failed = await processVerifiedStripeWebhookEvent(paymentIntentFailureEvent({
      eventId: `${QA_EVENT_PREFIX}card_declined_50`,
      paymentId: priorityOnly.id,
      orderId: priorityOnlyOrderId,
      paymentIntentId: priorityOnly.providerPaymentId,
      amountCents: priorityOnly.amountCents,
    }));
    assert.equal(failed.outcome, "PROCESSED");
    const declined = await prisma.payment.findUniqueOrThrow({ where: { id: priorityOnly.id } });
    assert.equal(declined.status, "FAILED");
    assert.equal(declined.failureCode, "STRIPE_PAYMENT_ATTEMPT_FAILED");
    assert.equal(declined.paymentMethod, null);
    assert.equal(await prisma.orderNotification.count({ where: { orderId: priorityOnlyOrderId } }), 0);

    const requestsBeforeRetry = mock.requests.length;
    const retrievalsBeforeRetry = mock.retrieved.length;
    await createStripeCheckoutForOrder(actor, QA_ORDER_NUMBERS[2], dependencies);
    assert.equal(mock.requests.length, requestsBeforeRetry);
    assert.equal(mock.retrieved.length, retrievalsBeforeRetry + 1);
    assert.equal(mock.retrieved.at(-1), priorityOnly.providerCheckoutId);
    assert.equal(await prisma.payment.count({ where: { orderId: priorityOnlyOrderId } }), 1);

    await processVerifiedStripeWebhookEvent(checkoutEvent({
      eventId: `${QA_EVENT_PREFIX}expired_50`,
      type: "checkout.session.expired",
      paymentId: priorityOnly.id,
      orderId: priorityOnlyOrderId,
      checkoutId: priorityOnly.providerCheckoutId,
      paymentIntentId: priorityOnly.providerPaymentId,
      amountCents: priorityOnly.amountCents,
      paymentStatus: "unpaid",
      checkoutStatus: "expired",
    }));
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: priorityOnly.id } })).status, "EXPIRED");

    await createStripeCheckoutForOrder(actor, QA_ORDER_NUMBERS[2], dependencies);
    const secondPriority = await prisma.payment.findFirstOrThrow({
      where: { orderId: priorityOnlyOrderId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    assert.notEqual(secondPriority.id, priorityOnly.id);
    assert.ok(secondPriority.providerCheckoutId && secondPriority.providerPaymentId);
    await processVerifiedStripeWebhookEvent(checkoutEvent({
      eventId: `${QA_EVENT_PREFIX}terminal_failed_50`,
      type: "checkout.session.async_payment_failed",
      paymentId: secondPriority.id,
      orderId: musicPaymentOrderId(secondPriority),
      checkoutId: secondPriority.providerCheckoutId,
      paymentIntentId: secondPriority.providerPaymentId,
      amountCents: secondPriority.amountCents,
      paymentStatus: "unpaid",
      checkoutStatus: "complete",
    }));
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: secondPriority.id } })).status, "FAILED");

    // The new PayPal preparation adds one request to this intentionally broad
    // runtime scenario. Reset only the disposable actor before the independent
    // fresh-retry assertion; the production quota itself is tested elsewhere.
    await prisma.rateLimit.deleteMany({
      where: { key: `payments:checkout:${actor.id}` },
    });
    await createStripeCheckoutForOrder(actor, QA_ORDER_NUMBERS[2], dependencies);
    assert.deepEqual(
      (await prisma.payment.findMany({
        where: { orderId: priorityOnlyOrderId },
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
    assert.equal(racedPayment.amountCents, 5_000);
    assert.equal(racedPayment.pricingVersion, "2026-08-v1");
    const historicalCheckoutRequest = mock.requests.find(({ request }) => (
      request.paymentId === racedPayment.id
    ));
    assert.ok(historicalCheckoutRequest);
    assert.equal(historicalCheckoutRequest.request.pricingVersion, "2026-08-v1");
    assert.equal(historicalCheckoutRequest.request.lineItems.reduce(
      (total, item) => total + item.price_data.unit_amount,
      0,
    ), 5_000);
    const raceResults = await Promise.allSettled([
      processVerifiedStripeWebhookEvent(checkoutEvent({
        eventId: `${QA_EVENT_PREFIX}success_cancel_race`,
        paymentId: racedPayment.id,
        orderId: musicPaymentOrderId(racedPayment),
        checkoutId: racedPayment.providerCheckoutId,
        paymentIntentId: racedPayment.providerPaymentId,
        amountCents: racedPayment.amountCents,
        pricingVersion: racedPayment.pricingVersion,
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
    passed.push("historical v1 Checkout stays at 5000 cents while Admin cancellation and webhook success serialize coherently");

    const unknownPayment = "99999999-9999-4999-8999-999999999999";
    const unknownOrder = "88888888-8888-4888-8888-888888888888";
    const missing = await processVerifiedStripeWebhookEvent(checkoutEvent({
      eventId: `${QA_EVENT_PREFIX}missing_payment`,
      paymentId: unknownPayment,
      orderId: unknownOrder,
      checkoutId: "cs_test_v074_missing",
      paymentIntentId: "pi_test_v074_missing",
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
    await assert.rejects(prisma.order.delete({ where: { id: pendingMaximumOrderId } }));
    await assert.rejects(prisma.payment.delete({ where: { id: baseOnly.id } }));
    passed.push("unknown payment review receipt and restrictive payment foreign keys");

    await prisma.rateLimit.deleteMany({
      where: { key: `payments:checkout:${actor.id}` },
    });
    const paypalWebhookGateway = createMockPaypalGateway();
    await createPaypalOrderForOrder(actor, QA_ORDER_NUMBERS[5], {
      repository: createPaymentDatabaseCheckoutRepository(prisma, "PAYPAL"),
      gateway: paypalWebhookGateway.gateway,
      baseUrl: runtime.baseUrl,
    });
    const paypalWebhookPayment = await prisma.payment.findFirstOrThrow({
      where: { order: { orderNumber: QA_ORDER_NUMBERS[5] }, provider: "PAYPAL" },
    });
    assert.ok(paypalWebhookPayment.providerCheckoutId);
    const paypalWebhookEvent = {
      id: `${QA_EVENT_PREFIX}paypal_completed`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      create_time: new Date().toISOString(),
      resource: {
        id: "PAYPAL-CAPTURE-RUNTIME",
        status: "COMPLETED",
        amount: { currency_code: "EUR", value: "50.00" },
        supplementary_data: {
          related_ids: { order_id: paypalWebhookPayment.providerCheckoutId },
        },
      },
    } as const;
    const paypalWebhookResults = [
      await processVerifiedPaypalWebhookEvent(paypalWebhookEvent),
      await processVerifiedPaypalWebhookEvent(paypalWebhookEvent),
    ];
    assert.deepEqual(paypalWebhookResults.map(({ duplicate }) => duplicate).sort(), [false, true]);
    assert.ok(paypalWebhookResults.every(({ outcome }) => outcome === "PROCESSED"));
    const [paypalPaid, paypalOrder] = await Promise.all([
      prisma.payment.findUniqueOrThrow({ where: { id: paypalWebhookPayment.id } }),
      prisma.order.findUniqueOrThrow({ where: { orderNumber: QA_ORDER_NUMBERS[5] } }),
    ]);
    assert.equal(paypalPaid.status, "SUCCEEDED");
    assert.equal(paypalPaid.paymentMethod, "PAYPAL");
    assert.equal(paypalOrder.status, "PAYMENT_CONFIRMED");
    assert.equal(await prisma.providerEvent.count({
      where: { provider: "PAYPAL", providerEventId: paypalWebhookEvent.id },
    }), 1);
    await assertPaymentNotificationPair(paypalOrder.id);
    passed.push("PayPal webhook success and replay produce one Payment, one receipt, one Order transition and one notification pair");

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
