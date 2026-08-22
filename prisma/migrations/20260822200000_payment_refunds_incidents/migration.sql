-- V0.7.6 adds provider-neutral refund attempts, financial incidents and a
-- minimized operator audit trail. Order status remains deliberately separate
-- from every financial mutation.
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_PARTIAL_REFUND';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_REFUND_COMPLETED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'OWNER_PAYMENT_INCIDENT';

CREATE TYPE "RefundAttemptSource" AS ENUM ('ADMIN', 'PROVIDER');
CREATE TYPE "RefundAttemptStatus" AS ENUM ('PROCESSING', 'PENDING', 'SUCCEEDED', 'FAILED', 'REQUIRES_REVIEW');
CREATE TYPE "PaymentIncidentType" AS ENUM ('REVERSAL', 'DISPUTE', 'CHARGEBACK');
CREATE TYPE "PaymentIncidentStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED');
CREATE TYPE "PaymentIncidentOutcome" AS ENUM ('BUYER_FAVOUR', 'SELLER_FAVOUR', 'REVERSED', 'RESTORED', 'ACCEPTED', 'DENIED', 'OTHER');
CREATE TYPE "PaymentAuditAction" AS ENUM (
  'REFUND_REQUESTED',
  'REFUND_PROVIDER_ACCEPTED',
  'REFUND_CONFIRMED',
  'REFUND_FAILED',
  'REFUND_RECONCILIATION_REQUIRED',
  'INCIDENT_OPENED',
  'INCIDENT_UPDATED',
  'INCIDENT_RESOLVED',
  'RECONCILIATION_CHECKED'
);
CREATE TYPE "PaymentAuditResult" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REQUIRES_REVIEW', 'NO_CHANGE');

CREATE TABLE "refund_attempts" (
  "id" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "source" "RefundAttemptSource" NOT NULL DEFAULT 'ADMIN',
  "amountCents" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "requestedByUserId" UUID,
  "localIdempotencyKey" VARCHAR(255) NOT NULL,
  "providerRefundId" VARCHAR(255),
  "providerIdempotencyKey" VARCHAR(255) NOT NULL,
  "status" "RefundAttemptStatus" NOT NULL DEFAULT 'PROCESSING',
  "failureCode" VARCHAR(120),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMPTZ(3),
  "confirmedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "refund_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refund_attempts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "refund_attempts_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "refund_attempts_amount_valid" CHECK ("amountCents" > 0),
  CONSTRAINT "refund_attempts_currency_eur" CHECK ("currency" = 'EUR'),
  CONSTRAINT "refund_attempts_attempts_valid" CHECK ("attempts" >= 0),
  CONSTRAINT "refund_attempts_source_actor_consistent" CHECK (
    ("source" = 'ADMIN' AND "requestedByUserId" IS NOT NULL) OR
    ("source" = 'PROVIDER' AND "requestedByUserId" IS NULL)
  ),
  CONSTRAINT "refund_attempts_identifiers_nonempty" CHECK (
    btrim("localIdempotencyKey") <> '' AND
    btrim("providerIdempotencyKey") <> '' AND
    ("providerRefundId" IS NULL OR btrim("providerRefundId") <> '')
  ),
  CONSTRAINT "refund_attempts_status_consistent" CHECK (
    ("status" <> 'SUCCEEDED' OR ("providerRefundId" IS NOT NULL AND "confirmedAt" IS NOT NULL)) AND
    ("status" NOT IN ('FAILED', 'REQUIRES_REVIEW') OR "failureCode" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "refund_attempts_localIdempotencyKey_key" ON "refund_attempts"("localIdempotencyKey");
CREATE UNIQUE INDEX "refund_attempts_provider_providerRefundId_key" ON "refund_attempts"("provider", "providerRefundId");
CREATE UNIQUE INDEX "refund_attempts_provider_providerIdempotencyKey_key" ON "refund_attempts"("provider", "providerIdempotencyKey");
CREATE INDEX "refund_attempts_paymentId_status_createdAt_idx" ON "refund_attempts"("paymentId", "status", "createdAt");

CREATE TABLE "payment_incidents" (
  "id" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "type" "PaymentIncidentType" NOT NULL,
  "providerIncidentId" VARCHAR(255) NOT NULL,
  "status" "PaymentIncidentStatus" NOT NULL,
  "amountCents" INTEGER,
  "currency" VARCHAR(3),
  "outcome" "PaymentIncidentOutcome",
  "requiresOperatorReview" BOOLEAN NOT NULL DEFAULT true,
  "openedAt" TIMESTAMPTZ(3) NOT NULL,
  "resolvedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "payment_incidents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_incidents_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_incidents_identifier_nonempty" CHECK (btrim("providerIncidentId") <> ''),
  CONSTRAINT "payment_incidents_amount_currency_consistent" CHECK (
    ("amountCents" IS NULL AND "currency" IS NULL) OR
    ("amountCents" > 0 AND "currency" = 'EUR')
  ),
  CONSTRAINT "payment_incidents_resolution_consistent" CHECK (
    ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL AND "outcome" IS NOT NULL) OR
    ("status" <> 'RESOLVED' AND "resolvedAt" IS NULL AND "outcome" IS NULL)
  )
);

CREATE UNIQUE INDEX "payment_incidents_provider_type_providerIncidentId_key" ON "payment_incidents"("provider", "type", "providerIncidentId");
CREATE INDEX "payment_incidents_paymentId_status_createdAt_idx" ON "payment_incidents"("paymentId", "status", "createdAt");
CREATE INDEX "payment_incidents_requiresOperatorReview_updatedAt_idx" ON "payment_incidents"("requiresOperatorReview", "updatedAt");

CREATE TABLE "payment_audit_events" (
  "id" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "refundAttemptId" UUID,
  "incidentId" UUID,
  "actorUserId" UUID,
  "actorRole" "UserRole",
  "provider" "PaymentProvider" NOT NULL,
  "action" "PaymentAuditAction" NOT NULL,
  "amountCents" INTEGER,
  "result" "PaymentAuditResult" NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_audit_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_audit_events_refundAttemptId_fkey" FOREIGN KEY ("refundAttemptId") REFERENCES "refund_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_audit_events_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "payment_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_audit_events_amount_valid" CHECK ("amountCents" IS NULL OR "amountCents" > 0),
  CONSTRAINT "payment_audit_events_reference_valid" CHECK (num_nonnulls("refundAttemptId", "incidentId") <= 1),
  CONSTRAINT "payment_audit_events_actor_consistent" CHECK (
    ("actorUserId" IS NULL AND "actorRole" IS NULL) OR
    ("actorUserId" IS NOT NULL AND "actorRole" IS NOT NULL)
  )
);

CREATE INDEX "payment_audit_events_paymentId_createdAt_idx" ON "payment_audit_events"("paymentId", "createdAt");
CREATE INDEX "payment_audit_events_refundAttemptId_createdAt_idx" ON "payment_audit_events"("refundAttemptId", "createdAt");
CREATE INDEX "payment_audit_events_incidentId_createdAt_idx" ON "payment_audit_events"("incidentId", "createdAt");

ALTER TABLE "provider_events" ADD COLUMN "refundAttemptId" UUID;
ALTER TABLE "provider_events" ADD COLUMN "incidentId" UUID;
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_refundAttemptId_fkey" FOREIGN KEY ("refundAttemptId") REFERENCES "refund_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "payment_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "provider_events_refundAttemptId_createdAt_idx" ON "provider_events"("refundAttemptId", "createdAt");
CREATE INDEX "provider_events_incidentId_createdAt_idx" ON "provider_events"("incidentId", "createdAt");
