-- V1.2.0: additive payment, billing and delayed-license foundation for the
-- single publication-license offer. All commercial gates remain OFF by
-- default in application code. No existing rights document is rewritten.

ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_RIGHTS_PAYMENT_CONFIRMED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'OWNER_RIGHTS_PAYMENT_CONFIRMED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_RIGHTS_LICENSE_ACTIVE';
ALTER TYPE "InvoiceDocumentType" ADD VALUE 'RIGHTS';
ALTER TYPE "RightsRequestStatus" ADD VALUE 'PAID_WAITING_WITHDRAWAL_PERIOD';
ALTER TYPE "RightsRequestStatus" ADD VALUE 'REQUIRES_REVIEW';
ALTER TYPE "RightsRequestStatus" ADD VALUE 'WITHDRAWN';
ALTER TYPE "RightsRequestStatus" ADD VALUE 'TERMINATED';
ALTER TYPE "RightsEventType" ADD VALUE 'PAYMENT_CONFIRMED';
ALTER TYPE "RightsEventType" ADD VALUE 'PAYMENT_REQUIRES_REVIEW';
ALTER TYPE "RightsEventType" ADD VALUE 'LICENSE_ACTIVATED';
ALTER TYPE "RightsEventType" ADD VALUE 'LICENSE_TERMINATED';
ALTER TYPE "RightsEventType" ADD VALUE 'WITHDRAWAL_RECORDED';

CREATE TYPE "RightsLicenseStatus" AS ENUM (
  'PAID_WAITING_WITHDRAWAL_PERIOD',
  'ACTIVE',
  'WITHDRAWN',
  'TERMINATED',
  'REQUIRES_REVIEW'
);

