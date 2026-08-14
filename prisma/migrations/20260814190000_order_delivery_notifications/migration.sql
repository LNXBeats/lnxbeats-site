-- Additive delivery notification outbox. No existing Order or media row is rewritten.
CREATE TYPE "OrderNotificationKind" AS ENUM ('OWNER_NEW_ORDER', 'CUSTOMER_DELIVERY_READY');
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "order_notifications" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "kind" "OrderNotificationKind" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" VARCHAR(320),
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(80),
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_notifications_attempts_nonnegative" CHECK ("attempts" >= 0),
    CONSTRAINT "order_notifications_sent_state" CHECK (
      ("status" = 'SENT' AND "sentAt" IS NOT NULL) OR
      ("status" <> 'SENT' AND "sentAt" IS NULL)
    )
);

CREATE UNIQUE INDEX "order_notifications_idempotencyKey_key" ON "order_notifications"("idempotencyKey");
CREATE INDEX "order_notifications_status_updatedAt_idx" ON "order_notifications"("status", "updatedAt");
CREATE INDEX "order_notifications_orderId_kind_channel_idx" ON "order_notifications"("orderId", "kind", "channel");

ALTER TABLE "order_notifications"
  ADD CONSTRAINT "order_notifications_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One unambiguous active master per Order. Replacement swaps this relation atomically.
CREATE UNIQUE INDEX "order_assets_one_delivery_per_order"
  ON "order_assets"("orderId")
  WHERE "role" = 'DELIVERY';
