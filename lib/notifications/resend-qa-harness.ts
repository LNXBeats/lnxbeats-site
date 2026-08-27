import "server-only";

import type { NotificationProvider, NotificationStatus, NotificationSuppressionReason, Prisma } from "@/generated/prisma/client";

import { parseNotificationConfiguration, type NotificationConfiguration } from "@/lib/notifications/config";
import { enqueueOrderNotification } from "@/lib/notifications/service";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export const RESEND_QA_CONFIRMATION = "resend-v073-qa-approved";

export const RESEND_QA_SCENARIOS = {
  delivered: {
    recipient: "delivered+lnx-v073-qa-01@resend.dev",
    orderNumber: "LNX-QA-RS-DELIVERED-01",
  },
  bounced: {
    recipient: "bounced+lnx-v073-qa-01@resend.dev",
    orderNumber: "LNX-QA-RS-BOUNCED-01",
  },
  complained: {
    recipient: "complained+lnx-v073-qa-01@resend.dev",
    orderNumber: "LNX-QA-RS-COMPLAINED-01",
  },
  suppressed: {
    recipient: "suppressed@resend.dev",
    orderNumber: "LNX-QA-RS-SUPPRESSED-01",
  },
  "scheduler-delivered": {
    recipient: "delivered+lnx-v079-scheduler-01@resend.dev",
    orderNumber: "LNX-QA-SCHEDULER-DELIVERED-01",
  },
} as const;

export type ResendQaScenario = keyof typeof RESEND_QA_SCENARIOS;

export type ResendQaFixtureResult = Readonly<{
  created: boolean;
  notificationId: string;
  scenario: ResendQaScenario;
  status: NotificationStatus;
}>;

export type ResendQaStatusResult = Readonly<{
  scenario: ResendQaScenario;
  notificationId: string;
  status: NotificationStatus;
  attempts: number;
  provider: NotificationProvider | null;
  providerMessageIdPresent: boolean;
  sentAtPresent: boolean;
  deliveredAtPresent: boolean;
  failedAtPresent: boolean;
  lastErrorCode: string | null;
  eventTypes: readonly string[];
  suppressionActive: boolean;
  suppressionReason: NotificationSuppressionReason | null;
}>;

export interface ResendQaHarnessRepository {
  create(scenario: ResendQaScenario): Promise<ResendQaFixtureResult>;
  read(scenario: ResendQaScenario): Promise<ResendQaStatusResult | null>;
}

export function resendQaIdempotencyKey(scenario: ResendQaScenario) {
  if (scenario === "scheduler-delivered") return "qa:scheduler:v079:delivered:01";
  return `qa:resend:v073:${scenario}:01`;
}

export function isResendQaScenario(value: unknown): value is ResendQaScenario {
  return typeof value === "string" && Object.hasOwn(RESEND_QA_SCENARIOS, value);
}

export function assertResendQaHarnessEnvironment(
  environment: Record<string, string | undefined> = process.env,
): NotificationConfiguration {
  const configuration = parseNotificationConfiguration(environment);
  if (
    environment.NODE_ENV !== "production"
    || environment.RAILWAY_ENVIRONMENT_NAME !== "staging"
    || /production/i.test(environment.RAILWAY_ENVIRONMENT ?? "")
    || environment.NOTIFICATION_DEPLOYMENT_ENV !== "staging"
    || environment.NOTIFICATION_EMAIL_TRANSPORT !== "resend"
    || environment.NOTIFICATION_STAGING_QA_CONFIRM !== RESEND_QA_CONFIRMATION
    || environment.EMAIL_NOTIFICATIONS_ENABLED !== "true"
    || environment.CLIENT_EMAIL_NOTIFICATIONS_ENABLED !== "false"
    || environment.PAYMENTS_ENABLED !== "false"
    || environment.SMS_TRANSPORT !== "disabled"
    || environment.SMS_NOTIFICATIONS_ENABLED !== "false"
    || configuration.deploymentEnvironment !== "staging"
    || configuration.emailTransport !== "resend"
    || !configuration.emailEnabled
    || configuration.clientEmailEnabled
    || configuration.smsTransport !== "disabled"
    || configuration.smsEnabled
  ) {
    throw new Error("Resend QA harness is unavailable.");
  }
  return configuration;
}

export function assertResendQaFixtureCreationAllowed(
  scenario: ResendQaScenario,
  configuration: NotificationConfiguration,
) {
  const expectedRecipient = RESEND_QA_SCENARIOS[scenario].recipient;
  if (!configuration.ownerEmailEnabled || configuration.ownerRecipient !== expectedRecipient) {
    throw new Error("Resend QA fixture creation is unavailable.");
  }
}

function fixtureTitle(scenario: ResendQaScenario) {
  return `Resend staging QA — ${scenario}`;
}

