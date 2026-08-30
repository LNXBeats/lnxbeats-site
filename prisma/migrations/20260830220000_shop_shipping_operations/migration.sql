-- Phase 5C extends the existing single-shipment ShopOrder snapshot without
-- rewriting historical orders or introducing a carrier integration.
ALTER TYPE "ShopFulfillmentStatus" ADD VALUE 'READY_TO_SHIP';

ALTER TYPE "ShopOrderLifecycleEventType" ADD VALUE 'SHIPMENT_READY';
ALTER TYPE "ShopOrderLifecycleEventType" ADD VALUE 'TRACKING_RECORDED';

CREATE TYPE "ShopTrackingSource" AS ENUM ('MANUAL', 'PROVIDER');

ALTER TABLE "shop_orders"
  ADD COLUMN "readyToShipAt" TIMESTAMPTZ(3),
  ADD COLUMN "trackingSource" "ShopTrackingSource",
  ADD COLUMN "trackingRecordedAt" TIMESTAMPTZ(3),
  ADD COLUMN "trackingRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "shop_orders"
  ADD CONSTRAINT "shop_orders_tracking_revision_nonnegative"
  CHECK ("trackingRevision" >= 0);

-- Replace the Phase 3 fulfillment invariant so that historical rows remain
-- valid while new Phase 5C transitions are represented atomically.
ALTER TABLE "shop_orders"
  DROP CONSTRAINT "shop_orders_fulfillment_details",
  ADD CONSTRAINT "shop_orders_fulfillment_details" CHECK (
    (
      "fulfillmentStatus"::text = 'PENDING'
      AND "preparingAt" IS NULL
      AND "readyToShipAt" IS NULL
      AND "shippedAt" IS NULL
      AND "shippingCarrier" IS NULL
      AND "trackingNumber" IS NULL
      AND "trackingUrl" IS NULL
      AND "trackingSource" IS NULL
      AND "trackingRecordedAt" IS NULL
      AND "trackingRevision" = 0
    )
    OR (
      "fulfillmentStatus"::text = 'PREPARING'
      AND "preparingAt" IS NOT NULL
      AND "preparingAt" >= "paidAt"
      AND "readyToShipAt" IS NULL
      AND "shippedAt" IS NULL
      AND "shippingCarrier" IS NULL
      AND "trackingNumber" IS NULL
      AND "trackingUrl" IS NULL
      AND "trackingSource" IS NULL
      AND "trackingRecordedAt" IS NULL
      AND "trackingRevision" = 0
    )
    OR (
      "fulfillmentStatus"::text = 'READY_TO_SHIP'
      AND "preparingAt" IS NOT NULL
      AND "readyToShipAt" IS NOT NULL
      AND "readyToShipAt" >= "preparingAt"
      AND "shippedAt" IS NULL
      AND (
        (
          "trackingRevision" = 0
          AND "shippingCarrier" IS NULL
          AND "trackingNumber" IS NULL
          AND "trackingUrl" IS NULL
          AND "trackingSource" IS NULL
          AND "trackingRecordedAt" IS NULL
        )
        OR (
          "trackingRevision" > 0
          AND "shippingCarrier" IS NOT NULL
          AND btrim("shippingCarrier") <> ''
          AND "trackingNumber" IS NOT NULL
          AND btrim("trackingNumber") <> ''
          AND "trackingSource" IS NOT NULL
          AND "trackingRecordedAt" IS NOT NULL
          AND "trackingRecordedAt" >= "readyToShipAt"
          AND (
            "trackingUrl" IS NULL
            OR (btrim("trackingUrl") = "trackingUrl" AND "trackingUrl" ~ '^https://[^[:space:]]+$')
          )
        )
      )
    )
    OR (
      "fulfillmentStatus"::text = 'SHIPPED'
      AND "preparingAt" IS NOT NULL
      AND "shippedAt" IS NOT NULL
      AND "shippedAt" >= COALESCE("readyToShipAt", "preparingAt")
      AND (
        -- Compatibility for ShopOrders shipped before Phase 5C.
        (
          "trackingRevision" = 0
          AND "trackingSource" IS NULL
          AND "trackingRecordedAt" IS NULL
          AND ("shippingCarrier" IS NULL OR btrim("shippingCarrier") <> '')
          AND ("trackingNumber" IS NULL OR btrim("trackingNumber") <> '')
        )
        OR (
          "trackingRevision" > 0
          AND "readyToShipAt" IS NOT NULL
          AND "shippingCarrier" IS NOT NULL
          AND btrim("shippingCarrier") <> ''
          AND "trackingNumber" IS NOT NULL
          AND btrim("trackingNumber") <> ''
          AND "trackingSource" IS NOT NULL
          AND "trackingRecordedAt" IS NOT NULL
          AND "trackingRecordedAt" >= "readyToShipAt"
        )
      )
      AND (
        "trackingUrl" IS NULL
        OR (btrim("trackingUrl") = "trackingUrl" AND "trackingUrl" ~ '^https://[^[:space:]]+$')
      )
    )
    OR (
      "fulfillmentStatus"::text = 'CANCELLED'
      AND "preparingAt" IS NULL
      AND "readyToShipAt" IS NULL
      AND "shippedAt" IS NULL
      AND "shippingCarrier" IS NULL
      AND "trackingNumber" IS NULL
      AND "trackingUrl" IS NULL
      AND "trackingSource" IS NULL
      AND "trackingRecordedAt" IS NULL
      AND "trackingRevision" = 0
    )
  );

-- Extend existing lifecycle constraints without rewriting historical events.
ALTER TABLE "shop_order_lifecycle_events"
  DROP CONSTRAINT "shop_order_lifecycle_events_payment_scope",
  DROP CONSTRAINT "shop_order_lifecycle_events_admin_actor",
  ADD CONSTRAINT "shop_order_lifecycle_events_payment_scope" CHECK (
    (
      "type"::text IN (
        'SHOP_PAYMENT_PROCESSING',
        'SHOP_PAYMENT_CONFIRMED',
        'SHOP_PAYMENT_FAILED',
        'SHOP_PAYMENT_REQUIRES_REVIEW'
      )
      AND "paymentId" IS NOT NULL
    )
    OR (
      "type"::text IN (
        'SHOP_TERMS_ACCEPTED',
        'PREPARATION_STARTED',
        'SHIPMENT_READY',
        'TRACKING_RECORDED',
        'ORDER_SHIPPED'
      )
      AND "paymentId" IS NULL
    )
  ),
  ADD CONSTRAINT "shop_order_lifecycle_events_admin_actor" CHECK (
    "type"::text NOT IN (
      'PREPARATION_STARTED',
      'SHIPMENT_READY',
      'TRACKING_RECORDED',
      'ORDER_SHIPPED'
    )
    OR "actorUserId" IS NOT NULL
  );
