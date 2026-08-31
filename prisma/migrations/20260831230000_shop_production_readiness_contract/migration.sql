-- V1.1.0 Phase 5E is additive. Historical logistics, billing and payment rows remain readable.

ALTER TYPE "OrderNotificationKind" ADD VALUE IF NOT EXISTS 'OWNER_SHOP_SAV_EVIDENCE_ADDED';
ALTER TYPE "OrderNotificationKind" ADD VALUE IF NOT EXISTS 'OWNER_SHOP_CANCELLATION_REQUESTED';
ALTER TYPE "OrderNotificationKind" ADD VALUE IF NOT EXISTS 'CUSTOMER_SHOP_CANCELLATION_APPROVED';
ALTER TYPE "OrderNotificationKind" ADD VALUE IF NOT EXISTS 'CUSTOMER_SHOP_CANCELLATION_REJECTED';
ALTER TYPE "OrderNotificationKind" ADD VALUE IF NOT EXISTS 'OWNER_SHOP_ADDRESS_CORRECTION_REQUESTED';
ALTER TYPE "OrderNotificationKind" ADD VALUE IF NOT EXISTS 'CUSTOMER_SHOP_ADDRESS_CORRECTION_APPROVED';
ALTER TYPE "OrderNotificationKind" ADD VALUE IF NOT EXISTS 'CUSTOMER_SHOP_ADDRESS_CORRECTION_REJECTED';
ALTER TYPE "ShippingRateVersionStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';
ALTER TYPE "ShippingRateScope" ADD VALUE IF NOT EXISTS 'COMMERCIAL_CANDIDATE';
ALTER TYPE "ShippingService" ADD VALUE IF NOT EXISTS 'COLISSIMO_HOME_FRANCE';
ALTER TYPE "ShopReturnAuditAction" ADD VALUE IF NOT EXISTS 'EVIDENCE_ADDED';
ALTER TYPE "ShopReturnAuditAction" ADD VALUE IF NOT EXISTS 'EVIDENCE_PURGED';

CREATE TYPE "ShippingBillableWeightPolicy" AS ENUM ('PACKAGED', 'PRODUCTS_ONLY');
CREATE TYPE "PackagingProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "ShopReturnEvidenceStatus" AS ENUM ('ACTIVE', 'PURGED');
CREATE TYPE "ShopCustomerRequestType" AS ENUM ('PAID_ORDER_CANCELLATION', 'SHIPPING_ADDRESS_CORRECTION');
CREATE TYPE "ShopCustomerRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED');
CREATE TYPE "ShopReadinessAlertKind" AS ENUM ('SAV_FIRST_ANALYSIS_OVERDUE', 'PAYMENT_REVIEW_REQUIRED', 'REFUND_REVIEW_REQUIRED', 'SHIPPING_REVIEW_REQUIRED');
CREATE TYPE "ShopReadinessAlertStatus" AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE "ShopMaintenanceRunOutcome" AS ENUM ('COMPLETED', 'SKIPPED_OVERLAP', 'FAILED');

CREATE TABLE "packaging_profiles" (
  "id" UUID NOT NULL,
  "version" VARCHAR(64) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "status" "PackagingProfileStatus" NOT NULL DEFAULT 'DRAFT',
  "physicalWeightGrams" INTEGER NOT NULL,
  "maximumItemQuantity" INTEGER NOT NULL,
  "customerBillableWeightIncluded" BOOLEAN NOT NULL DEFAULT false,
  "activatedAt" TIMESTAMPTZ(3),
  "archivedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "packaging_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "packaging_profiles_weight_check" CHECK ("physicalWeightGrams" >= 0 AND "physicalWeightGrams" <= 30000),
  CONSTRAINT "packaging_profiles_capacity_check" CHECK ("maximumItemQuantity" > 0 AND "maximumItemQuantity" <= 1000),
  CONSTRAINT "packaging_profiles_free_packaging_check" CHECK ("customerBillableWeightIncluded" = false)
);

