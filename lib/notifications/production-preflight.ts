import "server-only";

import { NOTIFICATION_PRODUCTION_CONFIRMATION, NOTIFICATION_SCHEDULER_MODE, parseNotificationConfiguration, RESEND_API_BASE_URL } from "@/lib/notifications/config";
import { isFictitiousRecipient, notificationKindsForAudience } from "@/lib/notifications/domain";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export type NotificationPreflightRule = Readonly<{
  name: string;
  passed: boolean;
  detail?: string;
}>;

export type ProductionNotificationPreflightProfile = "all-audiences" | "owner-only";

function present(value: string | undefined, prefix?: string) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 && (!prefix || normalized.startsWith(prefix));
}

function flag(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function absent(environment: Record<string, string | undefined>, names: readonly string[]) {
  return names.every((name) => !environment[name]?.trim());
}

export function evaluateProductionNotificationEnvironment(
  environment: Record<string, string | undefined>,
  profile: ProductionNotificationPreflightProfile = "all-audiences",
): NotificationPreflightRule[] {
  const ownerOnly = profile === "owner-only";
  const rules: NotificationPreflightRule[] = [
    { name: "deployment.production", passed: environment.NOTIFICATION_DEPLOYMENT_ENV?.trim().toLowerCase() === "production" },
    { name: "transport.resend", passed: environment.NOTIFICATION_EMAIL_TRANSPORT?.trim().toLowerCase() === "resend" },
    { name: "email.global.enabled", passed: flag(environment.EMAIL_NOTIFICATIONS_ENABLED) },
    { name: "email.owner.enabled", passed: flag(environment.OWNER_EMAIL_NOTIFICATIONS_ENABLED) },
    {
      name: ownerOnly ? "email.client.disabled" : "email.client.enabled",
      passed: ownerOnly
        ? environment.CLIENT_EMAIL_NOTIFICATIONS_ENABLED?.trim().toLowerCase() === "false"
        : flag(environment.CLIENT_EMAIL_NOTIFICATIONS_ENABLED),
    },
    { name: "worker.enabled", passed: flag(environment.NOTIFICATION_WORKER_ENABLED) },
    { name: "scheduler.mode.railwayCron", passed: environment.NOTIFICATION_SCHEDULER_MODE?.trim().toLowerCase() === NOTIFICATION_SCHEDULER_MODE },
    { name: "sms.disabled", passed: environment.SMS_TRANSPORT?.trim().toLowerCase() === "disabled" && !flag(environment.SMS_NOTIFICATIONS_ENABLED) },
    { name: "production.confirmed", passed: environment.NOTIFICATION_PRODUCTION_CONFIRM === NOTIFICATION_PRODUCTION_CONFIRMATION },
    { name: "resend.apiKey.present", passed: present(environment.RESEND_API_KEY, "re_") },
    { name: "resend.webhookSecret.present", passed: present(environment.RESEND_WEBHOOK_SECRET, "whsec_") },
    { name: "worker.secret.present", passed: (environment.NOTIFICATION_WORKER_SECRET?.trim().length ?? 0) >= 32 },
    { name: "auth.provider.resend", passed: environment.EMAIL_PROVIDER?.trim().toLowerCase() === "resend" },
    { name: "resend.baseUrl.approved", passed: !environment.RESEND_BASE_URL?.trim() || environment.RESEND_BASE_URL.trim() === RESEND_API_BASE_URL },
    {
      name: "staging.controls.absent",
      passed: absent(environment, [
        "NOTIFICATION_STAGING_CONFIRM",
        "NOTIFICATION_STAGING_QA_CONFIRM",
        "NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST",
        "NOTIFICATION_OWNER_SMOKE_TEST_CONFIRM",
      ]),
    },
  ];
  try {
    const configuration = parseNotificationConfiguration(environment);
    const authUrl = new URL(environment.AUTH_URL ?? "").origin;
    rules.push(
      { name: "configuration.valid", passed: true },
      { name: "sender.configured", passed: Boolean(configuration.emailFrom) },
      { name: "replyTo.configured", passed: Boolean(configuration.emailReplyTo) },
      ...(ownerOnly ? [{ name: "replyTo.owner.expected", passed: configuration.emailReplyTo === "contact@lnxbeats.fr" }] : []),
      { name: "owner.recipient.configured", passed: Boolean(configuration.ownerRecipient) },
      { name: "canonical.https", passed: Boolean(configuration.canonicalUrl?.startsWith("https://")) },
      { name: "auth.canonical.match", passed: Boolean(configuration.canonicalUrl && authUrl === configuration.canonicalUrl) },
      { name: "webhook.configured", passed: configuration.webhookConfigured },
      { name: "worker.configured", passed: configuration.workerConfigured && configuration.workerEnabled },
      {
        name: "owner.recipient.production",
        passed: Boolean(configuration.ownerRecipient && !isFictitiousRecipient(configuration.ownerRecipient) && !configuration.ownerRecipient.endsWith("@resend.dev")),
      },
    );
  } catch {
    rules.push({ name: "configuration.valid", passed: false });
  }
  return rules;
}

type DatabaseClient = Pick<typeof prisma, "orderNotification" | "notificationSuppression" | "notificationEvent" | "$queryRaw">;

export async function evaluateProductionNotificationDatabase(
  database: DatabaseClient = prisma,
  ownerRecipient = process.env.EMAIL_OWNER_RECIPIENT?.trim().toLowerCase() || null,
): Promise<NotificationPreflightRule[]> {
  if (database === prisma) assertDatabaseConfigured();
  const schema = await database.$queryRaw<Array<{ tables_ready: boolean; indexes_ready: boolean; migrations: bigint; latest_ready: boolean }>>`
    SELECT
      to_regclass('public.order_notifications') IS NOT NULL
        AND to_regclass('public.notification_events') IS NOT NULL
        AND to_regclass('public.notification_suppressions') IS NOT NULL AS tables_ready,
      to_regclass('public."order_notifications_idempotencyKey_key"') IS NOT NULL
        AND to_regclass('public."order_notifications_providerMessageId_key"') IS NOT NULL
        AND to_regclass('public."notification_events_providerEventId_key"') IS NOT NULL
        AND to_regclass('public."notification_suppressions_channel_recipient_key"') IS NOT NULL AS indexes_ready,
      (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrations,
      EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20260822200000_payment_refunds_incidents'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      ) AS latest_ready
  `;
  const now = new Date();
  const [foreignEnvironment, qaRecipients, expiredLeases, reviewEvents, finalFailures, activeSuppressions, ownerSuppression] = await Promise.all([
    database.orderNotification.count({
      where: {
        deploymentEnvironment: { not: "production" },
        OR: [{ status: "PENDING" }, { status: "FAILED_RETRYABLE" }, { status: "PROCESSING" }],
      },
    }),
    database.orderNotification.count({
      where: {
        deploymentEnvironment: "production",
        recipient: { not: null },
        OR: [
          { recipient: { endsWith: ".invalid" } },
          { recipient: { endsWith: ".test" } },
          { recipient: { endsWith: "@resend.dev" } },
        ],
      },
    }),
    database.orderNotification.count({ where: { status: "PROCESSING", leaseExpiresAt: { lte: now } } }),
    database.notificationEvent.count({ where: { outcome: "REQUIRES_REVIEW" } }),
    database.orderNotification.count({ where: { deploymentEnvironment: "production", status: "FAILED_FINAL" } }),
    database.notificationSuppression.count({ where: { channel: "EMAIL", active: true } }),
    ownerRecipient ? database.notificationSuppression.count({ where: { channel: "EMAIL", recipient: ownerRecipient, active: true } }) : Promise.resolve(1),
  ]);
  const first = schema[0];
  return [
    { name: "database.notificationTables", passed: first?.tables_ready === true },
    { name: "database.notificationIndexes", passed: first?.indexes_ready === true },
    { name: "database.migrations", passed: Number(first?.migrations ?? 0) === 17 && first?.latest_ready === true, detail: `count=${Number(first?.migrations ?? 0)}` },
    { name: "outbox.foreignEnvironment", passed: foreignEnvironment === 0, detail: `count=${foreignEnvironment}` },
    { name: "outbox.qaRecipients", passed: qaRecipients === 0, detail: `count=${qaRecipients}` },
    { name: "outbox.expiredLeases", passed: expiredLeases === 0, detail: `count=${expiredLeases}` },
    { name: "events.requiresReview.reported", passed: true, detail: `count=${reviewEvents}` },
    { name: "outbox.finalFailures.reported", passed: true, detail: `count=${finalFailures}` },
    { name: "suppressions.active.reported", passed: true, detail: `count=${activeSuppressions}` },
    { name: "owner.notSuppressed", passed: ownerSuppression === 0 },
  ];
}

export async function evaluateProductionOwnerNotificationDatabase(
  database: DatabaseClient = prisma,
  ownerRecipient = process.env.EMAIL_OWNER_RECIPIENT?.trim().toLowerCase() || null,
): Promise<NotificationPreflightRule[]> {
  const baseRules = await evaluateProductionNotificationDatabase(database, ownerRecipient);
  const ownerKinds = notificationKindsForAudience("OWNER");
  const [pending, retryable, processing, finalFailures, nonOwnerClaimable, requiresReview] = await Promise.all([
    database.orderNotification.count({
      where: { deploymentEnvironment: "production", kind: { in: ownerKinds }, status: "PENDING" },
    }),
    database.orderNotification.count({
      where: { deploymentEnvironment: "production", kind: { in: ownerKinds }, status: "FAILED_RETRYABLE" },
    }),
    database.orderNotification.count({
      where: { deploymentEnvironment: "production", kind: { in: ownerKinds }, status: "PROCESSING" },
    }),
    database.orderNotification.count({
      where: { deploymentEnvironment: "production", kind: { in: ownerKinds }, status: "FAILED_FINAL" },
    }),
    database.orderNotification.count({
      where: {
        deploymentEnvironment: "production",
        kind: { notIn: ownerKinds },
        status: { in: ["PENDING", "FAILED_RETRYABLE", "PROCESSING"] },
      },
    }),
    database.notificationEvent.count({ where: { outcome: "REQUIRES_REVIEW" } }),
  ]);
  return [
    ...baseRules,
    { name: "outbox.owner.pending", passed: pending === 0, detail: `count=${pending}` },
    { name: "outbox.owner.retryable", passed: retryable === 0, detail: `count=${retryable}` },
    { name: "outbox.owner.processing", passed: processing === 0, detail: `count=${processing}` },
    { name: "outbox.owner.final.none", passed: finalFailures === 0, detail: `count=${finalFailures}` },
    { name: "outbox.nonOwner.claimable.none", passed: nonOwnerClaimable === 0, detail: `count=${nonOwnerClaimable}` },
    { name: "events.requiresReview.none", passed: requiresReview === 0, detail: `count=${requiresReview}` },
  ];
}

export async function runProductionNotificationPreflight(
  environment: Record<string, string | undefined> = process.env,
) {
  const configurationRules = evaluateProductionNotificationEnvironment(environment);
  let databaseRules: NotificationPreflightRule[];
  try {
    databaseRules = await evaluateProductionNotificationDatabase(prisma, environment.EMAIL_OWNER_RECIPIENT?.trim().toLowerCase() || null);
  } catch {
    databaseRules = [{ name: "database.readOnlyCheck", passed: false }];
  }
  const rules = [...configurationRules, ...databaseRules];
  return { passed: rules.every((rule) => rule.passed), rules } as const;
}

export async function runProductionOwnerNotificationPreflight(
  environment: Record<string, string | undefined> = process.env,
) {
  const configurationRules = evaluateProductionNotificationEnvironment(environment, "owner-only");
  let databaseRules: NotificationPreflightRule[];
  try {
    databaseRules = await evaluateProductionOwnerNotificationDatabase(
      prisma,
      environment.EMAIL_OWNER_RECIPIENT?.trim().toLowerCase() || null,
    );
  } catch {
    databaseRules = [{ name: "database.readOnlyCheck", passed: false }];
  }
  const rules = [...configurationRules, ...databaseRules];
  return { passed: rules.every((rule) => rule.passed), rules } as const;
}
