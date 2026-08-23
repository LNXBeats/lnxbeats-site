import assert from "node:assert/strict";

import { recipientHash } from "@/lib/notifications/domain";
import { loadAndAssertNotificationQaEnvironment } from "@/lib/notifications/qa-guard";
import { runNotificationSchedulerTick, type NotificationSchedulerDependencies } from "@/lib/notifications/scheduler";
import {
  databaseNotificationDispatchRepository,
  dispatchOrderNotification,
  dispatchPendingOrderNotifications,
} from "@/lib/notifications/service";
import type { NotificationTransportResult } from "@/lib/notifications/types";
import { prisma } from "@/lib/prisma";

const EMAIL = "lnx-v079-scheduler-member@example.invalid";
const SUPPRESSED_EMAIL = "lnx-v079-scheduler-suppressed@example.invalid";
const ORDER_NUMBER = "LNX-2099-079001";
const KEY_PREFIX = "scheduler:v079:";
const WORKER_SECRET = "v079-local-scheduler-worker-secret-0001";

const schedulerEnvironment = {
  NODE_ENV: "test",
  NOTIFICATION_DEPLOYMENT_ENV: "staging",
  NOTIFICATION_EMAIL_TRANSPORT: "capture",
  EMAIL_NOTIFICATIONS_ENABLED: "true",
  OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
  CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
  NOTIFICATION_WORKER_ENABLED: "true",
  NOTIFICATION_WORKER_SECRET: WORKER_SECRET,
  NOTIFICATION_SCHEDULER_MODE: "railway-cron",
  SMS_TRANSPORT: "disabled",
  SMS_NOTIFICATIONS_ENABLED: "false",
} satisfies Record<string, string>;

async function scope() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  const order = await prisma.order.findUnique({ where: { orderNumber: ORDER_NUMBER }, select: { id: true } });
  return { userId: user?.id, orderId: order?.id };
}

async function cleanup() {
  const current = await scope();
  if (current.orderId) {
    const notificationIds = (await prisma.orderNotification.findMany({
      where: { orderId: current.orderId },
      select: { id: true },
    })).map(({ id }) => id);
    await prisma.$transaction(async (transaction) => {
      if (notificationIds.length) await transaction.notificationEvent.deleteMany({ where: { notificationId: { in: notificationIds } } });
      await transaction.orderNotification.deleteMany({ where: { orderId: current.orderId } });
      await transaction.orderEvent.deleteMany({ where: { orderId: current.orderId } });
      await transaction.order.delete({ where: { id: current.orderId } });
      if (current.userId) await transaction.user.delete({ where: { id: current.userId } });
    });
  } else if (current.userId) {
    await prisma.user.delete({ where: { id: current.userId } });
  }
  await prisma.notificationSuppression.deleteMany({ where: { recipient: SUPPRESSED_EMAIL } });
}

async function assertClean(stage: string) {
  const [users, orders, notifications, suppressions] = await Promise.all([
    prisma.user.count({ where: { email: EMAIL } }),
    prisma.order.count({ where: { orderNumber: ORDER_NUMBER } }),
    prisma.orderNotification.count({ where: { idempotencyKey: { startsWith: KEY_PREFIX } } }),
    prisma.notificationSuppression.count({ where: { recipient: SUPPRESSED_EMAIL } }),
  ]);
  assert.deepEqual({ users, orders, notifications, suppressions }, { users: 0, orders: 0, notifications: 0, suppressions: 0 }, `${stage}: scheduler fixtures remain.`);
}

function notificationData(
  order: { id: string; orderNumber: string; createdAt: Date },
  suffix: string,
  deploymentEnvironment = "staging",
  input: { recipient?: string | null; status?: "PENDING" | "FAILED_RETRYABLE" | "PROCESSING"; availableAt?: Date; leaseExpiresAt?: Date; attempts?: number } = {},
) {
  return {
    orderId: order.id,
    kind: "CUSTOMER_PAYMENT_CONFIRMED" as const,
    channel: "EMAIL" as const,
    priority: "CRITICAL" as const,
    recipient: input.recipient === undefined ? EMAIL : input.recipient,
    idempotencyKey: `${KEY_PREFIX}${suffix}`,
    templateKey: "customer-payment-confirmed",
    templateVersion: 1,
    payloadVersion: 1,
    payload: {
      orderNumber: order.orderNumber,
      customerName: "Scheduler Runtime QA",
      customerEmail: EMAIL,
      totalCents: 9_000,
      currency: "EUR",
      coverIncluded: true,
      priorityProcessing: true,
      createdAt: order.createdAt.toISOString(),
    },
    resourceType: "ORDER",
    resourceId: order.id,
    resourceReference: order.orderNumber,
    deploymentEnvironment,
    status: input.status ?? "PENDING",
    availableAt: input.availableAt ?? new Date(Date.now() - 60_000),
    leaseExpiresAt: input.leaseExpiresAt,
    processingStartedAt: input.status === "PROCESSING" ? new Date(Date.now() - 60_000) : undefined,
    failedAt: input.status === "FAILED_RETRYABLE" ? new Date(Date.now() - 60_000) : undefined,
    attempts: input.attempts ?? 0,
  };
}

