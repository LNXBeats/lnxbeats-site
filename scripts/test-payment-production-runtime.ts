import assert from "node:assert/strict";

import { createPaymentDatabasePaypalCaptureRepository } from "@/lib/payments/paypal-service";
import { processVerifiedPaypalWebhookEvent } from "@/lib/payments/paypal-webhook";
import {
  createRefundDatabaseRepository,
  LIVE_REFUND_CONFIRMATION,
  RefundServiceError,
} from "@/lib/payments/refund";
import {
  loadAndAssertPaymentQaDatabaseEnvironment,
  PAYMENT_QA_TARGET,
} from "@/lib/payments/qa-guard";
import {
  processVerifiedStripeWebhookEvent,
  type VerifiedStripeWebhookEvent,
} from "@/lib/payments/webhook";
import { prisma } from "@/lib/prisma";

const QA_EMAIL = "lnx-v080-payment-mode-runtime@example.invalid";
const QA_ORDERS = [
  "LNX-2099-080001",
  "LNX-2099-080002",
  "LNX-2099-080003",
  "LNX-2099-080004",
  "LNX-2099-080005",
] as const;
const EVENT_PREFIX = "evt_v080_mode_";

async function cleanup() {
  const orders = await prisma.order.findMany({
    where: { orderNumber: { in: [...QA_ORDERS] } },
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
  const notifications = orderIds.length === 0
    ? []
    : await prisma.orderNotification.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      });
  const notificationIds = notifications.map(({ id }) => id);

  await prisma.$transaction(async (transaction) => {
    if (notificationIds.length > 0) {
      await transaction.notificationEvent.deleteMany({
        where: { notificationId: { in: notificationIds } },
      });
    }
    await transaction.providerEvent.deleteMany({
      where: {
        OR: [
          { providerEventId: { startsWith: EVENT_PREFIX } },
          ...(paymentIds.length > 0 ? [{ paymentId: { in: paymentIds } }] : []),
        ],
      },
    });
    if (paymentIds.length > 0) {
      await transaction.paymentAuditEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await transaction.refundAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await transaction.paymentIncident.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await transaction.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    if (orderIds.length > 0) {
      await transaction.orderNotification.deleteMany({ where: { orderId: { in: orderIds } } });
      await transaction.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await transaction.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await transaction.user.deleteMany({ where: { email: QA_EMAIL } });
  });
}

async function assertClean(stage: string) {
  const [users, orders, events] = await Promise.all([
    prisma.user.count({ where: { email: QA_EMAIL } }),
    prisma.order.count({ where: { orderNumber: { in: [...QA_ORDERS] } } }),
    prisma.providerEvent.count({ where: { providerEventId: { startsWith: EVENT_PREFIX } } }),
  ]);
  assert.deepEqual({ users, orders, events }, { users: 0, orders: 0, events: 0 }, `${stage} cleanup failed`);
}

function stripeEvent(input: {
  eventId: string;
  paymentId: string;
  orderId: string;
  checkoutId: string;
  paymentIntentId: string;
  livemode: boolean;
}): VerifiedStripeWebhookEvent {
  return {
    id: input.eventId,
    type: "checkout.session.completed",
    livemode: input.livemode,
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
          pricingVersion: "2026-08-v1",
        },
        amount_total: 5_000,
        currency: "eur",
        payment_status: "paid",
        status: "complete",
        livemode: input.livemode,
        payment_intent: input.paymentIntentId,
      },
    },
    paymentIntentEvidence: {
      id: input.paymentIntentId,
      amountCents: 5_000,
      currency: "EUR",
      livemode: input.livemode,
      status: "succeeded",
      paymentId: input.paymentId,
      orderId: input.orderId,
      pricingVersion: "2026-08-v1",
      paymentMethod: "CARD",
    },
  };
}

function paypalEvent(input: {
  eventId: string;
  providerOrderId: string;
  captureId: string;
}) {
  return {
    id: input.eventId,
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    create_time: new Date().toISOString(),
    resource: {
      id: input.captureId,
      status: "COMPLETED",
      amount: { currency_code: "EUR", value: "50.00" },
      supplementary_data: { related_ids: { order_id: input.providerOrderId } },
    },
  } as const;
}