CREATE UNIQUE INDEX "packaging_profiles_version_key" ON "packaging_profiles"("version");
CREATE INDEX "packaging_profiles_status_created_idx" ON "packaging_profiles"("status", "createdAt");

ALTER TABLE "shipping_rate_versions"
  ADD COLUMN "billableWeightPolicy" "ShippingBillableWeightPolicy" NOT NULL DEFAULT 'PACKAGED',
  ADD COLUMN "packagingProfileId" UUID,
  ADD COLUMN "sourceLabel" VARCHAR(240),
  ADD COLUMN "validFrom" DATE,
  ADD COLUMN "archivedAt" TIMESTAMPTZ(3);

ALTER TABLE "shipping_rate_versions" DROP CONSTRAINT "shipping_rate_versions_status_timestamps";
ALTER TABLE "shipping_rate_versions" ADD CONSTRAINT "shipping_rate_versions_status_timestamps" CHECK (
  (
    "status" = 'DRAFT'
    AND "activatedAt" IS NULL
    AND "retiredAt" IS NULL
    AND "archivedAt" IS NULL
  )
  OR (
    "status" = 'ACTIVE'
    AND "activatedAt" IS NOT NULL
    AND "retiredAt" IS NULL
    AND "archivedAt" IS NULL
  )
  OR (
    "status" = 'RETIRED'
    AND "activatedAt" IS NOT NULL
    AND "retiredAt" IS NOT NULL
    AND "retiredAt" >= "activatedAt"
    AND "archivedAt" IS NULL
  )
  OR (
    "status" = 'ARCHIVED'
    AND "activatedAt" IS NOT NULL
    AND "retiredAt" IS NULL
    AND "archivedAt" IS NOT NULL
    AND "archivedAt" >= "activatedAt"
  )
);

CREATE INDEX "shipping_rate_versions_packaging_idx" ON "shipping_rate_versions"("packagingProfileId");
ALTER TABLE "shipping_rate_versions" ADD CONSTRAINT "shipping_rate_versions_packaging_fkey"
  FOREIGN KEY ("packagingProfileId") REFERENCES "packaging_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shop_orders"
  ADD COLUMN "shippingPhysicalGrams" INTEGER,
  ADD COLUMN "shippingTierMaxGrams" INTEGER,
  ADD COLUMN "packagingProfileId" UUID,
  ADD COLUMN "packagingProfileVersion" VARCHAR(64),
  ADD COLUMN "shippingWeightPolicy" "ShippingBillableWeightPolicy";

