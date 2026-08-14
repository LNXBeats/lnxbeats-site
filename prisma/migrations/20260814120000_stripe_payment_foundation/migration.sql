-- V0.7.0 introduces a provider-neutral payment ledger for Stripe checkout
-- attempts and a minimal, idempotent provider-event receipt log. This
-- migration is additive and deliberately performs no order backfill.
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE');

CREATE TYPE "PaymentMode" AS ENUM ('TEST', 'LIVE');

CREATE TYPE "PaymentStatus" AS ENUM (
  'CREATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'EXPIRED',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'REQUIRES_REVIEW'
);

CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'PAYPAL', 'WERO', 'OTHER');

CREATE TYPE "ProviderEventOutcome" AS ENUM (
  'PROCESSED',
  'IGNORED',
  'REQUIRES_REVIEW'
);

CREATE TABLE "payments" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
  "mode" "PaymentMode" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  "amountCents" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "pricingVersion" VARCHAR(32) NOT NULL,
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "providerCheckoutId" VARCHAR(255),
  "providerPaymentId" VARCHAR(255),
  "paymentMethod" "PaymentMethod",
  "failureCode" VARCHAR(120),
  "checkoutExpiresAt" TIMESTAMPTZ(3),
  "paidAt" TIMESTAMPTZ(3),
  "failedAt" TIMESTAMPTZ(3),
  "canceledAt" TIMESTAMPTZ(3),
  "expiredAt" TIMESTAMPTZ(3),
  "refundedAt" TIMESTAMPTZ(3),
  "refundedAmountCents" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payments_amounts_valid" CHECK (
    "amountCents" > 0 AND
    "refundedAmountCents" >= 0 AND
    "refundedAmountCents" <= "amountCents"
  ),
  CONSTRAINT "payments_currency_eur" CHECK ("currency" = 'EUR'),
  CONSTRAINT "payments_required_identifiers_nonempty" CHECK (
    btrim("pricingVersion") <> '' AND
    btrim("idempotencyKey") <> '' AND
    ("providerCheckoutId" IS NULL OR btrim("providerCheckoutId") <> '') AND
    ("providerPaymentId" IS NULL OR btrim("providerPaymentId") <> '')
  ),
  CONSTRAINT "payments_checkout_expiry_valid" CHECK (
    "checkoutExpiresAt" IS NULL OR "checkoutExpiresAt" > "createdAt"
  ),
  CONSTRAINT "payments_status_timestamps_consistent" CHECK (
    ("status" <> 'SUCCEEDED' OR "paidAt" IS NOT NULL) AND
    ("status" <> 'FAILED' OR "failedAt" IS NOT NULL) AND
    ("status" <> 'CANCELED' OR "canceledAt" IS NOT NULL) AND
    ("status" <> 'EXPIRED' OR "expiredAt" IS NOT NULL) AND
    ("status" <> 'REFUND_PENDING' OR "paidAt" IS NOT NULL) AND
    ("status" <> 'PARTIALLY_REFUNDED' OR (
      "paidAt" IS NOT NULL AND
      "refundedAt" IS NOT NULL AND
      "refundedAmountCents" > 0 AND
      "refundedAmountCents" < "amountCents"
    )) AND
    ("status" <> 'REFUNDED' OR (
      "paidAt" IS NOT NULL AND
      "refundedAt" IS NOT NULL AND
      "refundedAmountCents" = "amountCents"
    ))
  )
);

CREATE TABLE "provider_events" (
  "id" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "providerEventId" VARCHAR(255) NOT NULL,
  "type" VARCHAR(160) NOT NULL,
  "livemode" BOOLEAN NOT NULL,
  "objectId" VARCHAR(255),
  "outcome" "ProviderEventOutcome" NOT NULL,
  "paymentId" UUID,
  "processedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "provider_events_identifiers_nonempty" CHECK (
    btrim("providerEventId") <> '' AND
    btrim("type") <> '' AND
    ("objectId" IS NULL OR btrim("objectId") <> '')
  )
);

CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");
CREATE UNIQUE INDEX "payments_provider_providerCheckoutId_key" ON "payments"("provider", "providerCheckoutId");
CREATE UNIQUE INDEX "payments_provider_providerPaymentId_key" ON "payments"("provider", "providerPaymentId");
CREATE INDEX "payments_orderId_createdAt_idx" ON "payments"("orderId", "createdAt");
CREATE INDEX "payments_provider_mode_status_updatedAt_idx" ON "payments"("provider", "mode", "status", "updatedAt");

CREATE UNIQUE INDEX "payments_one_succeeded_per_order_idx"
  ON "payments"("orderId")
  WHERE "status" IN ('SUCCEEDED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED');

CREATE UNIQUE INDEX "payments_one_active_per_order_idx"
  ON "payments"("orderId")
  WHERE "status" IN ('CREATED', 'PENDING', 'REQUIRES_REVIEW')
     OR ("status" = 'FAILED' AND "failureCode" = 'STRIPE_PAYMENT_ATTEMPT_FAILED');

CREATE UNIQUE INDEX "provider_events_provider_providerEventId_key" ON "provider_events"("provider", "providerEventId");
CREATE INDEX "provider_events_paymentId_createdAt_idx" ON "provider_events"("paymentId", "createdAt");
CREATE INDEX "provider_events_provider_livemode_createdAt_idx" ON "provider_events"("provider", "livemode", "createdAt");
