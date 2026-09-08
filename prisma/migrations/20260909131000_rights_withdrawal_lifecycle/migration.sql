-- V1.2.0: isolated, additive Rights withdrawal/refund lifecycle.
-- Existing Commander/Shop withdrawal data and historical migrations remain unchanged.

ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_RIGHTS_WITHDRAWAL_RECORDED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'OWNER_RIGHTS_WITHDRAWAL_REQUESTED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_RIGHTS_WITHDRAWAL_REFUNDED';
ALTER TYPE "RightsRequestStatus" ADD VALUE 'WITHDRAWAL_REQUESTED';
ALTER TYPE "RightsEventType" ADD VALUE 'WITHDRAWAL_APPROVED';
ALTER TYPE "RightsEventType" ADD VALUE 'WITHDRAWAL_REJECTED';
ALTER TYPE "RightsEventType" ADD VALUE 'WITHDRAWAL_REFUNDED';
ALTER TYPE "RightsLicenseStatus" ADD VALUE 'WITHDRAWAL_REQUESTED';

CREATE TYPE "RightsWithdrawalStatus" AS ENUM (
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'REFUND_PENDING',
  'COMPLETED',
  'REQUIRES_REVIEW'
);

CREATE TABLE "rights_withdrawal_requests" (
  "id" UUID NOT NULL,
  "requestNumber" VARCHAR(40) NOT NULL,
  "rightsRequestId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "contractDocumentId" UUID NOT NULL,
  "requestedByUserId" UUID NOT NULL,
  "status" "RightsWithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedAt" TIMESTAMPTZ(3) NOT NULL,
  "withdrawalDeadline" TIMESTAMPTZ(3) NOT NULL,
  "reason" VARCHAR(1000),
  "declarationText" TEXT NOT NULL,
  "evidenceSnapshot" JSONB NOT NULL,
  "evidenceHashSha256" CHAR(64) NOT NULL,
  "reviewedAt" TIMESTAMPTZ(3),
  "reviewedByUserId" UUID,
  "rejectionReason" VARCHAR(1000),
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "rights_withdrawal_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rights_withdrawal_requests_dates" CHECK (
    "requestedAt" <= "withdrawalDeadline"
    AND ("completedAt" IS NULL OR "completedAt" >= "requestedAt")
  ),
  CONSTRAINT "rights_withdrawal_requests_hash" CHECK ("evidenceHashSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "rights_withdrawal_requests_review" CHECK (
    ("status" = 'REQUESTED' AND "reviewedAt" IS NULL AND "reviewedByUserId" IS NULL AND "completedAt" IS NULL)
    OR ("status" IN ('APPROVED', 'REFUND_PENDING', 'REQUIRES_REVIEW')
      AND "reviewedAt" IS NOT NULL AND "reviewedByUserId" IS NOT NULL AND "completedAt" IS NULL)
    OR ("status" = 'REJECTED'
      AND "reviewedAt" IS NOT NULL AND "reviewedByUserId" IS NOT NULL
      AND "rejectionReason" IS NOT NULL AND "completedAt" IS NOT NULL)
    OR ("status" = 'COMPLETED'
      AND "reviewedAt" IS NOT NULL AND "reviewedByUserId" IS NOT NULL AND "completedAt" IS NOT NULL)
  ),
  CONSTRAINT "rights_withdrawal_requests_request_fkey" FOREIGN KEY ("rightsRequestId")
    REFERENCES "rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rights_withdrawal_requests_payment_fkey" FOREIGN KEY ("paymentId")
    REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rights_withdrawal_requests_invoice_fkey" FOREIGN KEY ("invoiceId")
    REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rights_withdrawal_requests_document_fkey" FOREIGN KEY ("contractDocumentId")
    REFERENCES "contract_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rights_withdrawal_requests_requester_fkey" FOREIGN KEY ("requestedByUserId")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rights_withdrawal_requests_reviewer_fkey" FOREIGN KEY ("reviewedByUserId")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "rights_withdrawal_requests_requestNumber_key" ON "rights_withdrawal_requests"("requestNumber");
CREATE UNIQUE INDEX "rights_withdrawal_requests_rightsRequestId_key" ON "rights_withdrawal_requests"("rightsRequestId");
CREATE UNIQUE INDEX "rights_withdrawal_requests_paymentId_key" ON "rights_withdrawal_requests"("paymentId");
CREATE UNIQUE INDEX "rights_withdrawal_requests_invoiceId_key" ON "rights_withdrawal_requests"("invoiceId");
CREATE UNIQUE INDEX "rights_withdrawal_requests_contractDocumentId_key" ON "rights_withdrawal_requests"("contractDocumentId");
CREATE UNIQUE INDEX "rights_withdrawal_requests_evidenceHashSha256_key" ON "rights_withdrawal_requests"("evidenceHashSha256");
CREATE UNIQUE INDEX "rights_withdrawal_requests_id_paymentId_key" ON "rights_withdrawal_requests"("id", "paymentId");
CREATE INDEX "rights_withdrawal_requests_status_requestedAt_idx" ON "rights_withdrawal_requests"("status", "requestedAt");

ALTER TABLE "refund_attempts" ADD COLUMN "rightsWithdrawalId" UUID;
ALTER TABLE "refund_attempts"
  ADD CONSTRAINT "refund_attempts_rightsWithdrawalId_fkey"
  FOREIGN KEY ("rightsWithdrawalId") REFERENCES "rights_withdrawal_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "refund_attempts_rightsWithdrawalId_key" ON "refund_attempts"("rightsWithdrawalId");

CREATE FUNCTION "lnx_rights_refund_parent_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."rightsWithdrawalId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "rights_withdrawal_requests" w
    JOIN "payments" p ON p."id" = w."paymentId"
    WHERE w."id" = NEW."rightsWithdrawalId"
      AND w."paymentId" = NEW."paymentId"
      AND p."rightsRequestId" = w."rightsRequestId"
      AND p."provider" = NEW."provider"
      AND p."currency" = NEW."currency"
      AND p."amountCents" = NEW."amountCents"
  ) THEN
    RAISE EXCEPTION 'RIGHTS_REFUND_PARENT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "refund_attempts_rights_parent_guard"