async function main() {
  await loadAndAssertNotificationQaEnvironment();
  await cleanup();
  await assertClean("precondition");
  Object.assign(process.env, schedulerEnvironment);
  const providerCalls = new Map<string, number>();
  const sendEmail = async (message: { id: string }): Promise<NotificationTransportResult> => {
    providerCalls.set(message.id, (providerCalls.get(message.id) ?? 0) + 1);
    await new Promise((resolve) => setTimeout(resolve, 4));
    return { provider: "CAPTURE", providerMessageId: `capture_v079_${message.id}`, deliveredImmediately: true };
  };
  const dispatchOne = (id: string) => dispatchOrderNotification(id, {
    repository: databaseNotificationDispatchRepository,
    sendEmail,
  });
  const dispatchBatch = (limit: number) => dispatchPendingOrderNotifications(limit, { dispatch: dispatchOne });
  const silentDependencies: NotificationSchedulerDependencies = {
    dispatch: dispatchBatch,
    now: Date.now,
    info: () => undefined,
    error: () => undefined,
  };

  try {
    const user = await prisma.user.create({
      data: { email: EMAIL, emailVerified: true, emailVerifiedAt: new Date(), displayName: "Scheduler Runtime QA", status: "ACTIVE", role: "MEMBER" },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: ORDER_NUMBER,
        userId: user.id,
        customerEmail: EMAIL,
        customerName: "Scheduler Runtime QA",
        status: "PAYMENT_CONFIRMED",
        title: "Scheduler QA",
        brief: "Fixture locale et jetable.",
        coverIncluded: true,
        priorityProcessing: true,
        coverPriceCents: 1_000,
        priorityPriceCents: 3_000,
        totalCents: 9_000,
      },
      select: { id: true, orderNumber: true, createdAt: true },
    });

    await prisma.orderNotification.createMany({
      data: Array.from({ length: 55 }, (_, index) => notificationData(order, `backlog:${String(index).padStart(2, "0")}`)),
    });
    await prisma.orderNotification.createMany({
      data: [
        notificationData(order, "foreign:production", "production"),
        notificationData(order, "foreign:development", "development"),
      ],
    });

    const firstTick = await runNotificationSchedulerTick(process.env, silentDependencies);
    assert.equal(firstTick.exitCode, 0);
    assert.equal(firstTick.claimed, 25, "A scheduler tick exceeded or missed its exact 25-row batch.");
    assert.equal(await prisma.orderNotification.count({ where: { deploymentEnvironment: "staging", status: "PENDING" } }), 30);

    const overlap = await Promise.all([
      runNotificationSchedulerTick(process.env, silentDependencies),
      runNotificationSchedulerTick(process.env, silentDependencies),
    ]);
    assert.ok(overlap.every((result) => result.claimed <= 25), "An overlapping scheduler exceeded the batch bound.");
    assert.ok([...providerCalls.values()].every((count) => count === 1), "Overlapping schedulers contacted the provider twice for one notification.");

    for (let tick = 0; tick < 2; tick += 1) {
      if (await prisma.orderNotification.count({ where: { deploymentEnvironment: "staging", status: "PENDING" } }) === 0) break;
      await runNotificationSchedulerTick(process.env, silentDependencies);
    }
    assert.equal(await prisma.orderNotification.count({ where: { deploymentEnvironment: "staging", status: "PENDING" } }), 0, "The bounded backlog did not converge.");
    assert.equal(await prisma.orderNotification.count({ where: { deploymentEnvironment: "staging", status: "DELIVERED" } }), 55);
    assert.equal(providerCalls.size, 55);
    assert.ok([...providerCalls.values()].every((count) => count === 1));
    assert.equal(await prisma.orderNotification.count({ where: { deploymentEnvironment: { in: ["production", "development"] }, status: "PENDING", attempts: 0 } }), 2, "A foreign environment was claimed.");

    const future = await prisma.orderNotification.create({ data: notificationData(order, "future", "staging", { availableAt: new Date(Date.now() + 60 * 60_000) }) });
    const retry = await prisma.orderNotification.create({ data: notificationData(order, "retry", "staging", { status: "FAILED_RETRYABLE", availableAt: new Date(Date.now() + 60 * 60_000), attempts: 1 }) });
    assert.equal((await runNotificationSchedulerTick(process.env, silentDependencies)).claimed, 0, "The scheduler bypassed availableAt.");
    await prisma.orderNotification.update({ where: { id: retry.id }, data: { availableAt: new Date(Date.now() - 1_000) } });
    assert.equal((await runNotificationSchedulerTick(process.env, silentDependencies)).claimed, 1);
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: retry.id } })).attempts, 2);
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: future.id } })).attempts, 0);

    const leased = await prisma.orderNotification.create({
      data: notificationData(order, "lease", "staging", { status: "PROCESSING", leaseExpiresAt: new Date(Date.now() + 60 * 60_000), attempts: 1 }),
    });
    assert.equal((await runNotificationSchedulerTick(process.env, silentDependencies)).claimed, 0, "An active lease was reclaimed.");
    await prisma.orderNotification.update({ where: { id: leased.id }, data: { leaseExpiresAt: new Date(Date.now() - 1_000) } });
    assert.equal((await runNotificationSchedulerTick(process.env, silentDependencies)).claimed, 1);
    const recovered = await prisma.orderNotification.findUniqueOrThrow({ where: { id: leased.id } });
    assert.equal(recovered.status, "DELIVERED");
    assert.equal(recovered.attempts, 2);

    const disabled = await prisma.orderNotification.create({
      data: notificationData(order, "worker-disabled", "staging", { availableAt: new Date(Date.now() + 60 * 60_000) }),
    });
    const disabledResult = await runNotificationSchedulerTick({
      ...schedulerEnvironment,
      NOTIFICATION_WORKER_ENABLED: "false",
    }, silentDependencies);
    assert.equal(disabledResult.outcome, "disabled");
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: disabled.id } })).attempts, 0);

    const emailDisabledResult = await runNotificationSchedulerTick({
      ...schedulerEnvironment,
      NOTIFICATION_EMAIL_TRANSPORT: "disabled",
      EMAIL_NOTIFICATIONS_ENABLED: "false",
      OWNER_EMAIL_NOTIFICATIONS_ENABLED: "false",
      CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
    }, silentDependencies);
    assert.equal(emailDisabledResult.exitCode, 1);
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: disabled.id } })).attempts, 0, "Invalid configuration mutated the outbox.");

    await prisma.notificationSuppression.create({
      data: {
        channel: "EMAIL",
        recipient: SUPPRESSED_EMAIL,
        recipientHashSha256: recipientHash(SUPPRESSED_EMAIL),
        reason: "MANUAL",
        active: true,
        lastEventAt: new Date(),
      },
    });
    const suppressed = await prisma.orderNotification.create({ data: notificationData(order, "suppressed", "staging", { recipient: SUPPRESSED_EMAIL }) });
    const callsBeforeSuppression = providerCalls.size;
    await runNotificationSchedulerTick(process.env, silentDependencies);
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: suppressed.id } })).status, "SUPPRESSED");
    assert.equal(providerCalls.size, callsBeforeSuppression, "A suppressed recipient reached the provider.");

    const invalidRecipient = await prisma.orderNotification.create({ data: notificationData(order, "missing-recipient", "staging", { recipient: null }) });
    await runNotificationSchedulerTick(process.env, silentDependencies);
    const invalid = await prisma.orderNotification.findUniqueOrThrow({ where: { id: invalidRecipient.id } });
    assert.equal(invalid.status, "FAILED_FINAL");
    assert.equal(invalid.lastErrorCode, "RECIPIENT_MISSING");

    const retryableFailure = await prisma.orderNotification.create({ data: notificationData(order, "provider-429") });
    await dispatchOrderNotification(retryableFailure.id, {
      repository: databaseNotificationDispatchRepository,
      sendEmail: async () => { throw Object.assign(new Error("private provider detail"), { statusCode: 429 }); },
    });
    const after429 = await prisma.orderNotification.findUniqueOrThrow({ where: { id: retryableFailure.id } });
    assert.equal(after429.status, "FAILED_RETRYABLE");
    assert.equal(after429.attempts, 1);
    assert.ok(after429.availableAt > new Date());

    console.info("Notification scheduler PostgreSQL QA passed: batch=25, overlap, convergence, lease, retry, environment isolation, disabled flags and suppression.");
  } finally {
    await cleanup();
    await assertClean("postcondition");
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Notification scheduler runtime QA failed.");
  process.exitCode = 1;
});