async function createFixtures() {
  const user = await prisma.user.create({
    data: {
      email: QA_EMAIL,
      displayName: "Payment Mode Runtime QA",
      emailVerified: true as const,
      emailVerifiedAt: new Date(),
      role: "ADMIN",
      status: "ACTIVE",
    },
  });
  const providers = ["STRIPE", "STRIPE", "PAYPAL", "PAYPAL"] as const;
  const modes = ["TEST", "LIVE", "TEST", "LIVE"] as const;
  return Promise.all(QA_ORDERS.slice(0, 4).map((orderNumber, index) => prisma.order.create({
    data: {
      orderNumber,
      userId: user.id,
      customerEmail: QA_EMAIL,
      customerName: "Payment Mode Runtime QA",
      status: "AWAITING_PAYMENT",
      title: `Payment environment isolation ${index + 1}`,
      brief: "Fixture PostgreSQL strictement jetable, sans appel fournisseur.",
      usage: "PERSONAL",
      basePriceCents: 5_000,
      totalCents: 5_000,
      currency: "EUR",
      pricingVersion: "2026-08-v1",
      submittedAt: new Date(),
      payments: {
        create: {
          provider: providers[index],
          mode: modes[index],
          status: "PENDING",
          amountCents: 5_000,
          currency: "EUR",
          pricingVersion: "2026-08-v1",
          idempotencyKey: `v080-mode:${orderNumber}`,
          providerCheckoutId: `${providers[index].toLowerCase()}-checkout-${modes[index].toLowerCase()}-${index}`,
          ...(providers[index] === "STRIPE"
            ? { providerPaymentId: `pi_${modes[index].toLowerCase()}_v080_${index}` }
            : {}),
        },
      },
    },
    include: { payments: true },
  })));
}

