-- V0.6.0.1 adds a post-delivery rights lifecycle without rewriting the V0.6 order migration.
CREATE TYPE "CommercialLicenseStatus" AS ENUM (
  'REQUESTED',
  'CONTRACT_PENDING',
  'PAYMENT_PENDING',
  'ACTIVE',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE "CommercialLicensePaymentStatus" AS ENUM (
  'NOT_STARTED',
  'PENDING',
  'CONFIRMED',
  'REFUND_PENDING',
  'REFUNDED'
);

CREATE TABLE "commercial_licenses" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "status" "CommercialLicenseStatus" NOT NULL DEFAULT 'REQUESTED',
  "priceCents" INTEGER NOT NULL DEFAULT 150000,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "pricingVersion" VARCHAR(32) NOT NULL DEFAULT '2026-08-rights-v1',
  "contractRequired" BOOLEAN NOT NULL DEFAULT true,
  "contractAcceptedAt" TIMESTAMPTZ(3),
  "paymentStatus" "CommercialLicensePaymentStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMPTZ(3),
  "activatedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "commercial_licenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commercial_licenses_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commercial_licenses_offer_snapshot" CHECK (
    "priceCents" = 150000 AND
    "currency" = 'EUR' AND
    "contractRequired" = true
  ),
  CONSTRAINT "commercial_licenses_dates_consistent" CHECK (
    ("approvedAt" IS NULL OR "approvedAt" >= "requestedAt") AND
    ("activatedAt" IS NULL OR ("approvedAt" IS NOT NULL AND "activatedAt" >= "approvedAt")) AND
    ("contractAcceptedAt" IS NULL OR "contractAcceptedAt" >= "requestedAt")
  )
);

CREATE INDEX "commercial_licenses_orderId_createdAt_idx" ON "commercial_licenses"("orderId", "createdAt");
CREATE INDEX "commercial_licenses_status_updatedAt_idx" ON "commercial_licenses"("status", "updatedAt");

CREATE UNIQUE INDEX "commercial_licenses_one_open_per_order_idx"
  ON "commercial_licenses"("orderId")
  WHERE "status" IN ('REQUESTED', 'CONTRACT_PENDING', 'PAYMENT_PENDING', 'ACTIVE');
