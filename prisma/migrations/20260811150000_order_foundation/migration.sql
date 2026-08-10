-- V0.6 extends the existing order foundation without rewriting prior migrations.
CREATE TYPE "OrderUsage" AS ENUM ('PERSONAL', 'COMMERCIAL_EXTENDED');
CREATE TYPE "OrderEventVisibility" AS ENUM ('CLIENT', 'INTERNAL');

ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_PAYMENT';
ALTER TYPE "OrderStatus" ADD VALUE 'PAYMENT_CONFIRMED';
ALTER TYPE "OrderStatus" ADD VALUE 'RECEIVED';
ALTER TYPE "OrderStatus" ADD VALUE 'FIRST_VERSION_READY';
ALTER TYPE "OrderStatus" ADD VALUE 'REVISION_REQUESTED';
ALTER TYPE "OrderStatus" ADD VALUE 'FINALIZING';
ALTER TYPE "OrderStatus" ADD VALUE 'REFUSED';
ALTER TYPE "OrderStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "OrderStatus" ADD VALUE 'REFUNDED';

CREATE SEQUENCE "lnx_order_number_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

DO $$
DECLARE
  current_max BIGINT;
BEGIN
  SELECT COALESCE(MAX((regexp_match("orderNumber", '^LNX-[0-9]{4}-([0-9]{6})$'))[1]::BIGINT), 0)
  INTO current_max
  FROM "orders"
  WHERE "orderNumber" ~ '^LNX-[0-9]{4}-[0-9]{6}$';

  IF current_max > 0 THEN
    PERFORM setval('lnx_order_number_seq', current_max, true);
  END IF;
END $$;

ALTER TABLE "orders"
  ADD COLUMN "recipient" VARCHAR(200),
  ADD COLUMN "occasion" VARCHAR(200),
  ADD COLUMN "importantDetails" TEXT,
  ADD COLUMN "wordsToInclude" TEXT,
  ADD COLUMN "avoid" TEXT,
  ADD COLUMN "pronunciationNotes" TEXT,
  ADD COLUMN "usage" "OrderUsage" NOT NULL DEFAULT 'PERSONAL',
  ADD COLUMN "coverIncluded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "priorityProcessing" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "basePriceCents" INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN "coverPriceCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "priorityPriceCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalCents" INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
  ADD COLUMN "pricingVersion" VARCHAR(32) NOT NULL DEFAULT '2026-08-v1',
  ADD COLUMN "contractRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "revisionAllowance" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "revisionUsed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "submittedAt" TIMESTAMPTZ(3),
  ADD COLUMN "serviceStartedAt" TIMESTAMPTZ(3),
  ADD COLUMN "deliveredAt" TIMESTAMPTZ(3),
  ADD COLUMN "downloadExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(3);

ALTER TABLE "order_events"
  ADD COLUMN "visibility" "OrderEventVisibility" NOT NULL DEFAULT 'CLIENT';

ALTER TABLE "order_assets"
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_prices_nonnegative" CHECK (
    "basePriceCents" >= 0 AND
    "coverPriceCents" >= 0 AND
    "priorityPriceCents" >= 0 AND
    "totalCents" >= 0
  ),
  ADD CONSTRAINT "orders_total_matches_snapshot" CHECK (
    "totalCents" = "basePriceCents" + "coverPriceCents" + "priorityPriceCents"
  ),
  ADD CONSTRAINT "orders_revision_usage_valid" CHECK (
    "revisionAllowance" >= 0 AND
    "revisionUsed" >= 0 AND
    "revisionUsed" <= "revisionAllowance"
  ),
  ADD CONSTRAINT "orders_contract_usage_consistent" CHECK (
    ("usage" = 'PERSONAL' AND "contractRequired" = false) OR
    ("usage" = 'COMMERCIAL_EXTENDED' AND "contractRequired" = true)
  ),
  ADD CONSTRAINT "orders_delivery_expiry_consistent" CHECK (
    "downloadExpiresAt" IS NULL OR
    ("deliveredAt" IS NOT NULL AND "downloadExpiresAt" > "deliveredAt")
  );

ALTER TABLE "order_assets"
  ADD CONSTRAINT "order_assets_position_nonnegative" CHECK ("position" >= 0);

CREATE INDEX "orders_userId_status_updatedAt_idx" ON "orders"("userId", "status", "updatedAt");
