-- V0.7.3 transactional notification foundation. This migration is additive:
-- historical notifications are retained and backfilled from their immutable Order snapshot.

ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_PAYMENT_CONFIRMED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_ORDER_ACCEPTED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_CREATION_STARTED';

ALTER TYPE "NotificationStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "NotificationStatus" ADD VALUE 'FAILED_RETRYABLE';
ALTER TYPE "NotificationStatus" ADD VALUE 'FAILED_FINAL';
ALTER TYPE "NotificationStatus" ADD VALUE 'BOUNCED';
ALTER TYPE "NotificationStatus" ADD VALUE 'COMPLAINED';
ALTER TYPE "NotificationStatus" ADD VALUE 'SUPPRESSED';
ALTER TYPE "NotificationStatus" ADD VALUE 'CANCELED';

CREATE TYPE "NotificationProvider" AS ENUM ('CAPTURE', 'RESEND');
CREATE TYPE "NotificationPriority" AS ENUM ('CRITICAL', 'INFORMATIONAL', 'INTERNAL');
CREATE TYPE "NotificationEventOutcome" AS ENUM ('PROCESSED', 'IGNORED', 'REQUIRES_REVIEW');
CREATE TYPE "NotificationSuppressionReason" AS ENUM ('HARD_BOUNCE', 'COMPLAINT', 'PROVIDER_SUPPRESSED', 'MANUAL');

ALTER TABLE "order_notifications"
  ADD COLUMN "priority" "NotificationPriority" NOT NULL DEFAULT 'INFORMATIONAL',
  ADD COLUMN "templateKey" VARCHAR(80) NOT NULL DEFAULT 'legacy-order-notification',
  ADD COLUMN "templateVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "resourceType" VARCHAR(32) NOT NULL DEFAULT 'ORDER',
  ADD COLUMN "resourceId" UUID,
  ADD COLUMN "resourceReference" VARCHAR(80),
  ADD COLUMN "deploymentEnvironment" VARCHAR(16) NOT NULL DEFAULT 'development',
  ADD COLUMN "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "processingStartedAt" TIMESTAMPTZ(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "deliveredAt" TIMESTAMPTZ(3),
  ADD COLUMN "failedAt" TIMESTAMPTZ(3),
  ADD COLUMN "provider" "NotificationProvider",
  ADD COLUMN "providerMessageId" VARCHAR(255),
  ADD COLUMN "lastErrorMessage" VARCHAR(240);