ALTER TABLE "shop_orders" DROP CONSTRAINT "shop_orders_shipping_quote_snapshot";
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_shipping_quote_snapshot" CHECK (
  (
    "shippingRateVersionId" IS NULL
    AND "shippingQuoteVersion" IS NULL
    AND "shippingMethod" IS NULL
    AND "shippingWeightGrams" IS NULL
    AND "shippingPackagingGrams" IS NULL
    AND "shippingBillableGrams" IS NULL
    AND "shippingPhysicalGrams" IS NULL
    AND "shippingTierMaxGrams" IS NULL
    AND "packagingProfileId" IS NULL
    AND "packagingProfileVersion" IS NULL
    AND "shippingWeightPolicy" IS NULL
  )
  OR (
    "shippingRequired" = true
    AND "shippingRateVersionId" IS NOT NULL
    AND "shippingQuoteVersion" IS NOT NULL
    AND btrim("shippingQuoteVersion") <> ''
    AND "shippingMethod" IS NOT NULL
    AND btrim("shippingMethod") <> ''
    AND "shippingWeightGrams" IS NOT NULL
    AND "shippingWeightGrams" > 0
    AND "shippingWeightGrams" <= 1000000
    AND "shippingPackagingGrams" IS NOT NULL
    AND "shippingPackagingGrams" >= 0
    AND "shippingPackagingGrams" <= 1000000
    AND "shippingBillableGrams" IS NOT NULL
    AND "shippingBillableGrams" > 0
    AND "shippingBillableGrams" <= 1000000
    AND "shippingCents" > 0
    AND (
      (
        "shippingWeightPolicy" IS NULL
        AND "shippingPhysicalGrams" IS NULL
        AND "shippingTierMaxGrams" IS NULL
        AND "packagingProfileId" IS NULL
        AND "packagingProfileVersion" IS NULL
        AND "shippingBillableGrams" >= "shippingWeightGrams" + "shippingPackagingGrams"
      )
      OR (
        "shippingWeightPolicy" = 'PACKAGED'
        AND "shippingPhysicalGrams" = "shippingWeightGrams" + "shippingPackagingGrams"
        AND "shippingBillableGrams" >= "shippingPhysicalGrams"
        AND "shippingTierMaxGrams" >= "shippingBillableGrams"
      )
      OR (
        "shippingWeightPolicy" = 'PRODUCTS_ONLY'
        AND "shippingPhysicalGrams" = "shippingWeightGrams" + "shippingPackagingGrams"
        AND "shippingBillableGrams" = "shippingWeightGrams"
        AND "shippingTierMaxGrams" >= "shippingBillableGrams"
        AND "packagingProfileId" IS NOT NULL
        AND "packagingProfileVersion" IS NOT NULL
        AND btrim("packagingProfileVersion") <> ''
      )
    )
  )
);

ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_shipping_weights_check" CHECK (
  ("shippingPhysicalGrams" IS NULL OR "shippingPhysicalGrams" > 0)
  AND ("shippingTierMaxGrams" IS NULL OR "shippingTierMaxGrams" > 0)
);

-- A paid ShopOrder may be cancelled only after a successful provider refund.
-- Preserve paidAt as immutable financial evidence instead of erasing it to
-- satisfy the historical pre-refund constraint. Unpaid cancellations remain
-- valid as well.
ALTER TABLE "shop_orders" DROP CONSTRAINT "shop_orders_payment_timestamp";
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_payment_timestamp" CHECK (
  (
    "paymentStatus" = 'AWAITING_PAYMENT'
    AND "paidAt" IS NULL
  )
  OR (
    "paymentStatus" = 'PAID'
    AND "paidAt" IS NOT NULL
  )
  OR "paymentStatus" = 'CANCELLED'
);

CREATE INDEX "shop_orders_packaging_idx" ON "shop_orders"("packagingProfileId");
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_packaging_fkey"
  FOREIGN KEY ("packagingProfileId") REFERENCES "packaging_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "shop_order_customer_requests" (
  "id" UUID NOT NULL,
  "requestNumber" VARCHAR(40) NOT NULL,
  "shopOrderId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "type" "ShopCustomerRequestType" NOT NULL,
  "status" "ShopCustomerRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "reason" VARCHAR(1000) NOT NULL,
  "requestedSnapshot" JSONB NOT NULL DEFAULT '{}',
  "previousAddressHash" CHAR(64),
  "decidedByUserId" UUID,
  "decisionComment" VARCHAR(1000),
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "shop_order_customer_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_customer_request_reason_check" CHECK (length(btrim("reason")) > 0)
);

CREATE UNIQUE INDEX "shop_order_customer_requests_number_key" ON "shop_order_customer_requests"("requestNumber");
CREATE INDEX "shop_customer_requests_order_idx" ON "shop_order_customer_requests"("shopOrderId", "requestedAt");
CREATE INDEX "shop_customer_requests_user_idx" ON "shop_order_customer_requests"("userId", "requestedAt");
CREATE INDEX "shop_customer_requests_status_idx" ON "shop_order_customer_requests"("type", "status", "requestedAt");
CREATE UNIQUE INDEX "shop_order_customer_requests_one_open_kind_idx"
  ON "shop_order_customer_requests"("shopOrderId", "type")
  WHERE "status" IN ('REQUESTED', 'APPROVED');