async function run() {
  const runtime = await loadAndAssertPaymentQaDatabaseEnvironment();
  assert.equal(runtime.target, PAYMENT_QA_TARGET);
  await cleanup();
  await assertClean("precondition");
  const passed: string[] = [];
  try {
    const fixtures = await createFixtures();
    const [stripeTest, stripeLive, paypalTest, paypalLive] = fixtures.map((order) => ({
      order,
      payment: order.payments[0]!,
    }));

    for (const fixture of [stripeTest, stripeLive]) {
      assert.equal(fixture.payment.provider, "STRIPE");
      assert.ok(fixture.payment.providerCheckoutId && fixture.payment.providerPaymentId);
      const correctLivemode = fixture.payment.mode === "LIVE";
      const wrong = await processVerifiedStripeWebhookEvent(stripeEvent({
        eventId: `${EVENT_PREFIX}stripe_wrong_${fixture.payment.mode.toLowerCase()}`,
        paymentId: fixture.payment.id,
        orderId: fixture.order.id,
        checkoutId: fixture.payment.providerCheckoutId,
        paymentIntentId: fixture.payment.providerPaymentId,
        livemode: !correctLivemode,
      }));
      assert.equal(wrong.outcome, "REQUIRES_REVIEW");
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: fixture.payment.id } })).status, "PENDING");
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status, "AWAITING_PAYMENT");
      const correctEvent = stripeEvent({
        eventId: `${EVENT_PREFIX}stripe_correct_${fixture.payment.mode.toLowerCase()}`,
        paymentId: fixture.payment.id,
        orderId: fixture.order.id,
        checkoutId: fixture.payment.providerCheckoutId,
        paymentIntentId: fixture.payment.providerPaymentId,
        livemode: correctLivemode,
      });
      assert.equal((await processVerifiedStripeWebhookEvent(correctEvent)).outcome, "PROCESSED");
      assert.equal((await processVerifiedStripeWebhookEvent(correctEvent)).duplicate, true);
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: fixture.payment.id } })).status, "SUCCEEDED");
    }
    passed.push("Stripe TEST/LIVE wrong-mode isolation and correct-mode replay");

    const paypalRepositories = {
      TEST: createPaymentDatabasePaypalCaptureRepository(prisma, "TEST"),
      LIVE: createPaymentDatabasePaypalCaptureRepository(prisma, "LIVE"),
    } as const;
    for (const fixture of [paypalTest, paypalLive]) {
      assert.equal(fixture.payment.provider, "PAYPAL");
      assert.ok(fixture.payment.providerCheckoutId);
      const correctMode = fixture.payment.mode;
      const wrongMode = correctMode === "LIVE" ? "TEST" : "LIVE";
      const wrong = await processVerifiedPaypalWebhookEvent(paypalEvent({
        eventId: `${EVENT_PREFIX}paypal_wrong_${correctMode.toLowerCase()}`,
        providerOrderId: fixture.payment.providerCheckoutId,
        captureId: `paypal-capture-wrong-${correctMode.toLowerCase()}`,
      }), paypalRepositories[wrongMode]);
      assert.equal(wrong.outcome, "REQUIRES_REVIEW");
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: fixture.payment.id } })).status, "PENDING");
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status, "AWAITING_PAYMENT");
      const correctEvent = paypalEvent({
        eventId: `${EVENT_PREFIX}paypal_correct_${correctMode.toLowerCase()}`,
        providerOrderId: fixture.payment.providerCheckoutId,
        captureId: `paypal-capture-correct-${correctMode.toLowerCase()}`,
      });
      assert.equal((await processVerifiedPaypalWebhookEvent(correctEvent, paypalRepositories[correctMode])).outcome, "PROCESSED");
      assert.equal((await processVerifiedPaypalWebhookEvent(correctEvent, paypalRepositories[correctMode])).duplicate, true);
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: fixture.payment.id } })).status, "SUCCEEDED");
    }
    passed.push("PayPal SANDBOX/LIVE wrong-environment isolation and correct-environment replay");

    const receipts = await prisma.providerEvent.findMany({
      where: { providerEventId: { startsWith: EVENT_PREFIX } },
      select: { providerEventId: true, livemode: true, outcome: true, paymentId: true },
    });
    assert.equal(receipts.length, 8);
    assert.equal(receipts.filter(({ paymentId }) => paymentId === null).length, 4);
    assert.equal(receipts.filter(({ outcome }) => outcome === "REQUIRES_REVIEW").length, 4);
    assert.equal(receipts.filter(({ outcome }) => outcome === "PROCESSED").length, 4);
    assert.equal(await prisma.payment.count({ where: { status: "SUCCEEDED" } }), 4);
    assert.equal(await prisma.order.count({ where: { status: "PAYMENT_CONFIRMED" } }), 4);
    const paymentNotifications = await prisma.orderNotification.groupBy({
      by: ["kind"],
      where: { orderId: { in: fixtures.map(({ id }) => id) } },
      _count: { _all: true },
    });
    assert.deepEqual(
      Object.fromEntries(paymentNotifications.map(({ kind, _count }) => [kind, _count._all])),
      { CUSTOMER_PAYMENT_CONFIRMED: 4, OWNER_NEW_ORDER: 4 },
    );
    passed.push("wrong-environment receipts are unlinked and cannot mutate Payment or Order");

    const adminUserId = stripeTest.order.userId;
    assert.ok(adminUserId);
    const liveRefundOrder = await prisma.order.create({
      data: {
        orderNumber: QA_ORDERS[4],
        userId: adminUserId,
        customerEmail: QA_EMAIL,
        customerName: "Payment Mode Runtime QA",
        status: "IN_PROGRESS",
        title: "Live refund confirmation isolation",
        brief: "Fixture PostgreSQL strictement jetable, sans appel fournisseur.",
        usage: "PERSONAL",
        basePriceCents: 5_000,
        totalCents: 5_000,
        currency: "EUR",
        pricingVersion: "2026-08-v1",
        submittedAt: new Date(),
        serviceStartedAt: new Date(),
        payments: {
          create: {
            provider: "STRIPE",
            mode: "LIVE",
            status: "SUCCEEDED",
            amountCents: 5_000,
            currency: "EUR",
            pricingVersion: "2026-08-v1",
            idempotencyKey: "v080-mode:live-refund",
            providerCheckoutId: "stripe-checkout-live-refund",
            providerPaymentId: "pi_live_v080_refund",
            paymentMethod: "CARD",
            paidAt: new Date(),
          },
        },
      },
    });
    const disabledLiveRepository = createRefundDatabaseRepository(prisma, "LIVE");
    const actor = {
      id: adminUserId,
      email: QA_EMAIL,
      name: "Payment Mode Runtime QA",
      role: "ADMIN" as const,
      status: "ACTIVE" as const,
      emailVerified: true as const,
    };
    const refundInput = {
      actor,
      orderNumber: QA_ORDERS[4],
      kind: "FULL" as const,
      localIdempotencyKey: "refund-request:80000000-0000-4000-8000-000000000001",
    };
    await assert.rejects(
      disabledLiveRepository.reserve({
        ...refundInput,
        liveConfirmation: LIVE_REFUND_CONFIRMATION,
      }),
      (error) => error instanceof RefundServiceError && error.code === "LIVE_REFUNDS_DISABLED",
    );
    const blockedPayment = await prisma.payment.findFirstOrThrow({ where: { orderId: liveRefundOrder.id } });
    assert.equal(await prisma.refundAttempt.count({ where: { payment: { orderId: liveRefundOrder.id } } }), 0);
    assert.equal(await prisma.paymentAuditEvent.count({ where: { paymentId: blockedPayment.id } }), 0);
    assert.equal(await prisma.orderEvent.count({ where: { orderId: liveRefundOrder.id } }), 0);
    assert.equal(blockedPayment.status, "SUCCEEDED");

    const liveRepository = createRefundDatabaseRepository(prisma, "LIVE", true);
    await assert.rejects(
      liveRepository.reserve(refundInput),
      (error) => error instanceof RefundServiceError && error.code === "INVALID_REFUND_REQUEST",
    );
    const reserved = await liveRepository.reserve({
      ...refundInput,
      liveConfirmation: LIVE_REFUND_CONFIRMATION,
    });
    await assert.rejects(
      liveRepository.reserve(refundInput),
      (error) => error instanceof RefundServiceError && error.code === "INVALID_REFUND_REQUEST",
    );
    const replay = await liveRepository.reserve({
      ...refundInput,
      liveConfirmation: LIVE_REFUND_CONFIRMATION,
    });
    assert.equal(replay.id, reserved.id);
    assert.equal(replay.reused, true);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: liveRefundOrder.id } })).status, "IN_PROGRESS");
    passed.push("LIVE refund gate blocks all persistence by default; explicit opt-in and confirmation preserve idempotent creation without changing Order");

    console.info(`V0.8 payment production runtime passed (${passed.length} groups):`);
    for (const label of passed) console.info(`- ${label}`);
  } finally {
    await cleanup();
    await assertClean("postcondition");
  }
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Payment mode runtime failed.");
    process.exitCode = 1;
  });
