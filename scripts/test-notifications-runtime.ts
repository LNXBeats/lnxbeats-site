import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";

import { sendAuthEmail } from "@/lib/email/auth-email";
import { registrationCodeEmailTemplate } from "@/lib/email/templates";
import { NOTIFICATION_PRODUCTION_CONFIRMATION } from "@/lib/notifications/config";
import { PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY } from "@/lib/notifications/domain";
import {
  assertProductionOwnerEmailSmokeEnvironment,
  databaseProductionOwnerEmailSmokeRepository,
  PRODUCTION_OWNER_EMAIL_SMOKE_CONFIRMATION,
  PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER,
} from "@/lib/notifications/production-owner-email-smoke";
import {
  databaseNotificationDispatchRepository,
  dispatchOrderNotification,
  enqueuePaymentConfirmedNotifications,
  enqueueCustomerDeliveryNotification,
  enqueueOrderNotification,
  globalNotificationDispatchWhere,
  retryNotificationManually,
  suppressNotificationRecipientManually,
} from "@/lib/notifications/service";
import { sendOrderNotificationEmail } from "@/lib/notifications/email";
import { loadAndAssertNotificationQaEnvironment } from "@/lib/notifications/qa-guard";
import { evaluateProductionNotificationDatabase } from "@/lib/notifications/production-preflight";
import { processVerifiedResendWebhookEvent } from "@/lib/notifications/resend-webhook";
import type { NotificationTransportResult } from "@/lib/notifications/types";
import { prisma } from "@/lib/prisma";

const EMAIL = "lnx-v073-notifications-member@example.invalid";
const ORDER_NUMBER = "LNX-2099-073001";
const PROVIDER_EVENT_PREFIX = "svix_v073_runtime_";
const CAPTURE_PATH = "/private/tmp/lnx-studio-v073-notifications-runtime.jsonl";
const PRODUCTION_SMOKE_RECIPIENT = "owner-smoke-runtime@lnxbeats.fr";
const PRODUCTION_SMOKE_PROVIDER_MESSAGE_ID = "email_v0812_production_owner_smoke";

async function scope() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  const order = await prisma.order.findUnique({ where: { orderNumber: ORDER_NUMBER }, select: { id: true } });
  const productionSmokeOrder = await prisma.order.findUnique({
    where: { orderNumber: PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER },
    select: { id: true },
  });
  const notificationIds = order ? (await prisma.orderNotification.findMany({ where: { orderId: order.id }, select: { id: true } })).map(({ id }) => id) : [];
  const productionSmokeNotificationIds = productionSmokeOrder
    ? (await prisma.orderNotification.findMany({ where: { orderId: productionSmokeOrder.id }, select: { id: true } })).map(({ id }) => id)
    : [];
  return {
    userId: user?.id,
    orderId: order?.id,
    notificationIds,
    productionSmokeOrderId: productionSmokeOrder?.id,
    productionSmokeNotificationIds,
  };
}

async function cleanup() {
  const current = await scope();
  await prisma.$transaction(async (transaction) => {
    await transaction.notificationEvent.deleteMany({
      where: {
        OR: [
          { providerEventId: { startsWith: PROVIDER_EVENT_PREFIX } },
          { providerEventId: { startsWith: "svix_v0812_production_owner_smoke_" } },
          { providerMessageId: { startsWith: "email_v078_auth_" } },
          ...([...current.notificationIds, ...current.productionSmokeNotificationIds].length
            ? [{ notificationId: { in: [...current.notificationIds, ...current.productionSmokeNotificationIds] } }]
            : []),
        ],
      },
    });
    await transaction.notificationSuppression.deleteMany({ where: { recipient: { in: [EMAIL, PRODUCTION_SMOKE_RECIPIENT] } } });
    if (current.productionSmokeOrderId) {
      await transaction.orderNotification.deleteMany({ where: { orderId: current.productionSmokeOrderId } });
      await transaction.orderEvent.deleteMany({ where: { orderId: current.productionSmokeOrderId } });
      await transaction.order.delete({ where: { id: current.productionSmokeOrderId } });
    }
    if (current.orderId) {
      await transaction.orderNotification.deleteMany({ where: { orderId: current.orderId } });
      await transaction.orderEvent.deleteMany({ where: { orderId: current.orderId } });
      await transaction.order.delete({ where: { id: current.orderId } });
    }
    if (current.userId) await transaction.user.delete({ where: { id: current.userId } });
  });
}

async function assertClean(stage: string) {
  const [users, orders, notifications, events, suppressions, productionSmokeOrders, productionSmokeNotifications] = await Promise.all([
    prisma.user.count({ where: { email: EMAIL } }),
    prisma.order.count({ where: { orderNumber: ORDER_NUMBER } }),
    prisma.orderNotification.count({ where: { order: { orderNumber: ORDER_NUMBER } } }),
    prisma.notificationEvent.count({ where: { providerEventId: { startsWith: PROVIDER_EVENT_PREFIX } } }),
    prisma.notificationSuppression.count({ where: { recipient: EMAIL } }),
    prisma.order.count({ where: { orderNumber: PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER } }),
    prisma.orderNotification.count({ where: { idempotencyKey: PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY } }),
  ]);
  assert.deepEqual(
    { users, orders, notifications, events, suppressions, productionSmokeOrders, productionSmokeNotifications },
    { users: 0, orders: 0, notifications: 0, events: 0, suppressions: 0, productionSmokeOrders: 0, productionSmokeNotifications: 0 },
    `${stage}: fixtures remain.`,
  );
}