ALTER TABLE "payments" ADD COLUMN "rightsRequestId" UUID;
ALTER TABLE "payments" DROP CONSTRAINT "payments_parent_xor";
ALTER TABLE "payments" ADD CONSTRAINT "payments_parent_xor" CHECK (
  (("orderId" IS NOT NULL)::INTEGER
  + ("shopOrderId" IS NOT NULL)::INTEGER
  + ("rightsRequestId" IS NOT NULL)::INTEGER) = 1
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_rightsRequestId_fkey"
  FOREIGN KEY ("rightsRequestId") REFERENCES "rights_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "payments_id_rightsRequestId_key" ON "payments"("id", "rightsRequestId");
CREATE INDEX "payments_rightsRequestId_createdAt_idx" ON "payments"("rightsRequestId", "createdAt");
CREATE UNIQUE INDEX "payments_one_active_per_rights_provider_idx"
  ON "payments"("rightsRequestId", "provider")
  WHERE "rightsRequestId" IS NOT NULL
    AND "status" IN ('CREATED', 'PENDING');

ALTER TABLE "invoices" ADD COLUMN "rightsRequestId" UUID;
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_parent_xor";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_parent_xor" CHECK (
  (("orderId" IS NOT NULL)::INTEGER
  + ("shopOrderId" IS NOT NULL)::INTEGER
  + ("rightsRequestId" IS NOT NULL)::INTEGER) = 1
);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_rightsRequestId_fkey"
  FOREIGN KEY ("rightsRequestId") REFERENCES "rights_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "invoices_rightsRequestId_key" ON "invoices"("rightsRequestId");

ALTER TABLE "order_notifications" ADD COLUMN "rightsRequestId" UUID;
ALTER TABLE "order_notifications" DROP CONSTRAINT "order_notifications_parent_xor";
ALTER TABLE "order_notifications" ADD CONSTRAINT "order_notifications_parent_xor" CHECK (
  (("orderId" IS NOT NULL)::INTEGER
  + ("shopOrderId" IS NOT NULL)::INTEGER
  + ("rightsRequestId" IS NOT NULL)::INTEGER) = 1
);
ALTER TABLE "order_notifications" ADD CONSTRAINT "order_notifications_rights_resource_consistent" CHECK (
  "rightsRequestId" IS NULL OR (
    "resourceType" = 'RIGHTS_REQUEST' AND "resourceId" = "rightsRequestId"
  )
);
ALTER TABLE "order_notifications" ADD CONSTRAINT "order_notifications_rightsRequestId_fkey"
  FOREIGN KEY ("rightsRequestId") REFERENCES "rights_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "order_notifications_rightsRequestId_kind_channel_idx"
  ON "order_notifications"("rightsRequestId", "kind", "channel");

CREATE TABLE "rights_payment_winners" (
  "rightsRequestId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "selectedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rights_payment_winners_pkey" PRIMARY KEY ("rightsRequestId"),
  CONSTRAINT "rights_payment_winners_request_fkey" FOREIGN KEY ("rightsRequestId")
    REFERENCES "rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rights_payment_winners_payment_fkey" FOREIGN KEY ("paymentId")
    REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "rights_payment_winners_paymentId_key" ON "rights_payment_winners"("paymentId");

CREATE TABLE "rights_licenses" (
  "id" UUID NOT NULL,
  "licenseNumber" VARCHAR(40) NOT NULL,
  "rightsRequestId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "contractDocumentId" UUID NOT NULL,
  "status" "RightsLicenseStatus" NOT NULL DEFAULT 'PAID_WAITING_WITHDRAWAL_PERIOD',
  "contractVersion" INTEGER NOT NULL,
  "termsVersion" VARCHAR(80) NOT NULL,
  "termsHashSha256" CHAR(64) NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
  "paidAt" TIMESTAMPTZ(3) NOT NULL,
  "withdrawalEndsAt" TIMESTAMPTZ(3) NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3),
  "territory" VARCHAR(32) NOT NULL DEFAULT 'WORLD',
  "exclusive" BOOLEAN NOT NULL DEFAULT false,
  "durationYears" INTEGER NOT NULL DEFAULT 5,
  "activatedAt" TIMESTAMPTZ(3),
  "terminatedAt" TIMESTAMPTZ(3),
  "terminationReason" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "rights_licenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rights_licenses_policy" CHECK (
    "territory" = 'WORLD' AND "exclusive" = false AND "durationYears" = 5
  ),
  CONSTRAINT "rights_licenses_dates" CHECK (
    "withdrawalEndsAt" > "paidAt"
    AND (("effectiveAt" IS NULL AND "expiresAt" IS NULL)
      OR ("effectiveAt" IS NOT NULL AND "expiresAt" > "effectiveAt"))
  ),
  CONSTRAINT "rights_licenses_active_dates" CHECK (
    "status" <> 'ACTIVE'
    OR ("effectiveAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "activatedAt" IS NOT NULL)
  ),
  CONSTRAINT "rights_licenses_request_fkey" FOREIGN KEY ("rightsRequestId")
    REFERENCES "rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rights_licenses_payment_fkey" FOREIGN KEY ("paymentId")
    REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rights_licenses_invoice_fkey" FOREIGN KEY ("invoiceId")
    REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rights_licenses_document_fkey" FOREIGN KEY ("contractDocumentId")
    REFERENCES "contract_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "rights_licenses_licenseNumber_key" ON "rights_licenses"("licenseNumber");
CREATE UNIQUE INDEX "rights_licenses_rightsRequestId_key" ON "rights_licenses"("rightsRequestId");
CREATE UNIQUE INDEX "rights_licenses_paymentId_key" ON "rights_licenses"("paymentId");
CREATE UNIQUE INDEX "rights_licenses_invoiceId_key" ON "rights_licenses"("invoiceId");
CREATE UNIQUE INDEX "rights_licenses_contractDocumentId_key" ON "rights_licenses"("contractDocumentId");
CREATE INDEX "rights_licenses_status_withdrawalEndsAt_idx" ON "rights_licenses"("status", "withdrawalEndsAt");

-- Replace the historical blanket V0.7.2 activation ban with a durable proof
-- gate. A RightsRequest or accepted contract can become ACTIVE only after the
-- linked licence row itself has passed every financial and calendar check.
CREATE OR REPLACE FUNCTION "lnx_rights_license_activation_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'ACTIVE' THEN
    IF NEW."effectiveAt" IS NULL
      OR NEW."expiresAt" IS NULL
      OR NEW."activatedAt" IS NULL
      OR NEW."withdrawalEndsAt" > CURRENT_TIMESTAMP
      OR NEW."effectiveAt" <> NEW."withdrawalEndsAt"
      OR NOT EXISTS (
        SELECT 1
        FROM "payments" p
        JOIN "invoices" i ON i."id" = NEW."invoiceId"
        JOIN "contract_documents" d ON d."id" = NEW."contractDocumentId"
        JOIN "rights_requests" r ON r."id" = NEW."rightsRequestId"
        WHERE p."id" = NEW."paymentId"
          AND p."rightsRequestId" = NEW."rightsRequestId"
          AND p."status" = 'SUCCEEDED'
          AND p."paidAt" IS NOT NULL
          AND p."amountCents" = 15000
          AND p."currency" = 'EUR'
          AND i."paymentId" = p."id"
          AND i."rightsRequestId" = r."id"
          AND i."documentType" = 'RIGHTS'
          AND i."totalCents" = 15000
          AND i."currency" = 'EUR'
          AND d."rightsRequestId" = r."id"
          AND d."kind" = 'CONTRACT'
          AND d."status" IN ('ADMIN_VALIDATED', 'ACTIVE')
          AND d."acceptedAt" IS NOT NULL
          AND d."adminAcceptedAt" IS NOT NULL
          AND r."type" = 'PUBLICATION_LICENSE'
          AND r."status" IN ('PAID_WAITING_WITHDRAWAL_PERIOD', 'ACTIVE')
      ) THEN
      RAISE EXCEPTION 'RIGHTS_ACTIVATION_PROOF_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "rights_licenses_activation_guard"
BEFORE INSERT OR UPDATE ON "rights_licenses"
FOR EACH ROW EXECUTE FUNCTION "lnx_rights_license_activation_guard"();

CREATE OR REPLACE FUNCTION "lnx_rights_v072_no_activation"() RETURNS trigger AS $$
BEGIN
  IF NEW."status"::text = 'ACTIVE' THEN
    IF TG_TABLE_NAME = 'rights_requests' AND NOT EXISTS (
      SELECT 1 FROM "rights_licenses" l
      WHERE l."rightsRequestId" = NEW."id" AND l."status" = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'RIGHTS_ACTIVATION_PROOF_REQUIRED';
    END IF;
    IF TG_TABLE_NAME = 'contract_documents' AND NOT EXISTS (
      SELECT 1 FROM "rights_licenses" l
      WHERE l."contractDocumentId" = NEW."id" AND l."status" = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'RIGHTS_ACTIVATION_PROOF_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE "lnx_rights_license_activation_number_seq"
  AS BIGINT START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