UPDATE "order_notifications" AS notification
SET
  "templateKey" = CASE notification."kind"::text
    WHEN 'OWNER_NEW_ORDER' THEN 'owner-new-order'
    WHEN 'CUSTOMER_DELIVERY_READY' THEN 'customer-delivery-ready'
    ELSE lower(replace(notification."kind"::text, '_', '-'))
  END,
  "priority" = CASE notification."kind"::text
    WHEN 'OWNER_NEW_ORDER' THEN 'CRITICAL'::"NotificationPriority"
    WHEN 'CUSTOMER_DELIVERY_READY' THEN 'CRITICAL'::"NotificationPriority"
    WHEN 'CUSTOMER_RIGHTS_INFORMATION_REQUIRED' THEN 'CRITICAL'::"NotificationPriority"
    ELSE 'INFORMATIONAL'::"NotificationPriority"
  END,
  "resourceId" = notification."orderId",
  "resourceReference" = orders."orderNumber",
  "payload" = jsonb_build_object(
    'orderNumber', orders."orderNumber",
    'customerName', orders."customerName",
    'customerEmail', orders."customerEmail",
    'totalCents', orders."totalCents",
    'currency', orders."currency",
    'coverIncluded', orders."coverIncluded",
    'priorityProcessing', orders."priorityProcessing",
    'createdAt', to_char(orders."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ),
  "failedAt" = CASE WHEN notification."status" = 'FAILED' THEN notification."updatedAt" ELSE NULL END
FROM "orders"
WHERE orders."id" = notification."orderId";

UPDATE "order_notifications"
SET "status" = 'FAILED_RETRYABLE'
WHERE "status" = 'FAILED';

ALTER TABLE "order_notifications"
  DROP CONSTRAINT "order_notifications_sent_state";

ALTER TABLE "order_notifications"
  ADD CONSTRAINT "order_notifications_attempts_bounded" CHECK ("attempts" >= 0 AND "attempts" <= 5),
  ADD CONSTRAINT "order_notifications_template_versions_positive" CHECK ("templateVersion" > 0 AND "payloadVersion" > 0),
  ADD CONSTRAINT "order_notifications_payload_object" CHECK (jsonb_typeof("payload") = 'object'),
  ADD CONSTRAINT "order_notifications_resource_pair" CHECK (
    ("resourceId" IS NULL AND "resourceReference" IS NULL) OR
    ("resourceId" IS NOT NULL AND "resourceReference" IS NOT NULL)
  ),
  ADD CONSTRAINT "order_notifications_lease_state" CHECK (
    ("status" = 'PROCESSING' AND "processingStartedAt" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR
    ("status" <> 'PROCESSING' AND "processingStartedAt" IS NULL AND "leaseExpiresAt" IS NULL)
  ),
  ADD CONSTRAINT "order_notifications_delivery_state" CHECK (
    ("status" IN ('DELIVERED', 'COMPLAINED') AND "sentAt" IS NOT NULL AND "deliveredAt" IS NOT NULL) OR
    ("status" NOT IN ('DELIVERED', 'COMPLAINED') AND "deliveredAt" IS NULL)
  ),
  ADD CONSTRAINT "order_notifications_sent_state_v073" CHECK (
    ("status" IN ('SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED') AND "sentAt" IS NOT NULL) OR
    ("status" IN ('PENDING', 'PROCESSING', 'FAILED_RETRYABLE', 'CANCELED') AND "sentAt" IS NULL) OR
    ("status" IN ('FAILED', 'FAILED_FINAL', 'SUPPRESSED'))
  ),
  ADD CONSTRAINT "order_notifications_failure_state" CHECK (
    ("status" IN ('FAILED_RETRYABLE', 'FAILED_FINAL', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED') AND "failedAt" IS NOT NULL) OR
    ("status" NOT IN ('FAILED_RETRYABLE', 'FAILED_FINAL', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED') AND "failedAt" IS NULL)
  );

CREATE UNIQUE INDEX "order_notifications_providerMessageId_key"
  ON "order_notifications"("providerMessageId")
  WHERE "providerMessageId" IS NOT NULL;
CREATE INDEX "order_notifications_status_availableAt_idx"
  ON "order_notifications"("status", "availableAt");
CREATE INDEX "order_notifications_status_leaseExpiresAt_idx"
  ON "order_notifications"("status", "leaseExpiresAt");
CREATE INDEX "order_notifications_resourceType_resourceId_idx"
  ON "order_notifications"("resourceType", "resourceId");

CREATE TABLE "notification_events" (
  "id" UUID NOT NULL,
  "notificationId" UUID,
  "providerEventId" VARCHAR(255),
  "providerMessageId" VARCHAR(255),
  "providerEventType" VARCHAR(80),
  "outcome" "NotificationEventOutcome" NOT NULL,
  "code" VARCHAR(80),
  "actorUserId" UUID,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_events_provider_fields" CHECK (
    ("providerEventId" IS NULL AND "providerEventType" IS NULL) OR
    ("providerEventId" IS NOT NULL AND "providerEventType" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "notification_events_providerEventId_key"
  ON "notification_events"("providerEventId")
  WHERE "providerEventId" IS NOT NULL;
CREATE INDEX "notification_events_notificationId_createdAt_idx"
  ON "notification_events"("notificationId", "createdAt");
CREATE INDEX "notification_events_providerMessageId_occurredAt_idx"
  ON "notification_events"("providerMessageId", "occurredAt");
CREATE INDEX "notification_events_outcome_createdAt_idx"
  ON "notification_events"("outcome", "createdAt");

ALTER TABLE "notification_events"
  ADD CONSTRAINT "notification_events_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "order_notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "notification_events_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "notification_suppressions" (
  "id" UUID NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "recipient" VARCHAR(320) NOT NULL,
  "recipientHashSha256" CHAR(64) NOT NULL,
  "reason" "NotificationSuppressionReason" NOT NULL,
  "provider" "NotificationProvider",
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sourceEventId" VARCHAR(255),
  "lastEventAt" TIMESTAMPTZ(3) NOT NULL,
  "removedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "notification_suppressions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_suppressions_recipient_normalized" CHECK ("recipient" = lower(btrim("recipient"))),
  CONSTRAINT "notification_suppressions_hash_format" CHECK ("recipientHashSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "notification_suppressions_active_state" CHECK (
    ("active" = true AND "removedAt" IS NULL) OR
    ("active" = false AND "removedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "notification_suppressions_channel_recipient_key"
  ON "notification_suppressions"("channel", "recipient");
CREATE UNIQUE INDEX "notification_suppressions_channel_recipientHashSha256_key"
  ON "notification_suppressions"("channel", "recipientHashSha256");
CREATE INDEX "notification_suppressions_active_reason_updatedAt_idx"
  ON "notification_suppressions"("active", "reason", "updatedAt");