async function cleanupProductionOwnerSmokeFixture() {
  const order = await prisma.order.findUnique({
    where: { orderNumber: PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER },
    select: { id: true },
  });
  if (!order) return;
  const notificationIds = (await prisma.orderNotification.findMany({
    where: { orderId: order.id },
    select: { id: true },
  })).map(({ id }) => id);
  await prisma.$transaction(async (transaction) => {
    if (notificationIds.length) {
      await transaction.notificationEvent.deleteMany({ where: { notificationId: { in: notificationIds } } });
    }
    await transaction.orderNotification.deleteMany({ where: { orderId: order.id } });
    await transaction.orderEvent.deleteMany({ where: { orderId: order.id } });
    await transaction.order.delete({ where: { id: order.id } });
  });
}

async function withProductionOwnerSmokeEnvironment<T>(callback: () => Promise<T>) {
  const names = [
    "NODE_ENV", "RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "NOTIFICATION_DEPLOYMENT_ENV",
    "NOTIFICATION_EMAIL_TRANSPORT", "NOTIFICATION_PRODUCTION_CONFIRM", "NOTIFICATION_PRODUCTION_OWNER_SMOKE_CONFIRM",
    "EMAIL_NOTIFICATIONS_ENABLED", "OWNER_EMAIL_NOTIFICATIONS_ENABLED", "CLIENT_EMAIL_NOTIFICATIONS_ENABLED",
    "NOTIFICATION_WORKER_ENABLED", "NOTIFICATION_WORKER_SECRET", "NOTIFICATION_SCHEDULER_MODE", "PAYMENTS_ENABLED",
    "SMS_TRANSPORT", "SMS_NOTIFICATIONS_ENABLED", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "EMAIL_FROM",
    "EMAIL_REPLY_TO", "EMAIL_OWNER_RECIPIENT", "APP_CANONICAL_URL", "NOTIFICATION_STAGING_CONFIRM",
    "NOTIFICATION_STAGING_QA_CONFIRM", "NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST", "NOTIFICATION_OWNER_SMOKE_TEST_CONFIRM",
    "RESEND_BASE_URL",
  ] as const;
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, {
      NODE_ENV: "production",
      RAILWAY_ENVIRONMENT_NAME: "production",
      NOTIFICATION_DEPLOYMENT_ENV: "production",
      NOTIFICATION_EMAIL_TRANSPORT: "resend",
      NOTIFICATION_PRODUCTION_CONFIRM: NOTIFICATION_PRODUCTION_CONFIRMATION,
      NOTIFICATION_PRODUCTION_OWNER_SMOKE_CONFIRM: PRODUCTION_OWNER_EMAIL_SMOKE_CONFIRMATION,
      EMAIL_NOTIFICATIONS_ENABLED: "true",
      OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
      CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
      NOTIFICATION_WORKER_ENABLED: "false",
      NOTIFICATION_WORKER_SECRET: "w".repeat(40),
      NOTIFICATION_SCHEDULER_MODE: "disabled",
      PAYMENTS_ENABLED: "false",
      SMS_TRANSPORT: "disabled",
      SMS_NOTIFICATIONS_ENABLED: "false",
      RESEND_API_KEY: `re_${"runtime".repeat(6)}`,
      RESEND_WEBHOOK_SECRET: `whsec_${"runtime".repeat(6)}`,
      EMAIL_FROM: "LNX Beats <notifications@mail.lnxbeats.fr>",
      EMAIL_REPLY_TO: "reply@lnxbeats.fr",
      EMAIL_OWNER_RECIPIENT: PRODUCTION_SMOKE_RECIPIENT,
      APP_CANONICAL_URL: "https://www.lnxbeats.fr",
    });
    for (const name of [
      "RAILWAY_ENVIRONMENT", "NOTIFICATION_STAGING_CONFIRM", "NOTIFICATION_STAGING_QA_CONFIRM",
      "NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST", "NOTIFICATION_OWNER_SMOKE_TEST_CONFIRM", "RESEND_BASE_URL",
    ]) delete process.env[name];
    return await callback();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else (process.env as Record<string, string | undefined>)[name] = value;
    }
  }
}

