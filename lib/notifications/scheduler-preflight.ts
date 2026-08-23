import "server-only";

import { NOTIFICATION_SCHEDULER_MODE, parseNotificationConfiguration } from "@/lib/notifications/config";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export type NotificationSchedulerPreflightRule = Readonly<{
  name: string;
  passed: boolean;
  detail?: string;
}>;

function flag(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function evaluateNotificationSchedulerEnvironment(
  environment: Record<string, string | undefined>,
): NotificationSchedulerPreflightRule[] {
  const deploymentEnvironment = environment.NOTIFICATION_DEPLOYMENT_ENV?.trim().toLowerCase();
  const rules: NotificationSchedulerPreflightRule[] = [
    { name: "scheduler.mode.railwayCron", passed: environment.NOTIFICATION_SCHEDULER_MODE?.trim().toLowerCase() === NOTIFICATION_SCHEDULER_MODE },
    { name: "scheduler.environment.explicit", passed: deploymentEnvironment === "staging" || deploymentEnvironment === "production" },
    { name: "scheduler.worker.enabled", passed: flag(environment.NOTIFICATION_WORKER_ENABLED) },
    { name: "scheduler.email.enabled", passed: flag(environment.EMAIL_NOTIFICATIONS_ENABLED) },
    { name: "scheduler.worker.secret.present", passed: (environment.NOTIFICATION_WORKER_SECRET?.trim().length ?? 0) >= 32 },
    { name: "scheduler.sms.disabled", passed: environment.SMS_TRANSPORT?.trim().toLowerCase() === "disabled" && !flag(environment.SMS_NOTIFICATIONS_ENABLED) },
  ];
  try {
    const configuration = parseNotificationConfiguration(environment);
    rules.push(
      { name: "scheduler.configuration.valid", passed: true },
      { name: "scheduler.transport.configured", passed: configuration.emailConfigured },
      { name: "scheduler.environment.matches", passed: configuration.deploymentEnvironment === deploymentEnvironment },
    );
  } catch {
    rules.push({ name: "scheduler.configuration.valid", passed: false });
  }
  return rules;
}

type DatabaseClient = Pick<typeof prisma, "orderNotification" | "notificationEvent" | "$queryRaw">;

export async function evaluateNotificationSchedulerDatabase(
  deploymentEnvironment: "staging" | "production",
  database: DatabaseClient = prisma,
) {
  if (database === prisma) assertDatabaseConfigured();
  const schema = await database.$queryRaw<Array<{ tables_ready: boolean; indexes_ready: boolean }>>`
    SELECT
      to_regclass('public.order_notifications') IS NOT NULL
        AND to_regclass('public.notification_events') IS NOT NULL
        AND to_regclass('public.notification_suppressions') IS NOT NULL AS tables_ready,
      to_regclass('public."order_notifications_idempotencyKey_key"') IS NOT NULL
        AND to_regclass('public."order_notifications_providerMessageId_key"') IS NOT NULL
        AND to_regclass('public."notification_events_providerEventId_key"') IS NOT NULL AS indexes_ready
  `;
  const now = new Date();
  const [pending, retryable, expiredLeases, requiresReview, foreignEnvironment] = await Promise.all([
    database.orderNotification.count({ where: { deploymentEnvironment, status: "PENDING" } }),
    database.orderNotification.count({ where: { deploymentEnvironment, status: "FAILED_RETRYABLE" } }),
    database.orderNotification.count({ where: { deploymentEnvironment, status: "PROCESSING", leaseExpiresAt: { lte: now } } }),
    database.notificationEvent.count({ where: { outcome: "REQUIRES_REVIEW" } }),
    database.orderNotification.count({
      where: {
        deploymentEnvironment: { not: deploymentEnvironment },
        status: { in: ["PENDING", "FAILED_RETRYABLE", "PROCESSING"] },
      },
    }),
  ]);
  const first = schema[0];
  return {
    rules: [
      { name: "scheduler.database.notificationTables", passed: first?.tables_ready === true },
      { name: "scheduler.database.notificationIndexes", passed: first?.indexes_ready === true },
    ] satisfies NotificationSchedulerPreflightRule[],
    metrics: { pending, retryable, expiredLeases, requiresReview, foreignEnvironment },
  } as const;
}

export async function runNotificationSchedulerPreflight(
  environment: Record<string, string | undefined> = process.env,
) {
  const environmentRules = evaluateNotificationSchedulerEnvironment(environment);
  const deploymentEnvironment = environment.NOTIFICATION_DEPLOYMENT_ENV?.trim().toLowerCase();
  let databaseRules: NotificationSchedulerPreflightRule[] = [];
  let metrics = { pending: 0, retryable: 0, expiredLeases: 0, requiresReview: 0, foreignEnvironment: 0 };
  if (deploymentEnvironment === "staging" || deploymentEnvironment === "production") {
    try {
      const result = await evaluateNotificationSchedulerDatabase(deploymentEnvironment);
      databaseRules = result.rules;
      metrics = result.metrics;
    } catch {
      databaseRules = [{ name: "scheduler.database.readOnlyCheck", passed: false }];
    }
  } else {
    databaseRules = [{ name: "scheduler.database.readOnlyCheck", passed: false }];
  }
  const rules = [...environmentRules, ...databaseRules];
  return {
    passed: rules.every((rule) => rule.passed),
    rules,
    metrics,
    externalSchedulerVerified: false,
  } as const;
}
