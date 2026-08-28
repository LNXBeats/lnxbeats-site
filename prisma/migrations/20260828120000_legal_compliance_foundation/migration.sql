-- V1.1.0 Phase 4: additive legal-document versioning and consumer
-- withdrawal evidence. Candidate documents remain non-active until a later,
-- explicitly reviewed activation; existing orders and payments are unchanged.

CREATE TYPE "LegalDocumentType" AS ENUM (
  'LEGAL_NOTICES',
  'MUSIC_TERMS',
  'SHOP_TERMS',
  'PRIVACY_NOTICE',
  'WITHDRAWAL_NOTICE'
);

CREATE TYPE "LegalDocumentStatus" AS ENUM (
  'DRAFT',
  'AWAITING_LEGAL_REVIEW',
  'APPROVED',
  'ACTIVE',
  'RETIRED'
);

CREATE TYPE "ConsumerContractType" AS ENUM ('MUSIC_ORDER', 'SHOP_ORDER');
CREATE TYPE "ConsumerWithdrawalStatus" AS ENUM ('RECEIVED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ConsumerWithdrawalEligibilityReview" AS ENUM ('PENDING_REVIEW', 'ELIGIBLE', 'INELIGIBLE');
CREATE TYPE "ConsumerWithdrawalIdentityMatch" AS ENUM ('MATCHED', 'UNMATCHED');
CREATE TYPE "ConsumerWithdrawalReturnStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'AUTHORIZED', 'RECEIVED');
CREATE TYPE "ConsumerWithdrawalRefundStatus" AS ENUM ('NOT_EVALUATED', 'NOT_REQUIRED', 'REFUND_REQUIRED', 'COMPLETED');
CREATE TYPE "ConsumerWithdrawalAcknowledgementStatus" AS ENUM ('CAPTURED', 'SENT', 'FAILED');

CREATE TABLE "legal_document_versions" (
  "id" UUID NOT NULL,
  "type" "LegalDocumentType" NOT NULL,
  "version" VARCHAR(80) NOT NULL,
  "hashSha256" CHAR(64) NOT NULL,
  "status" "LegalDocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveAt" TIMESTAMPTZ(3),
  "approvedByUserId" UUID,
  "approvedAt" TIMESTAMPTZ(3),
  "replacesVersionId" UUID,
  "legalReviewReference" VARCHAR(240),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "legal_document_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legal_document_versions_version_nonempty" CHECK (
    btrim("version") = "version" AND btrim("version") <> ''
  ),
  CONSTRAINT "legal_document_versions_hash_format" CHECK (
    "hashSha256" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "legal_document_versions_review_state" CHECK (
    (
      "status" IN ('DRAFT', 'AWAITING_LEGAL_REVIEW')
      AND "approvedByUserId" IS NULL
      AND "approvedAt" IS NULL
      AND "effectiveAt" IS NULL
    )
    OR (
      "status" = 'APPROVED'
      AND "approvedByUserId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
      AND "effectiveAt" IS NULL
    )
    OR (
      "status" IN ('ACTIVE', 'RETIRED')
      AND "approvedByUserId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
      AND "effectiveAt" IS NOT NULL
    )
  ),
  CONSTRAINT "legal_document_versions_distinct_replacement" CHECK (
    "replacesVersionId" IS NULL OR "replacesVersionId" <> "id"
  )
);

CREATE UNIQUE INDEX "legal_document_versions_type_version_key"
  ON "legal_document_versions"("type", "version");
CREATE UNIQUE INDEX "legal_document_versions_replacesVersionId_key"
  ON "legal_document_versions"("replacesVersionId");
CREATE UNIQUE INDEX "legal_document_versions_one_active_per_type_idx"
  ON "legal_document_versions"("type") WHERE "status" = 'ACTIVE';
CREATE INDEX "legal_document_versions_type_status_createdAt_idx"
  ON "legal_document_versions"("type", "status", "createdAt");
CREATE INDEX "legal_document_versions_approvedByUserId_idx"
  ON "legal_document_versions"("approvedByUserId");

ALTER TABLE "legal_document_versions"
  ADD CONSTRAINT "legal_document_versions_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "legal_document_versions_replacesVersionId_fkey"
    FOREIGN KEY ("replacesVersionId") REFERENCES "legal_document_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "consumer_withdrawal_requests" (
  "id" UUID NOT NULL,
  "requestNumber" VARCHAR(32) NOT NULL,
  "publicReceiptTokenHash" CHAR(64) NOT NULL,
  "deduplicationHashSha256" CHAR(64) NOT NULL,
  "contractType" "ConsumerContractType" NOT NULL,
  "claimedOrderReference" VARCHAR(64) NOT NULL,
  "orderId" UUID,
  "shopOrderId" UUID,
  "identityMatch" "ConsumerWithdrawalIdentityMatch" NOT NULL,
  "claimantFirstName" VARCHAR(100) NOT NULL,
  "claimantLastName" VARCHAR(100) NOT NULL,
  "claimantEmail" VARCHAR(320) NOT NULL,
  "productDescription" VARCHAR(500) NOT NULL,
  "quantity" INTEGER,
  "reason" VARCHAR(1000),
  "declarationText" TEXT NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL,
  "status" "ConsumerWithdrawalStatus" NOT NULL DEFAULT 'RECEIVED',
  "eligibilityReview" "ConsumerWithdrawalEligibilityReview" NOT NULL DEFAULT 'PENDING_REVIEW',
  "reviewedAt" TIMESTAMPTZ(3),
  "reviewedByUserId" UUID,
  "acknowledgementStatus" "ConsumerWithdrawalAcknowledgementStatus" NOT NULL DEFAULT 'CAPTURED',
  "acknowledgementSnapshot" JSONB NOT NULL,
  "acknowledgementHashSha256" CHAR(64) NOT NULL,
  "acknowledgementCreatedAt" TIMESTAMPTZ(3) NOT NULL,
  "acknowledgementSentAt" TIMESTAMPTZ(3),
  "termsVersion" VARCHAR(80),
  "returnStatus" "ConsumerWithdrawalReturnStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
  "refundStatus" "ConsumerWithdrawalRefundStatus" NOT NULL DEFAULT 'NOT_EVALUATED',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "consumer_withdrawal_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consumer_withdrawal_requests_hashes_format" CHECK (
    "publicReceiptTokenHash" ~ '^[0-9a-f]{64}$'
    AND "deduplicationHashSha256" ~ '^[0-9a-f]{64}$'
    AND "acknowledgementHashSha256" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "consumer_withdrawal_requests_text_fields" CHECK (
    btrim("requestNumber") = "requestNumber" AND btrim("requestNumber") <> ''
    AND btrim("claimedOrderReference") = "claimedOrderReference" AND btrim("claimedOrderReference") <> ''
    AND btrim("claimantFirstName") = "claimantFirstName" AND btrim("claimantFirstName") <> ''
    AND btrim("claimantLastName") = "claimantLastName" AND btrim("claimantLastName") <> ''
    AND btrim("productDescription") = "productDescription" AND btrim("productDescription") <> ''
    AND btrim("declarationText") <> ''
  ),
  CONSTRAINT "consumer_withdrawal_requests_email_normalized" CHECK (
    "claimantEmail" = lower(btrim("claimantEmail"))
    AND "claimantEmail" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  CONSTRAINT "consumer_withdrawal_requests_quantity_positive" CHECK (
    "quantity" IS NULL OR "quantity" > 0
  ),
  CONSTRAINT "consumer_withdrawal_requests_parent_scope" CHECK (
    (
      "identityMatch" = 'UNMATCHED'
      AND "orderId" IS NULL
      AND "shopOrderId" IS NULL
    )
    OR (
      "identityMatch" = 'MATCHED'
      AND "contractType" = 'MUSIC_ORDER'
      AND "orderId" IS NOT NULL
      AND "shopOrderId" IS NULL
    )
    OR (
      "identityMatch" = 'MATCHED'
      AND "contractType" = 'SHOP_ORDER'
      AND "orderId" IS NULL
      AND "shopOrderId" IS NOT NULL
    )
  ),
  CONSTRAINT "consumer_withdrawal_requests_review_state" CHECK (
    (
      "status" IN ('RECEIVED', 'CANCELLED')
      AND "reviewedAt" IS NULL
      AND "reviewedByUserId" IS NULL
      AND "eligibilityReview" = 'PENDING_REVIEW'
    )
    OR (
      "status" = 'UNDER_REVIEW'
      AND "reviewedAt" IS NULL
      AND "eligibilityReview" = 'PENDING_REVIEW'
    )
    OR (
      "status" IN ('ACCEPTED', 'REJECTED')
      AND "reviewedAt" IS NOT NULL
      AND "reviewedByUserId" IS NOT NULL
      AND "eligibilityReview" IN ('ELIGIBLE', 'INELIGIBLE')
    )
  ),
  CONSTRAINT "consumer_withdrawal_requests_acknowledgement_state" CHECK (
    jsonb_typeof("acknowledgementSnapshot") = 'object'
    AND "acknowledgementCreatedAt" >= "receivedAt"
    AND (
      ("acknowledgementStatus" IN ('CAPTURED', 'FAILED') AND "acknowledgementSentAt" IS NULL)
      OR
      ("acknowledgementStatus" = 'SENT' AND "acknowledgementSentAt" >= "acknowledgementCreatedAt")
    )
  )
);

CREATE UNIQUE INDEX "consumer_withdrawal_requests_requestNumber_key"
  ON "consumer_withdrawal_requests"("requestNumber");
CREATE UNIQUE INDEX "consumer_withdrawal_requests_publicReceiptTokenHash_key"
  ON "consumer_withdrawal_requests"("publicReceiptTokenHash");
CREATE UNIQUE INDEX "consumer_withdrawal_requests_deduplicationHashSha256_key"
  ON "consumer_withdrawal_requests"("deduplicationHashSha256");
CREATE INDEX "consumer_withdrawal_requests_status_receivedAt_idx"
  ON "consumer_withdrawal_requests"("status", "receivedAt");
CREATE INDEX "consumer_withdrawal_requests_orderId_receivedAt_idx"
  ON "consumer_withdrawal_requests"("orderId", "receivedAt");
CREATE INDEX "consumer_withdrawal_requests_shopOrderId_receivedAt_idx"
  ON "consumer_withdrawal_requests"("shopOrderId", "receivedAt");
CREATE INDEX "consumer_withdrawal_requests_reviewedByUserId_idx"
  ON "consumer_withdrawal_requests"("reviewedByUserId");

ALTER TABLE "consumer_withdrawal_requests"
  ADD CONSTRAINT "consumer_withdrawal_requests_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "consumer_withdrawal_requests_shopOrderId_fkey"
    FOREIGN KEY ("shopOrderId") REFERENCES "shop_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "consumer_withdrawal_requests_reviewedByUserId_fkey"
    FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