async function assertProductionOwnerSmokeRuntime() {
  await cleanupProductionOwnerSmokeFixture();
  await withProductionOwnerSmokeEnvironment(async () => {
    const configuration = assertProductionOwnerEmailSmokeEnvironment();
    assert.equal(configuration.ownerRecipient, PRODUCTION_SMOKE_RECIPIENT);
    assert.equal(configuration.workerEnabled, false);
    assert.equal(configuration.clientEmailEnabled, false);

    const first = await databaseProductionOwnerEmailSmokeRepository.create(PRODUCTION_SMOKE_RECIPIENT);
    const second = await databaseProductionOwnerEmailSmokeRepository.create(PRODUCTION_SMOKE_RECIPIENT);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.notificationId, first.notificationId);
    const fixture = await prisma.orderNotification.findUniqueOrThrow({
      where: { id: first.notificationId },
      include: { order: { include: { _count: { select: { payments: true, notifications: true } } } } },
    });
    assert.equal(fixture.idempotencyKey, PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY);
    assert.equal(fixture.deploymentEnvironment, "production");
    assert.equal(fixture.order.status, "CANCELLED");
    assert.equal(fixture.order.totalCents, 0);
    assert.equal(fixture.order.userId, null);
    assert.equal(fixture.order.customerId, null);
    assert.deepEqual(fixture.order._count, { payments: 0, notifications: 1 });
    assert.equal(await prisma.notificationEvent.count({
      where: { notificationId: first.notificationId, code: "PRODUCTION_OWNER_SMOKE_CREATED" },
    }), 1);

    let successProviderCalls = 0;
    const successDispatch = (id: string) => dispatchOrderNotification(id, {
      repository: databaseNotificationDispatchRepository,
      sendEmail: async () => {
        successProviderCalls += 1;
        return { provider: "RESEND", providerMessageId: PRODUCTION_SMOKE_PROVIDER_MESSAGE_ID, deliveredImmediately: false };
      },
    });
    assert.deepEqual(await successDispatch(first.notificationId), { delivered: true, skipped: false });
    assert.deepEqual(await successDispatch(first.notificationId), { delivered: false, skipped: true });
    assert.equal(successProviderCalls, 1);
    const sent = await databaseProductionOwnerEmailSmokeRepository.read(PRODUCTION_SMOKE_RECIPIENT);
    assert.equal(sent?.status, "SENT");
    assert.equal(sent?.attempts, 1);
    assert.equal(sent?.providerMessageIdPresent, true);

    assert.deepEqual(await processVerifiedResendWebhookEvent({
      providerEventId: "svix_v0812_production_owner_smoke_delivered",
      type: "email.delivered",
      occurredAt: new Date(),
      providerMessageId: PRODUCTION_SMOKE_PROVIDER_MESSAGE_ID,
      recipient: PRODUCTION_SMOKE_RECIPIENT,
      suppressionOrigin: null,
      bounceType: null,
      bounceSubType: null,
      deploymentEnvironment: "production",
    }), { outcome: "PROCESSED", duplicate: false });
    const delivered = await databaseProductionOwnerEmailSmokeRepository.read(PRODUCTION_SMOKE_RECIPIENT);
    assert.equal(delivered?.status, "DELIVERED");
    assert.ok(delivered?.eventTypes.includes("email.delivered"));

    await cleanupProductionOwnerSmokeFixture();
    const failureFixture = await databaseProductionOwnerEmailSmokeRepository.create(PRODUCTION_SMOKE_RECIPIENT);
    let failureProviderCalls = 0;
    const failureDispatch = (id: string) => dispatchOrderNotification(id, {
      repository: databaseNotificationDispatchRepository,
      sendEmail: async () => {
        failureProviderCalls += 1;
        throw Object.assign(new Error("simulated provider timeout"), { statusCode: 503 });
      },
    });
    assert.deepEqual(await failureDispatch(failureFixture.notificationId), { delivered: false, skipped: false });
    await databaseProductionOwnerEmailSmokeRepository.finalizeFailedAttempt(
      failureFixture.notificationId,
      PRODUCTION_SMOKE_RECIPIENT,
    );
    const failed = await databaseProductionOwnerEmailSmokeRepository.read(PRODUCTION_SMOKE_RECIPIENT);
    assert.equal(failed?.status, "FAILED_FINAL");
    assert.equal(failed?.attempts, 1);
    assert.equal(failed?.lastErrorCode, "PRODUCTION_OWNER_SMOKE_ONE_SHOT_FAILED");
    assert.deepEqual(await failureDispatch(failureFixture.notificationId), { delivered: false, skipped: true });
    assert.equal(failureProviderCalls, 1);
    assert.equal(await prisma.orderNotification.count({
      where: {
        AND: [
          { id: failureFixture.notificationId },
          globalNotificationDispatchWhere(new Date(Date.now() + 60_000), "production"),
        ],
      },
    }), 0);

    await prisma.orderNotification.update({
      where: { id: failureFixture.notificationId },
      data: { status: "FAILED_RETRYABLE", failedAt: new Date(), availableAt: new Date() },
    });
    assert.equal(await prisma.orderNotification.count({
      where: {
        AND: [
          { id: failureFixture.notificationId },
          globalNotificationDispatchWhere(new Date(Date.now() + 60_000), "production"),
        ],
      },
    }), 0, "The global dispatcher must exclude the retryable Production smoke fixture.");
    await assert.rejects(
      retryNotificationManually(failureFixture.notificationId, "00000000-0000-4000-8000-000000000812"),
      /one-shot/,
    );
    await databaseProductionOwnerEmailSmokeRepository.finalizeFailedAttempt(
      failureFixture.notificationId,
      PRODUCTION_SMOKE_RECIPIENT,
    );
  });
  await cleanupProductionOwnerSmokeFixture();
  assert.equal(await prisma.orderNotification.count({ where: { idempotencyKey: PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY } }), 0);
  console.info("Production owner email smoke PostgreSQL QA passed: fixture, idempotence, targeted dispatch, webhook, final failure and no retry.");
}

