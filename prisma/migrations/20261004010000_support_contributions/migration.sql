-- Additive, independent voluntary support ledger. No historical data rewritten.
CREATE TABLE "support_contributions" (
  "id" UUID NOT NULL, "ownerHash" CHAR(64) NOT NULL, "userId" UUID,
  "amountCents" INTEGER NOT NULL, "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
  "provider" VARCHAR(10) NOT NULL, "mode" VARCHAR(4) NOT NULL DEFAULT 'TEST',
  "status" VARCHAR(24) NOT NULL DEFAULT 'CREATED', "idempotencyKey" CHAR(64) NOT NULL,
  "providerReference" VARCHAR(255), "paymentReference" VARCHAR(255), "refundReference" VARCHAR(255),
  "checkoutUrl" VARCHAR(2048), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "support_contributions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_amount_range" CHECK ("amountCents" BETWEEN 100 AND 50000),
  CONSTRAINT "support_currency" CHECK ("currency" = 'EUR'),
  CONSTRAINT "support_provider" CHECK ("provider" IN ('STRIPE','PAYPAL')),
  CONSTRAINT "support_test_only" CHECK ("mode" = 'TEST'),
  CONSTRAINT "support_status" CHECK ("status" IN ('CREATED','PENDING','SUCCEEDED','FAILED','REFUND_PENDING','REFUNDED','REQUIRES_REVIEW'))
);
CREATE TABLE "support_contribution_attempts" (
  "id" UUID NOT NULL, "contributionId" UUID NOT NULL, "operation" VARCHAR(16) NOT NULL,
  "idempotencyKey" VARCHAR(100) NOT NULL, "status" VARCHAR(24) NOT NULL DEFAULT 'REQUESTED',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "support_contribution_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_attempt_operation" CHECK ("operation" IN ('CHECKOUT','CAPTURE','REFUND')),
  CONSTRAINT "support_attempt_status" CHECK ("status" IN ('REQUESTED','SUCCEEDED'))
);
CREATE TABLE "support_contribution_events" (
  "id" UUID NOT NULL, "contributionId" UUID NOT NULL, "eventKey" VARCHAR(255) NOT NULL,
  "type" VARCHAR(64) NOT NULL, "actorId" UUID, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_contribution_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "support_contributions_idempotencyKey_key" ON "support_contributions"("idempotencyKey");
CREATE UNIQUE INDEX "support_contributions_providerReference_key" ON "support_contributions"("providerReference");
CREATE UNIQUE INDEX "support_contributions_paymentReference_key" ON "support_contributions"("paymentReference");
CREATE UNIQUE INDEX "support_contributions_refundReference_key" ON "support_contributions"("refundReference");
CREATE INDEX "support_contributions_createdAt_idx" ON "support_contributions"("createdAt");
CREATE INDEX "support_contributions_status_createdAt_idx" ON "support_contributions"("status","createdAt");
CREATE UNIQUE INDEX "support_contribution_attempts_idempotencyKey_key" ON "support_contribution_attempts"("idempotencyKey");
CREATE UNIQUE INDEX "support_contribution_attempts_contributionId_operation_key" ON "support_contribution_attempts"("contributionId","operation");
CREATE UNIQUE INDEX "support_contribution_events_eventKey_key" ON "support_contribution_events"("eventKey");
CREATE INDEX "support_contribution_events_contributionId_createdAt_idx" ON "support_contribution_events"("contributionId","createdAt");
ALTER TABLE "support_contributions" ADD CONSTRAINT "support_contributions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_contribution_attempts" ADD CONSTRAINT "support_contribution_attempts_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "support_contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_contribution_events" ADD CONSTRAINT "support_contribution_events_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "support_contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