export function resendQaOrderData(
  scenario: ResendQaScenario,
  cancelledAt: Date = new Date(),
): Prisma.OrderCreateInput {
  const definition = RESEND_QA_SCENARIOS[scenario];
  return {
    orderNumber: definition.orderNumber,
    customerEmail: definition.recipient,
    customerName: `Resend QA ${scenario}`,
    status: "CANCELLED",
    title: fixtureTitle(scenario),
    brief: "Fixture synthétique V0.7.3.1 réservée au test Resend staging.",
    basePriceCents: 0,
    coverPriceCents: 0,
    priorityPriceCents: 0,
    totalCents: 0,
    pricingVersion: scenario === "scheduler-delivered" ? "qa-scheduler-v079" : "qa-resend-v073",
    cancelledAt,
  };
}

type FixtureIdentity = Readonly<{
  recipient: string | null;
  kind: string;
  order: Readonly<{
    orderNumber: string;
    userId: string | null;
    customerId: string | null;
    status: string;
    customerEmail: string;
    title: string | null;
  }> | null;
}>;

function assertFixtureIdentity(
  scenario: ResendQaScenario,
  fixture: FixtureIdentity,
) {
  const definition = RESEND_QA_SCENARIOS[scenario];
  if (
    fixture.recipient !== definition.recipient
    || fixture.kind !== "OWNER_NEW_ORDER"
    || !fixture.order
    || fixture.order.orderNumber !== definition.orderNumber
    || fixture.order.userId !== null
    || fixture.order.customerId !== null
    || fixture.order.status !== "CANCELLED"
    || fixture.order.customerEmail !== definition.recipient
    || fixture.order.title !== fixtureTitle(scenario)
  ) {
    throw new Error("Resend QA fixture identity mismatch.");
  }
}

export const databaseResendQaHarnessRepository: ResendQaHarnessRepository = {
  async create(scenario) {
    assertDatabaseConfigured();
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:resend-qa:${scenario}`})) IS NULL AS locked`;
      const definition = RESEND_QA_SCENARIOS[scenario];
      const idempotencyKey = resendQaIdempotencyKey(scenario);
      const current = await transaction.orderNotification.findUnique({
        where: { idempotencyKey },
        select: {
          id: true,
          status: true,
          recipient: true,
          kind: true,
          order: { select: { orderNumber: true, userId: true, customerId: true, status: true, customerEmail: true, title: true } },
        },
      });
      if (current) {
        assertFixtureIdentity(scenario, current);
        return { created: false, notificationId: current.id, scenario, status: current.status };
      }

      const existingOrder = await transaction.order.findUnique({
        where: { orderNumber: definition.orderNumber },
        select: { id: true, orderNumber: true, userId: true, customerId: true, status: true, customerEmail: true, title: true },
      });
      if (existingOrder && (
        existingOrder.userId !== null
        || existingOrder.customerId !== null
        || existingOrder.status !== "CANCELLED"
        || existingOrder.customerEmail !== definition.recipient
        || existingOrder.title !== fixtureTitle(scenario)
      )) {
        throw new Error("Resend QA order identity mismatch.");
      }
      const order = existingOrder ?? await transaction.order.create({
        data: resendQaOrderData(scenario),
        select: { id: true },
      });
      const notification = await enqueueOrderNotification(transaction, {
        orderId: order.id,
        kind: "OWNER_NEW_ORDER",
        recipient: definition.recipient,
        idempotencyKey,
        resource: {
          type: "ORDER",
          id: order.id,
          reference: definition.orderNumber,
          workTitle: fixtureTitle(scenario),
        },
      });
      const created = await transaction.orderNotification.findUniqueOrThrow({
        where: { id: notification.id },
        select: { id: true, status: true },
      });
      return { created: true, notificationId: created.id, scenario, status: created.status };
    }, { isolationLevel: "ReadCommitted" });
  },

  async read(scenario) {
    assertDatabaseConfigured();
    const definition = RESEND_QA_SCENARIOS[scenario];
    const notification = await prisma.orderNotification.findUnique({
      where: { idempotencyKey: resendQaIdempotencyKey(scenario) },
      select: {
        id: true,
        status: true,
        attempts: true,
        provider: true,
        providerMessageId: true,
        sentAt: true,
        deliveredAt: true,
        failedAt: true,
        lastErrorCode: true,
        recipient: true,
        kind: true,
        order: { select: { orderNumber: true, userId: true, customerId: true, status: true, customerEmail: true, title: true } },
        events: {
          where: { providerEventType: { not: null } },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          select: { providerEventType: true },
        },
      },
    });
    if (!notification) return null;
    assertFixtureIdentity(scenario, notification);
    const suppression = await prisma.notificationSuppression.findUnique({
      where: { channel_recipient: { channel: "EMAIL", recipient: definition.recipient } },
      select: { active: true, reason: true },
    });
    return {
      scenario,
      notificationId: notification.id,
      status: notification.status,
      attempts: notification.attempts,
      provider: notification.provider,
      providerMessageIdPresent: notification.providerMessageId !== null,
      sentAtPresent: notification.sentAt !== null,
      deliveredAtPresent: notification.deliveredAt !== null,
      failedAtPresent: notification.failedAt !== null,
      lastErrorCode: notification.lastErrorCode,
      eventTypes: notification.events.flatMap(({ providerEventType }) => providerEventType ? [providerEventType] : []),
      suppressionActive: suppression?.active ?? false,
      suppressionReason: suppression?.reason ?? null,
    };
  },
};