async function main() {
  await loadAndAssertNotificationQaEnvironment();
  process.env.NOTIFICATION_CAPTURE_PATH = CAPTURE_PATH;
  await rm(CAPTURE_PATH, { force: true });
  await cleanup();
  await assertClean("precondition");
  const schemaPreflight = await evaluateProductionNotificationDatabase(prisma, "owner@lnxbeats.fr");
  for (const name of ["database.notificationTables", "database.notificationIndexes", "database.migrations"]) {
    assert.equal(schemaPreflight.find((rule) => rule.name === name)?.passed, true, `${name} did not pass on the disposable PostgreSQL database.`);
  }
  await assertClean("preflight-read-only");
  try {
    const user = await prisma.user.create({ data: { email: EMAIL, emailVerified: true, emailVerifiedAt: new Date(), displayName: "Member Notifications QA", status: "ACTIVE", role: "MEMBER" } });
    const order = await prisma.order.create({ data: { orderNumber: ORDER_NUMBER, userId: user.id, customerEmail: EMAIL, customerName: "Member Notifications QA", status: "PAYMENT_CONFIRMED", title: "Notification QA", brief: "Fixture locale et jetable.", coverIncluded: true, priorityProcessing: true, coverPriceCents: 1_000, priorityPriceCents: 3_000, totalCents: 9_000 } });

    await assertProductionOwnerSmokeRuntime();

    const unknownProviderEventId = `${PROVIDER_EVENT_PREFIX}unknown-event`;
    assert.deepEqual(await processVerifiedResendWebhookEvent({
      providerEventId: unknownProviderEventId,
      type: "domain.updated",
      occurredAt: new Date(),
      providerMessageId: null,
      recipient: null,
      suppressionOrigin: null,
      bounceType: null,
      bounceSubType: null,
      deploymentEnvironment: "development",
    }), { outcome: "IGNORED", duplicate: false });
    assert.equal(
      (await prisma.notificationEvent.findUniqueOrThrow({ where: { providerEventId: unknownProviderEventId } })).code,
      "EVENT_NOT_ALLOWLISTED",
    );

    await Promise.all([
      prisma.$transaction(async (transaction) => { await enqueuePaymentConfirmedNotifications(transaction, order.id); }),
      prisma.$transaction(async (transaction) => { await enqueuePaymentConfirmedNotifications(transaction, order.id); }),
    ]);
    assert.equal(await prisma.orderNotification.count({ where: { orderId: order.id } }), 2, "The same payment event must create exactly two logical notifications.");

    const ownerNotification = await prisma.orderNotification.findUniqueOrThrow({ where: { idempotencyKey: `order:${order.id}:owner-new:email` } });
    assert.equal(ownerNotification.recipient, null, "The runtime must not inject a real owner destination.");
    let missingRecipientTransportCalls = 0;
    const missingRecipientDispatches = await Promise.all([
      dispatchOrderNotification(ownerNotification.id, {
        repository: databaseNotificationDispatchRepository,
        sendEmail: async () => { missingRecipientTransportCalls += 1; throw new Error("Transport must not run without a recipient."); },
      }),
      dispatchOrderNotification(ownerNotification.id, {
        repository: databaseNotificationDispatchRepository,
        sendEmail: async () => { missingRecipientTransportCalls += 1; throw new Error("Transport must not run without a recipient."); },
      }),
    ]);
    assert.equal(missingRecipientTransportCalls, 0, "A missing owner destination reached the transport.");
    assert.equal(missingRecipientDispatches.filter(({ skipped }) => skipped).length, 1, "Exactly one worker must lose the owner claim.");
    const failedOwner = await prisma.orderNotification.findUniqueOrThrow({ where: { id: ownerNotification.id } });
    assert.equal(failedOwner.status, "FAILED_FINAL");
    assert.equal(failedOwner.attempts, 1);
    assert.equal(failedOwner.lastErrorCode, "RECIPIENT_MISSING");
    const missingRecipientEvents = await prisma.notificationEvent.groupBy({
      by: ["code"],
      where: { notificationId: ownerNotification.id, code: { in: ["DISPATCH_CLAIMED", "RECIPIENT_MISSING"] } },
      _count: { _all: true },
    });
    assert.deepEqual(Object.fromEntries(missingRecipientEvents.map(({ code, _count }) => [code, _count._all])), {
      DISPATCH_CLAIMED: 1,
      RECIPIENT_MISSING: 1,
    });

    const clientPayment = await prisma.orderNotification.findUniqueOrThrow({ where: { idempotencyKey: `order:${order.id}:payment-confirmed:email` } });
    let captureTransportCalls = 0;
    const sendCapture = async (message: Parameters<typeof sendOrderNotificationEmail>[0]): Promise<NotificationTransportResult> => {
      captureTransportCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return sendOrderNotificationEmail(message);
    };
    const concurrent = await Promise.all([
      dispatchOrderNotification(clientPayment.id, { repository: databaseNotificationDispatchRepository, sendEmail: sendCapture }),
      dispatchOrderNotification(clientPayment.id, { repository: databaseNotificationDispatchRepository, sendEmail: sendCapture }),
    ]);
    assert.equal(captureTransportCalls, 1, "Two workers reached the capture transport for the same notification.");
    assert.equal(concurrent.filter(({ delivered }) => delivered).length, 1);
    assert.equal(concurrent.filter(({ skipped }) => skipped).length, 1);
    const capturedPayment = await prisma.orderNotification.findUniqueOrThrow({ where: { id: clientPayment.id } });
    assert.equal(capturedPayment.status, "DELIVERED");
    assert.equal(capturedPayment.attempts, 1);
    assert.equal(capturedPayment.provider, "CAPTURE");
    assert.match(capturedPayment.providerMessageId ?? "", /^capture_[a-f0-9]{32}$/);
    assert.ok(capturedPayment.sentAt);
    assert.ok(capturedPayment.deliveredAt);
    assert.equal(capturedPayment.processingStartedAt, null);
    assert.equal(capturedPayment.leaseExpiresAt, null);
    const claimEvents = await prisma.notificationEvent.groupBy({
      by: ["code"],
      where: { notificationId: clientPayment.id, code: { in: ["DISPATCH_CLAIMED", "CAPTURE_DELIVERED"] } },
      _count: { _all: true },
    });
    assert.deepEqual(Object.fromEntries(claimEvents.map(({ code, _count }) => [code, _count._all])), {
      CAPTURE_DELIVERED: 1,
      DISPATCH_CLAIMED: 1,
    });
    const capturedLines = (await readFile(CAPTURE_PATH, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(capturedLines.length, 1, "Concurrent workers wrote more than one capture envelope.");
    assert.equal(capturedLines[0]?.recipient, EMAIL);
    assert.equal(capturedLines[0]?.idempotencyKey, clientPayment.idempotencyKey);

    await prisma.$transaction(async (transaction) => { await enqueueCustomerDeliveryNotification(transaction, { id: order.id, customerEmail: EMAIL }); });
    const delivery = await prisma.orderNotification.findUniqueOrThrow({ where: { idempotencyKey: `order:${order.id}:delivery-ready:email` } });
    await dispatchOrderNotification(delivery.id, {
      repository: databaseNotificationDispatchRepository,
      sendEmail: async () => { throw Object.assign(new Error("temporary"), { statusCode: 503 }); },
    });
    const failed = await prisma.orderNotification.findUniqueOrThrow({ where: { id: delivery.id } });
    assert.equal(failed.status, "FAILED_RETRYABLE");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PAYMENT_CONFIRMED");
    await retryNotificationManually(delivery.id, user.id);
    await dispatchOrderNotification(delivery.id, { repository: databaseNotificationDispatchRepository, sendEmail: async () => ({ provider: "CAPTURE", providerMessageId: "capture_v073_delivery", deliveredImmediately: true }) });
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: delivery.id } })).status, "DELIVERED");

    await prisma.$transaction(async (transaction) => {
      await enqueueOrderNotification(transaction, {
        orderId: order.id,
        kind: "CUSTOMER_CREATION_STARTED",
        recipient: EMAIL,
        idempotencyKey: `order:${order.id}:early-delivery:email`,
      });
    });
    const earlyDelivery = await prisma.orderNotification.findUniqueOrThrow({
      where: { idempotencyKey: `order:${order.id}:early-delivery:email` },
    });
    assert.ok(await databaseNotificationDispatchRepository.claim(earlyDelivery.id));
    const earlyProviderMessageId = "email_v078_early_delivery";
    const earlyProviderEventId = `${PROVIDER_EVENT_PREFIX}early-delivery`;
    assert.deepEqual(await processVerifiedResendWebhookEvent({
      providerEventId: earlyProviderEventId,
      type: "email.delivered",
      occurredAt: new Date(),
      providerMessageId: earlyProviderMessageId,
      recipient: EMAIL,
      suppressionOrigin: null,
      bounceType: null,
      bounceSubType: null,
      deploymentEnvironment: "development",
    }), { outcome: "REQUIRES_REVIEW", duplicate: false });
    await databaseNotificationDispatchRepository.markSent(earlyDelivery.id, {
      provider: "RESEND",
      providerMessageId: earlyProviderMessageId,
      deliveredImmediately: false,
    });
    const reconciledDelivery = await prisma.orderNotification.findUniqueOrThrow({ where: { id: earlyDelivery.id } });
    assert.equal(reconciledDelivery.status, "DELIVERED", "An early delivered webhook was not reconciled after provider acceptance.");
    assert.equal((await prisma.notificationEvent.findUniqueOrThrow({ where: { providerEventId: earlyProviderEventId } })).code, "EMAIL_DELIVERED_RECONCILED");

    await prisma.$transaction(async (transaction) => {
      await enqueueOrderNotification(transaction, {
        orderId: order.id,
        kind: "CUSTOMER_ORDER_ACCEPTED",
        recipient: EMAIL,
        idempotencyKey: `order:${order.id}:early-failure:email`,
      });
    });
    const earlyFailure = await prisma.orderNotification.findUniqueOrThrow({
      where: { idempotencyKey: `order:${order.id}:early-failure:email` },
    });
    assert.ok(await databaseNotificationDispatchRepository.claim(earlyFailure.id));
    const earlyFailureMessageId = "email_v078_early_failure";
    const earlyFailureEventId = `${PROVIDER_EVENT_PREFIX}early-failure`;
    assert.deepEqual(await processVerifiedResendWebhookEvent({
      providerEventId: earlyFailureEventId,
      type: "email.failed",
      occurredAt: new Date(),
      providerMessageId: earlyFailureMessageId,
      recipient: EMAIL,
      suppressionOrigin: null,
      bounceType: null,
      bounceSubType: null,
      deploymentEnvironment: "development",
    }), { outcome: "REQUIRES_REVIEW", duplicate: false });
    await databaseNotificationDispatchRepository.markSent(earlyFailure.id, {
      provider: "RESEND",
      providerMessageId: earlyFailureMessageId,
      deliveredImmediately: false,
    });
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: earlyFailure.id } })).status, "FAILED_FINAL");
    assert.equal(
      (await prisma.notificationEvent.findUniqueOrThrow({ where: { providerEventId: earlyFailureEventId } })).code,
      "EMAIL_FAILED_RECONCILED",
    );
    const failureEventCount = await prisma.notificationEvent.count({ where: { notificationId: earlyFailure.id } });
    await databaseNotificationDispatchRepository.markFailed(earlyFailure.id, {
      code: "PROVIDER_TEMPORARY",
      message: "A late transport failure must not regress a provider terminal state.",
      retryable: true,
    });
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: earlyFailure.id } })).status, "FAILED_FINAL");
    assert.equal(await prisma.notificationEvent.count({ where: { notificationId: earlyFailure.id } }), failureEventCount);

    await prisma.$transaction(async (transaction) => {
      await enqueueOrderNotification(transaction, {
        orderId: order.id,
        kind: "CUSTOMER_CREATION_STARTED",
        recipient: EMAIL,
        idempotencyKey: `order:${order.id}:provisional-provider:email`,
      });
    });
    const provisionalProvider = await prisma.orderNotification.findUniqueOrThrow({
      where: { idempotencyKey: `order:${order.id}:provisional-provider:email` },
    });
    assert.ok(await databaseNotificationDispatchRepository.claim(provisionalProvider.id));
    await prisma.orderNotification.update({
      where: { id: provisionalProvider.id },
      data: { providerMessageId: "email_v078_provisional_provider" },
    });
    assert.deepEqual(await processVerifiedResendWebhookEvent({
      providerEventId: `${PROVIDER_EVENT_PREFIX}provisional-provider`,
      type: "email.delivered",
      occurredAt: new Date(),
      providerMessageId: "email_v078_provisional_provider",
      recipient: EMAIL,
      suppressionOrigin: null,
      bounceType: null,
      bounceSubType: null,
      deploymentEnvironment: "development",
    }), { outcome: "PROCESSED", duplicate: false });
    const reconciledProvisionalProvider = await prisma.orderNotification.findUniqueOrThrow({ where: { id: provisionalProvider.id } });
    assert.equal(reconciledProvisionalProvider.status, "DELIVERED");
    assert.equal(reconciledProvisionalProvider.provider, "RESEND");

    await prisma.$transaction(async (transaction) => {
      await enqueueOrderNotification(transaction, {
        orderId: order.id,
        kind: "CUSTOMER_ORDER_ACCEPTED",
        recipient: EMAIL,
        idempotencyKey: `order:${order.id}:expired-lease:email`,
      });
    });
    const expiredLease = await prisma.orderNotification.findUniqueOrThrow({
      where: { idempotencyKey: `order:${order.id}:expired-lease:email` },
    });
    const expiredAt = new Date(Date.now() - 60_000);
    await prisma.orderNotification.update({
      where: { id: expiredLease.id },
      data: { status: "PROCESSING", attempts: 1, processingStartedAt: expiredAt, leaseExpiresAt: expiredAt },
    });
    let recoveredLeaseCalls = 0;
    await dispatchOrderNotification(expiredLease.id, {
      repository: databaseNotificationDispatchRepository,
      sendEmail: async () => {
        recoveredLeaseCalls += 1;
        return { provider: "CAPTURE", providerMessageId: "capture_v078_recovered", deliveredImmediately: true };
      },
    });
    assert.equal(recoveredLeaseCalls, 1);
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: expiredLease.id } })).attempts, 2);
    assert.equal(await prisma.notificationEvent.count({ where: { notificationId: expiredLease.id, code: "EXPIRED_LEASE_RECLAIMED" } }), 1);

    await prisma.$transaction(async (transaction) => {
      await enqueueOrderNotification(transaction, {
        orderId: order.id,
        kind: "CUSTOMER_RIGHTS_REJECTED",
        recipient: EMAIL,
        idempotencyKey: `order:${order.id}:attempts-exhausted:email`,
      });
    });
    const exhausted = await prisma.orderNotification.findUniqueOrThrow({
      where: { idempotencyKey: `order:${order.id}:attempts-exhausted:email` },
    });
    await prisma.orderNotification.update({
      where: { id: exhausted.id },
      data: { status: "FAILED_RETRYABLE", attempts: 5, availableAt: new Date(Date.now() - 1_000), failedAt: new Date() },
    });
    let exhaustedTransportCalls = 0;
    assert.deepEqual(await dispatchOrderNotification(exhausted.id, {
      repository: databaseNotificationDispatchRepository,
      sendEmail: async () => {
        exhaustedTransportCalls += 1;
        throw new Error("Transport must not run after attempts are exhausted.");
      },
    }), { delivered: false, skipped: true });
    assert.equal(exhaustedTransportCalls, 0);
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: exhausted.id } })).status, "FAILED_FINAL");

    const sentAt = new Date();
    await prisma.orderNotification.update({
      where: { id: clientPayment.id },
      data: { status: "SENT", provider: "RESEND", providerMessageId: "email_v073_runtime", sentAt, deliveredAt: null },
    });
    const deliveredEvent = {
      providerEventId: `${PROVIDER_EVENT_PREFIX}delivered`, type: "email.delivered", occurredAt: new Date(),
      providerMessageId: "email_v073_runtime", recipient: EMAIL, suppressionOrigin: null,
      bounceType: null, bounceSubType: null, deploymentEnvironment: "development",
    } as const;
    assert.deepEqual(await processVerifiedResendWebhookEvent(deliveredEvent), { outcome: "PROCESSED", duplicate: false });
    assert.deepEqual(await processVerifiedResendWebhookEvent(deliveredEvent), { outcome: "PROCESSED", duplicate: true });
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: clientPayment.id } })).status, "DELIVERED");

    const complainedEvent = { ...deliveredEvent, providerEventId: `${PROVIDER_EVENT_PREFIX}complained`, type: "email.complained", occurredAt: new Date(Date.now() + 1_000) } as const;
    await processVerifiedResendWebhookEvent(complainedEvent);
    const complained = await prisma.orderNotification.findUniqueOrThrow({ where: { id: clientPayment.id } });
    assert.equal(complained.status, "COMPLAINED");
    assert.equal((await prisma.notificationSuppression.findUniqueOrThrow({ where: { channel_recipient: { channel: "EMAIL", recipient: EMAIL } } })).active, true);

    const suppressionRemoved = {
      providerEventId: `${PROVIDER_EVENT_PREFIX}suppression-removed`, type: "suppression.removed", occurredAt: new Date(Date.now() + 2_000),
      providerMessageId: null, recipient: EMAIL, suppressionOrigin: "complaint",
      bounceType: null, bounceSubType: null, deploymentEnvironment: "development",
    } as const;
    await processVerifiedResendWebhookEvent(suppressionRemoved);
    assert.equal((await prisma.notificationSuppression.findUniqueOrThrow({ where: { channel_recipient: { channel: "EMAIL", recipient: EMAIL } } })).active, false);

    await prisma.$transaction(async (transaction) => {
      await enqueueOrderNotification(transaction, { orderId: order.id, kind: "CUSTOMER_ORDER_ACCEPTED", recipient: EMAIL, idempotencyKey: `order:${order.id}:accepted:email` });
    });
    const accepted = await prisma.orderNotification.findUniqueOrThrow({ where: { idempotencyKey: `order:${order.id}:accepted:email` } });
    await prisma.orderNotification.update({ where: { id: accepted.id }, data: { status: "SENT", provider: "RESEND", providerMessageId: "email_v073_bounce", sentAt: new Date() } });
    const bouncedEvent = {
      providerEventId: `${PROVIDER_EVENT_PREFIX}bounced`, type: "email.bounced", occurredAt: new Date(Date.now() + 3_000),
      providerMessageId: "email_v073_bounce", recipient: EMAIL, suppressionOrigin: null,
      bounceType: "Permanent", bounceSubType: "General", deploymentEnvironment: "development",
    } as const;
    await processVerifiedResendWebhookEvent(bouncedEvent);
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: accepted.id } })).status, "BOUNCED");
    assert.equal((await prisma.notificationSuppression.findUniqueOrThrow({ where: { channel_recipient: { channel: "EMAIL", recipient: EMAIL } } })).reason, "HARD_BOUNCE");

    const suppressionRemovedAfterBounce = {
      ...suppressionRemoved,
      providerEventId: `${PROVIDER_EVENT_PREFIX}suppression-removed-after-bounce`,
      occurredAt: new Date(bouncedEvent.occurredAt.getTime() + 2_000),
      suppressionOrigin: "bounce",
    } as const;
    await processVerifiedResendWebhookEvent(suppressionRemovedAfterBounce);
    const staleSuppressionAdded = {
      ...suppressionRemoved,
      providerEventId: `${PROVIDER_EVENT_PREFIX}stale-suppression-added`,
      type: "suppression.added",
      occurredAt: new Date(bouncedEvent.occurredAt.getTime() + 1_000),
      suppressionOrigin: "bounce",
    } as const;
    assert.deepEqual(await processVerifiedResendWebhookEvent(staleSuppressionAdded), { outcome: "IGNORED", duplicate: false });
    assert.equal(
      (await prisma.notificationSuppression.findUniqueOrThrow({ where: { channel_recipient: { channel: "EMAIL", recipient: EMAIL } } })).active,
      false,
      "An older suppression.added webhook reactivated a newer removal.",
    );

    await prisma.$transaction(async (transaction) => {
      await enqueueOrderNotification(transaction, {
        orderId: order.id,
        kind: "CUSTOMER_CREATION_STARTED",
        recipient: EMAIL,
        idempotencyKey: `order:${order.id}:transient-bounce:email`,
      });
    });
    const transient = await prisma.orderNotification.findUniqueOrThrow({
      where: { idempotencyKey: `order:${order.id}:transient-bounce:email` },
    });
    await prisma.orderNotification.update({
      where: { id: transient.id },
      data: { status: "SENT", provider: "RESEND", providerMessageId: "email_v073_transient", sentAt: new Date() },
    });
    await processVerifiedResendWebhookEvent({
      ...bouncedEvent,
      providerEventId: `${PROVIDER_EVENT_PREFIX}transient-bounce`,
      providerMessageId: "email_v073_transient",
      occurredAt: new Date(bouncedEvent.occurredAt.getTime() + 3_000),
      bounceType: "Transient",
    });
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: transient.id } })).lastErrorCode, "BOUNCE_TRANSIENT");
    assert.equal(
      (await prisma.notificationSuppression.findUniqueOrThrow({ where: { channel_recipient: { channel: "EMAIL", recipient: EMAIL } } })).active,
      false,
      "A transient bounce must not create a permanent local suppression.",
    );

    await prisma.$transaction(async (transaction) => {
      await enqueueOrderNotification(transaction, {
        orderId: order.id,
        kind: "CUSTOMER_RIGHTS_INFORMATION_REQUIRED",
        recipient: EMAIL,
        idempotencyKey: `order:${order.id}:manual-suppression:email`,
      });
    });
    const manualSuppression = await prisma.orderNotification.findUniqueOrThrow({
      where: { idempotencyKey: `order:${order.id}:manual-suppression:email` },
    });
    await suppressNotificationRecipientManually(manualSuppression.id, user.id);
    const manualSuppressionRecord = await prisma.notificationSuppression.findUniqueOrThrow({
      where: { channel_recipient: { channel: "EMAIL", recipient: EMAIL } },
    });
    assert.equal(manualSuppressionRecord.active, true);
    assert.equal(manualSuppressionRecord.reason, "MANUAL");
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: manualSuppression.id } })).status, "SUPPRESSED");
    assert.equal(await prisma.notificationEvent.count({
      where: { notificationId: manualSuppression.id, actorUserId: user.id, code: "ADMIN_MANUAL_SUPPRESSION" },
    }), 1);
    assert.deepEqual(await processVerifiedResendWebhookEvent({
      ...suppressionRemoved,
      providerEventId: `${PROVIDER_EVENT_PREFIX}manual-suppression-removal-refused`,
      occurredAt: new Date(Date.now() + 1_000),
      suppressionOrigin: "manual",
    }), { outcome: "IGNORED", duplicate: false });
    const preservedManualSuppression = await prisma.notificationSuppression.findUniqueOrThrow({
      where: { channel_recipient: { channel: "EMAIL", recipient: EMAIL } },
    });
    assert.equal(preservedManualSuppression.active, true);
    assert.equal(preservedManualSuppression.reason, "MANUAL");

    const authProviderMessageId = "email_v073_auth";
    await prisma.notificationEvent.create({
      data: {
        providerEventId: `${PROVIDER_EVENT_PREFIX}auth-request`,
        providerEventType: "auth.email.accepted",
        providerMessageId: authProviderMessageId,
        outcome: "PROCESSED",
        code: "AUTH_VERIFICATION_ACCEPTED",
        occurredAt: new Date(),
      },
    });
    assert.deepEqual(await processVerifiedResendWebhookEvent({
      ...bouncedEvent,
      providerEventId: `${PROVIDER_EVENT_PREFIX}auth-complained`,
      providerMessageId: authProviderMessageId,
      occurredAt: new Date(bouncedEvent.occurredAt.getTime() + 4_000),
      type: "email.complained",
      bounceType: null,
    }), { outcome: "PROCESSED", duplicate: false });
    assert.equal(
      (await prisma.notificationEvent.findUniqueOrThrow({ where: { providerEventId: `${PROVIDER_EVENT_PREFIX}auth-complained` } })).code,
      "AUTH_EMAIL_COMPLAINED",
    );

    const authEnvironmentNames = [
      "NODE_ENV", "LNX_DATABASE_TARGET", "NOTIFICATION_DEPLOYMENT_ENV", "NOTIFICATION_EMAIL_TRANSPORT",
      "EMAIL_NOTIFICATIONS_ENABLED", "OWNER_EMAIL_NOTIFICATIONS_ENABLED", "CLIENT_EMAIL_NOTIFICATIONS_ENABLED",
      "NOTIFICATION_WORKER_ENABLED", "NOTIFICATION_WORKER_SECRET", "NOTIFICATION_PRODUCTION_CONFIRM",
      "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "EMAIL_FROM", "EMAIL_REPLY_TO", "EMAIL_OWNER_RECIPIENT",
      "APP_CANONICAL_URL", "AUTH_URL", "EMAIL_PROVIDER", "SMS_TRANSPORT", "SMS_NOTIFICATIONS_ENABLED",
      "NOTIFICATION_STAGING_CONFIRM", "NOTIFICATION_STAGING_QA_CONFIRM", "NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST",
      "NOTIFICATION_OWNER_SMOKE_TEST_CONFIRM", "RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME",
      "RESEND_BASE_URL",
    ] as const;
    const savedAuthEnvironment = new Map(authEnvironmentNames.map((name) => [name, process.env[name]]));
    try {
      Object.assign(process.env, {
        NODE_ENV: "production",
        LNX_DATABASE_TARGET: "lnx-v078-runtime-ephemeral",
        NOTIFICATION_DEPLOYMENT_ENV: "production",
        NOTIFICATION_EMAIL_TRANSPORT: "resend",
        EMAIL_NOTIFICATIONS_ENABLED: "true",
        OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
        CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
        NOTIFICATION_WORKER_ENABLED: "true",
        NOTIFICATION_WORKER_SECRET: "w".repeat(32),
        NOTIFICATION_PRODUCTION_CONFIRM: NOTIFICATION_PRODUCTION_CONFIRMATION,
        RESEND_API_KEY: `re_${"a".repeat(32)}`,
        RESEND_WEBHOOK_SECRET: `whsec_${"b".repeat(32)}`,
        EMAIL_FROM: "LNX Beats <notifications@mail.lnxbeats.fr>",
        EMAIL_REPLY_TO: "support@lnxbeats.fr",
        EMAIL_OWNER_RECIPIENT: "owner@lnxbeats.fr",
        APP_CANONICAL_URL: "https://lnxbeats.fr",
        AUTH_URL: "https://lnxbeats.fr",
        EMAIL_PROVIDER: "resend",
        SMS_TRANSPORT: "disabled",
        SMS_NOTIFICATIONS_ENABLED: "false",
      });
      for (const name of [
        "NOTIFICATION_STAGING_CONFIRM", "NOTIFICATION_STAGING_QA_CONFIRM", "NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST",
        "NOTIFICATION_OWNER_SMOKE_TEST_CONFIRM", "RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME",
        "RESEND_BASE_URL",
      ]) delete process.env[name];
      let authProviderCalls = 0;
      const authDependencies = {
        database: prisma,
        sendResend: async () => {
          authProviderCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 25));
          return "email_v078_auth_concurrent";
        },
      } as const;
      const authInput = {
        idempotencyKey: "auth-runtime/concurrent-registration",
        kind: "registration-code" as const,
        to: "auth-runtime@lnxbeats.fr",
        template: registrationCodeEmailTemplate("123456"),
      };
      await Promise.all([
        sendAuthEmail(authInput, authDependencies),
        sendAuthEmail(authInput, authDependencies),
      ]);
      assert.equal(authProviderCalls, 1, "Concurrent authentication requests crossed the persistent claim twice.");
      await sendAuthEmail(authInput, authDependencies);
      assert.equal(authProviderCalls, 1, "An accepted authentication email was sent again.");
      const authAudit = await prisma.notificationEvent.findFirstOrThrow({
        where: { providerMessageId: "email_v078_auth_concurrent" },
      });
      assert.equal(authAudit.providerEventType, "auth.email.accepted");
      assert.equal(authAudit.code, "AUTH_REGISTRATION_CODE_ACCEPTED");
    } finally {
      for (const [name, value] of savedAuthEnvironment) {
        if (value === undefined) delete process.env[name];
        else (process.env as Record<string, string | undefined>)[name] = value;
      }
    }

    const counts = await prisma.orderNotification.groupBy({ by: ["status"], where: { orderId: order.id }, _count: { _all: true } });
    assert.ok(counts.some(({ status }) => status === "DELIVERED"));
    assert.ok(counts.some(({ status }) => status === "COMPLAINED"));
    console.info("Notification runtime QA passed: idempotence, concurrent claim, retry, delivery, bounce, complaint and suppression lifecycle.");
  } finally {
    await cleanup();
    await assertClean("cleanup");
    await rm(CAPTURE_PATH, { force: true });
    await prisma.$disconnect();
  }
}

await main();
