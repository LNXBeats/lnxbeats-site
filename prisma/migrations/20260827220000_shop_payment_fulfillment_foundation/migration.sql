-- V1.1.0 Phase 3: additive Shop payment, legal acceptance and fulfillment
-- foundations. Existing musical Order, Payment and notification rows are kept
-- unchanged; nullable parent columns are guarded by exact-one constraints.

ALTER TYPE "OrderNotificationKind" ADD VALUE 'OWNER_SHOP_ORDER_PAID';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_SHOP_PAYMENT_CONFIRMED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_SHOP_PREPARING';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_SHOP_SHIPPED';

CREATE TYPE "ShopOrderLifecycleEventType" AS ENUM (
  'SHOP_TERMS_ACCEPTED',
  'SHOP_PAYMENT_PROCESSING',
  'SHOP_PAYMENT_CONFIRMED',
  'SHOP_PAYMENT_FAILED',
  'SHOP_PAYMENT_REQUIRES_REVIEW',
  'PREPARATION_STARTED',
  'ORDER_SHIPPED'
);

ALTER TABLE "payments"
  ALTER COLUMN "orderId" DROP NOT NULL,
  ADD COLUMN "shopOrderId" UUID;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_parent_xor" CHECK (
    (("orderId" IS NOT NULL)::INTEGER + ("shopOrderId" IS NOT NULL)::INTEGER) = 1
  ),
  ADD CONSTRAINT "payments_shopOrderId_fkey"
    FOREIGN KEY ("shopOrderId") REFERENCES "shop_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "payments_id_shopOrderId_key"
  ON "payments"("id", "shopOrderId");
CREATE INDEX "payments_shopOrderId_createdAt_idx"
  ON "payments"("shopOrderId", "createdAt");
CREATE UNIQUE INDEX "payments_one_succeeded_per_shop_order_idx"
  ON "payments"("shopOrderId")
  WHERE "shopOrderId" IS NOT NULL
    AND "status" IN ('SUCCEEDED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED');
CREATE UNIQUE INDEX "payments_one_active_per_shop_order_provider_idx"
  ON "payments"("shopOrderId", "provider")
  WHERE "shopOrderId" IS NOT NULL
    AND (
      "status" IN ('CREATED', 'PENDING', 'REQUIRES_REVIEW')
      OR ("status" = 'FAILED' AND "failureCode" = 'STRIPE_PAYMENT_ATTEMPT_FAILED')
    );

ALTER TABLE "order_notifications"
  ALTER COLUMN "orderId" DROP NOT NULL,
  ADD COLUMN "shopOrderId" UUID;

ALTER TABLE "order_notifications"
  ADD CONSTRAINT "order_notifications_parent_xor" CHECK (
    (("orderId" IS NOT NULL)::INTEGER + ("shopOrderId" IS NOT NULL)::INTEGER) = 1
  ),
  ADD CONSTRAINT "order_notifications_shop_resource_consistent" CHECK (
    "shopOrderId" IS NULL
    OR (
      "resourceType" = 'SHOP_ORDER'
      AND "resourceId" = "shopOrderId"
    )
  ),
  ADD CONSTRAINT "order_notifications_shopOrderId_fkey"
    FOREIGN KEY ("shopOrderId") REFERENCES "shop_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "order_notifications_shopOrderId_kind_channel_idx"
  ON "order_notifications"("shopOrderId", "kind", "channel");

ALTER TABLE "shop_orders"
  ADD COLUMN "termsVersion" VARCHAR(64),
  ADD COLUMN "termsHashSha256" CHAR(64),
  ADD COLUMN "termsAcceptedAt" TIMESTAMPTZ(3),
  ADD COLUMN "paymentReviewAt" TIMESTAMPTZ(3),
  ADD COLUMN "paymentReviewCode" VARCHAR(80),
  ADD COLUMN "preparingAt" TIMESTAMPTZ(3),
  ADD COLUMN "shippedAt" TIMESTAMPTZ(3),
  ADD COLUMN "shippingCarrier" VARCHAR(120),
  ADD COLUMN "trackingNumber" VARCHAR(160),
  ADD COLUMN "trackingUrl" VARCHAR(1000);