ALTER TABLE "shop_order_customer_requests" ADD CONSTRAINT "shop_customer_requests_order_owner_fkey"
  FOREIGN KEY ("shopOrderId", "userId") REFERENCES "shop_orders"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refund_attempts" ADD COLUMN "shopCustomerRequestId" UUID;
CREATE UNIQUE INDEX "refund_attempts_shopCustomerRequestId_key" ON "refund_attempts"("shopCustomerRequestId");
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_shop_customer_request_fkey"
  FOREIGN KEY ("shopCustomerRequestId") REFERENCES "shop_order_customer_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_stock_adjustments" ADD COLUMN "shopCustomerRequestId" UUID;
CREATE INDEX "product_stock_adjustments_customer_req_idx" ON "product_stock_adjustments"("shopCustomerRequestId");
ALTER TABLE "product_stock_adjustments" ADD CONSTRAINT "product_stock_adjustments_customer_req_fkey"
  FOREIGN KEY ("shopCustomerRequestId") REFERENCES "shop_order_customer_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "shop_return_evidence" (
  "id" UUID NOT NULL,
  "shopReturnRequestId" UUID NOT NULL,
  "uploaderUserId" UUID NOT NULL,
  "originalName" VARCHAR(240) NOT NULL,
  "storageKey" VARCHAR(500) NOT NULL,
  "mimeType" VARCHAR(80) NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "status" "ShopReturnEvidenceStatus" NOT NULL DEFAULT 'ACTIVE',
  "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "purgeDueAt" TIMESTAMPTZ(3),
  "purgedAt" TIMESTAMPTZ(3),
  CONSTRAINT "shop_return_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_return_evidence_size_check" CHECK ("byteSize" > 0 AND "byteSize" <= 5242880),
  CONSTRAINT "shop_return_evidence_mime_check" CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp'))
);

CREATE UNIQUE INDEX "shop_return_evidence_storage_key" ON "shop_return_evidence"("storageKey");
CREATE UNIQUE INDEX "shop_return_evidence_request_sha" ON "shop_return_evidence"("shopReturnRequestId", "sha256");
CREATE INDEX "shop_return_evidence_request_status_idx" ON "shop_return_evidence"("shopReturnRequestId", "status");
CREATE INDEX "shop_return_evidence_purge_idx" ON "shop_return_evidence"("status", "purgeDueAt");
ALTER TABLE "shop_return_evidence" ADD CONSTRAINT "shop_return_evidence_request_fkey"
  FOREIGN KEY ("shopReturnRequestId") REFERENCES "shop_return_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "shop_readiness_alerts" (
  "id" UUID NOT NULL,
  "kind" "ShopReadinessAlertKind" NOT NULL,
  "status" "ShopReadinessAlertStatus" NOT NULL DEFAULT 'OPEN',
  "entityType" VARCHAR(80) NOT NULL,
  "entityId" VARCHAR(160) NOT NULL,
  "summary" VARCHAR(500) NOT NULL,
  "firstDetectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDetectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3),
  CONSTRAINT "shop_readiness_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shop_readiness_alert_entity_key" ON "shop_readiness_alerts"("kind", "entityType", "entityId");
CREATE INDEX "shop_readiness_alert_status_idx" ON "shop_readiness_alerts"("status", "kind", "firstDetectedAt");

CREATE TABLE "shop_maintenance_runs" (
  "id" UUID NOT NULL,
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "outcome" "ShopMaintenanceRunOutcome" NOT NULL,
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "errorCode" VARCHAR(160),
  CONSTRAINT "shop_maintenance_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shop_maintenance_runs_key" ON "shop_maintenance_runs"("idempotencyKey");
CREATE INDEX "shop_maintenance_runs_started_idx" ON "shop_maintenance_runs"("startedAt");