BEFORE INSERT OR UPDATE ON "refund_attempts"
FOR EACH ROW EXECUTE FUNCTION "lnx_rights_refund_parent_guard"();

-- Additional passive barrier. It never mutates business state or contacts a provider.
CREATE FUNCTION "lnx_rights_withdrawal_activation_guard"() RETURNS trigger AS $$
BEGIN
  -- Serialize the passive DB check with application-level payment,
  -- activation and withdrawal transitions for the same Rights aggregate.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('rights-payment:request:' || NEW."rightsRequestId"::text, 0)
  );
  IF NEW."status" = 'ACTIVE' AND (
    EXISTS (
      SELECT 1 FROM "rights_withdrawal_requests" w
      WHERE w."rightsRequestId" = NEW."rightsRequestId"
        AND w."status" IN ('REQUESTED', 'APPROVED', 'REFUND_PENDING', 'COMPLETED', 'REQUIRES_REVIEW')
    )
    OR EXISTS (
      SELECT 1 FROM "refund_attempts" a
      WHERE a."rightsWithdrawalId" IN (
        SELECT w."id" FROM "rights_withdrawal_requests" w
        WHERE w."rightsRequestId" = NEW."rightsRequestId"
      ) AND a."status" IN ('PROCESSING', 'PENDING', 'REQUIRES_REVIEW', 'SUCCEEDED')
    )
    OR NOT EXISTS (
      SELECT 1 FROM "payments" p
      WHERE p."id" = NEW."paymentId"
        AND p."rightsRequestId" = NEW."rightsRequestId"
        AND p."status" = 'SUCCEEDED'
        AND p."refundedAmountCents" = 0
    )
  ) THEN
    RAISE EXCEPTION 'RIGHTS_WITHDRAWAL_BLOCKS_ACTIVATION';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "rights_licenses_withdrawal_activation_guard"
BEFORE INSERT OR UPDATE ON "rights_licenses"
FOR EACH ROW EXECUTE FUNCTION "lnx_rights_withdrawal_activation_guard"();
