-- Phase 5D adds a provider-neutral shipment attempt ledger. It does not
-- purchase postage, contact a carrier, or change the physical shipment state.
CREATE TYPE "ShopShippingProvider" AS ENUM ('FAKE_LOCAL');
CREATE TYPE "ShopShippingProviderScenario" AS ENUM ('SUCCEEDED', 'PENDING', 'FAILED', 'AMBIGUOUS');
CREATE TYPE "ShopShippingProviderAttemptStatus" AS ENUM ('REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED', 'REQUIRES_REVIEW');

ALTER TYPE "ShopOrderLifecycleEventType" ADD VALUE 'SHIPPING_PROVIDER_REQUESTED';
ALTER TYPE "ShopOrderLifecycleEventType" ADD VALUE 'SHIPPING_PROVIDER_RECONCILED';

CREATE TABLE "shop_shipping_provider_attempts" (
  "id" UUID NOT NULL,
  "shopOrderId" UUID NOT NULL,
  "provider" "ShopShippingProvider" NOT NULL,
  "scenario" "ShopShippingProviderScenario" NOT NULL,
  "status" "ShopShippingProviderAttemptStatus" NOT NULL DEFAULT 'REQUESTED',
  "attemptNumber" INTEGER NOT NULL,
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "providerShipmentId" VARCHAR(160),
  "trackingCarrier" VARCHAR(120),
  "trackingNumber" VARCHAR(160),
  "trackingUrl" VARCHAR(1000),
  "errorCode" VARCHAR(120),
  "reconciliationCount" INTEGER NOT NULL DEFAULT 0,
  "lastReconciledAt" TIMESTAMPTZ(3),
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3),
  "createdByUserId" UUID NOT NULL,
  "lastReconciledByUserId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "shop_shipping_provider_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_shipping_provider_attempts_attempt_number_positive" CHECK ("attemptNumber" > 0),
  CONSTRAINT "shop_shipping_provider_attempts_reconciliation_count_nonnegative" CHECK ("reconciliationCount" >= 0),
  CONSTRAINT "shop_shipping_provider_attempts_tracking_https" CHECK (
    "trackingUrl" IS NULL
    OR (btrim("trackingUrl") = "trackingUrl" AND "trackingUrl" ~ '^https://[^[:space:]]+$')
  ),
  CONSTRAINT "shop_shipping_provider_attempts_state_details" CHECK (
    (
      "status" IN ('REQUESTED', 'PENDING')
      AND "trackingCarrier" IS NULL
      AND "trackingNumber" IS NULL
      AND "trackingUrl" IS NULL
      AND "resolvedAt" IS NULL
    )
    OR (
      "status" = 'SUCCEEDED'
      AND "providerShipmentId" IS NOT NULL
      AND "trackingCarrier" IS NOT NULL
      AND btrim("trackingCarrier") <> ''
      AND "trackingNumber" IS NOT NULL
      AND btrim("trackingNumber") <> ''
      AND "trackingUrl" IS NOT NULL
      AND "errorCode" IS NULL
      AND "resolvedAt" IS NOT NULL
    )
    OR (
      "status" = 'FAILED'
      AND "trackingCarrier" IS NULL
      AND "trackingNumber" IS NULL
      AND "trackingUrl" IS NULL
      AND "errorCode" IS NOT NULL
      AND "resolvedAt" IS NOT NULL
    )
    OR (
      "status" = 'REQUIRES_REVIEW'
      AND "errorCode" IS NOT NULL
      AND "resolvedAt" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "shop_shipping_provider_attempts_idempotencyKey_key"
  ON "shop_shipping_provider_attempts"("idempotencyKey");
CREATE UNIQUE INDEX "shop_shipping_provider_attempts_providerShipmentId_key"
  ON "shop_shipping_provider_attempts"("providerShipmentId");
CREATE UNIQUE INDEX "shop_shipping_provider_attempts_shopOrderId_attemptNumber_key"
  ON "shop_shipping_provider_attempts"("shopOrderId", "attemptNumber");
CREATE INDEX "shop_shipping_provider_attempts_shopOrderId_createdAt_idx"
  ON "shop_shipping_provider_attempts"("shopOrderId", "createdAt");
CREATE INDEX "shop_shipping_provider_attempts_status_requestedAt_idx"
  ON "shop_shipping_provider_attempts"("status", "requestedAt");
CREATE INDEX "shop_shipping_provider_attempts_createdByUserId_idx"
  ON "shop_shipping_provider_attempts"("createdByUserId");
CREATE INDEX "shop_shipping_provider_attempts_lastReconciledByUserId_idx"
  ON "shop_shipping_provider_attempts"("lastReconciledByUserId");

ALTER TABLE "shop_shipping_provider_attempts"
  ADD CONSTRAINT "shop_shipping_provider_attempts_shopOrderId_fkey"
  FOREIGN KEY ("shopOrderId") REFERENCES "shop_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shop_shipping_provider_attempts_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shop_shipping_provider_attempts_lastReconciledByUserId_fkey"
  FOREIGN KEY ("lastReconciledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Provider events are non-financial and require an authenticated Admin actor.
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
        'SHIPPING_PROVIDER_REQUESTED',
        'SHIPPING_PROVIDER_RECONCILED',
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
      'SHIPPING_PROVIDER_REQUESTED',
      'SHIPPING_PROVIDER_RECONCILED',
      'ORDER_SHIPPED'
    )
    OR "actorUserId" IS NOT NULL
  );