ALTER TABLE "shop_orders"
  ADD CONSTRAINT "shop_orders_terms_snapshot" CHECK (
    (
      "termsVersion" IS NULL
      AND "termsHashSha256" IS NULL
      AND "termsAcceptedAt" IS NULL
    )
    OR (
      "termsVersion" IS NOT NULL
      AND btrim("termsVersion") <> ''
      AND "termsHashSha256" IS NOT NULL
      AND "termsHashSha256" ~ '^[0-9a-f]{64}$'
      AND "termsAcceptedAt" IS NOT NULL
      AND "termsAcceptedAt" >= "createdAt"
    )
  ),
  ADD CONSTRAINT "shop_orders_payment_review_state" CHECK (
    (
      "paymentReviewAt" IS NULL
      AND "paymentReviewCode" IS NULL
    )
    OR (
      "paymentReviewAt" IS NOT NULL
      AND "paymentReviewAt" >= "createdAt"
      AND "paymentReviewCode" IS NOT NULL
      AND btrim("paymentReviewCode") <> ''
    )
  ),
  ADD CONSTRAINT "shop_orders_fulfillment_details" CHECK (
    (
      "fulfillmentStatus" = 'PENDING'
      AND "preparingAt" IS NULL
      AND "shippedAt" IS NULL
      AND "shippingCarrier" IS NULL
      AND "trackingNumber" IS NULL
      AND "trackingUrl" IS NULL
    )
    OR (
      "fulfillmentStatus" = 'PREPARING'
      AND "preparingAt" IS NOT NULL
      AND "preparingAt" >= "paidAt"
      AND "shippedAt" IS NULL
      AND "shippingCarrier" IS NULL
      AND "trackingNumber" IS NULL
      AND "trackingUrl" IS NULL
    )
    OR (
      "fulfillmentStatus" = 'SHIPPED'
      AND "preparingAt" IS NOT NULL
      AND "shippedAt" IS NOT NULL
      AND "shippedAt" >= "preparingAt"
      AND ("shippingCarrier" IS NULL OR btrim("shippingCarrier") <> '')
      AND ("trackingNumber" IS NULL OR btrim("trackingNumber") <> '')
      AND (
        "trackingUrl" IS NULL
        OR (btrim("trackingUrl") = "trackingUrl" AND "trackingUrl" ~ '^https://[^[:space:]]+$')
      )
    )
    OR (
      "fulfillmentStatus" = 'CANCELLED'
      AND "preparingAt" IS NULL
      AND "shippedAt" IS NULL
      AND "shippingCarrier" IS NULL
      AND "trackingNumber" IS NULL
      AND "trackingUrl" IS NULL
    )
  );

CREATE INDEX "shop_orders_payment_review_idx"
  ON "shop_orders"("paymentReviewAt", "createdAt")
  WHERE "paymentReviewAt" IS NOT NULL;
CREATE INDEX "shop_orders_fulfillment_queue_idx"
  ON "shop_orders"("fulfillmentStatus", "paidAt", "createdAt")
  WHERE "paymentStatus" = 'PAID';

CREATE TABLE "shop_order_lifecycle_events" (
  "id" UUID NOT NULL,
  "shopOrderId" UUID NOT NULL,
  "paymentId" UUID,
  "type" "ShopOrderLifecycleEventType" NOT NULL,
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "actorUserId" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shop_order_lifecycle_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_order_lifecycle_events_idempotency_nonempty" CHECK (
    btrim("idempotencyKey") <> ''
  ),
  CONSTRAINT "shop_order_lifecycle_events_metadata_object" CHECK (
    jsonb_typeof("metadata") = 'object'
  ),
  CONSTRAINT "shop_order_lifecycle_events_payment_scope" CHECK (
    (
      "type" IN (
        'SHOP_PAYMENT_PROCESSING',
        'SHOP_PAYMENT_CONFIRMED',
        'SHOP_PAYMENT_FAILED',
        'SHOP_PAYMENT_REQUIRES_REVIEW'
      )
      AND "paymentId" IS NOT NULL
    )
    OR (
      "type" IN ('SHOP_TERMS_ACCEPTED', 'PREPARATION_STARTED', 'ORDER_SHIPPED')
      AND "paymentId" IS NULL
    )
  ),
  CONSTRAINT "shop_order_lifecycle_events_admin_actor" CHECK (
    "type" NOT IN ('PREPARATION_STARTED', 'ORDER_SHIPPED')
    OR "actorUserId" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "shop_order_lifecycle_events_idempotencyKey_key"
  ON "shop_order_lifecycle_events"("idempotencyKey");
CREATE INDEX "shop_order_lifecycle_events_shopOrderId_occurredAt_idx"
  ON "shop_order_lifecycle_events"("shopOrderId", "occurredAt");
CREATE INDEX "shop_order_lifecycle_events_paymentId_occurredAt_idx"
  ON "shop_order_lifecycle_events"("paymentId", "occurredAt");
CREATE INDEX "shop_order_lifecycle_events_actorUserId_idx"
  ON "shop_order_lifecycle_events"("actorUserId");

ALTER TABLE "shop_order_lifecycle_events"
  ADD CONSTRAINT "shop_order_lifecycle_events_shopOrderId_fkey"
    FOREIGN KEY ("shopOrderId") REFERENCES "shop_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shop_order_lifecycle_events_payment_parent_fkey"
    FOREIGN KEY ("paymentId", "shopOrderId")
    REFERENCES "payments"("id", "shopOrderId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shop_order_lifecycle_events_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
