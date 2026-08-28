CREATE TYPE "BillingCustomerType" AS ENUM ('INDIVIDUAL', 'PROFESSIONAL');
CREATE TYPE "InvoiceDocumentType" AS ENUM ('MUSIC', 'SHOP');
CREATE TYPE "InvoiceOperationCategory" AS ENUM ('SERVICES', 'GOODS');
CREATE TYPE "InvoiceVatRegime" AS ENUM ('FRANCHISE_EN_BASE_TVA', 'VAT_LIABLE');
CREATE TYPE "CreditNoteReasonCode" AS ENUM ('WITHDRAWAL', 'NON_CONFORMITY', 'SELLER_ERROR', 'DAMAGED_PRODUCT', 'OTHER_REVIEWED');
CREATE TYPE "BillingAuditAction" AS ENUM ('INVOICE_ISSUED', 'INVOICE_PDF_GENERATED', 'CREDIT_NOTE_ISSUED', 'CREDIT_NOTE_PDF_GENERATED');

CREATE SEQUENCE "invoice_sequence" AS BIGINT START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE "credit_note_sequence" AS BIGINT START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE "invoices" (
  "id" UUID NOT NULL,
  "invoiceNumber" VARCHAR(48) NOT NULL,
  "sequenceNumber" BIGINT NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL,
  "documentType" "InvoiceDocumentType" NOT NULL,
  "operationCategory" "InvoiceOperationCategory" NOT NULL,
  "orderId" UUID,
  "shopOrderId" UUID,
  "paymentId" UUID NOT NULL,
  "orderNumberSnapshot" VARCHAR(32) NOT NULL,
  "customerType" "BillingCustomerType" NOT NULL,
  "customerNameSearch" VARCHAR(240) NOT NULL,
  "customerEmailSearch" VARCHAR(320) NOT NULL,
  "sellerSnapshot" JSONB NOT NULL,
  "customerSnapshot" JSONB NOT NULL,
  "lineItemsSnapshot" JSONB NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "subtotalCents" INTEGER NOT NULL,
  "shippingCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL,
  "vatRegime" "InvoiceVatRegime" NOT NULL,
  "vatAmountCents" INTEGER NOT NULL DEFAULT 0,
  "vatLegalNotice" VARCHAR(240) NOT NULL,
  "paymentMethodLabel" VARCHAR(120) NOT NULL,
  "paidAt" TIMESTAMPTZ(3) NOT NULL,
  "termsVersion" VARCHAR(80),
  "termsHashSha256" CHAR(64),
  "snapshotHashSha256" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoices_parent_xor" CHECK (("orderId" IS NOT NULL)::int + ("shopOrderId" IS NOT NULL)::int = 1),
  CONSTRAINT "invoices_currency_eur" CHECK ("currency" = 'EUR'),
  CONSTRAINT "invoices_amounts_nonnegative" CHECK ("subtotalCents" >= 0 AND "shippingCents" >= 0 AND "totalCents" > 0 AND "vatAmountCents" >= 0),
  CONSTRAINT "invoices_total_consistent" CHECK ("subtotalCents" + "shippingCents" = "totalCents"),
  CONSTRAINT "invoices_franchise_vat_zero" CHECK ("vatRegime" <> 'FRANCHISE_EN_BASE_TVA' OR "vatAmountCents" = 0),
  CONSTRAINT "invoices_terms_pair" CHECK (("termsVersion" IS NULL) = ("termsHashSha256" IS NULL))
);

CREATE TABLE "credit_notes" (
  "id" UUID NOT NULL,
  "creditNoteNumber" VARCHAR(52) NOT NULL,
  "sequenceNumber" BIGINT NOT NULL,
  "invoiceId" UUID NOT NULL,
  "refundAttemptId" UUID,
  "withdrawalRequestId" UUID,
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "cumulativeCreditedCents" INTEGER NOT NULL,
  "remainingBalanceCents" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "reasonCode" "CreditNoteReasonCode" NOT NULL,
  "reasonText" VARCHAR(500),
  "snapshotHashSha256" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credit_notes_amount_positive" CHECK ("amountCents" > 0),
  CONSTRAINT "credit_notes_balance_consistent" CHECK (
    "cumulativeCreditedCents" >= "amountCents"
    AND "remainingBalanceCents" >= 0
  ),
  CONSTRAINT "credit_notes_currency_eur" CHECK ("currency" = 'EUR'),
  CONSTRAINT "credit_notes_reason_text_length" CHECK ("reasonText" IS NULL OR char_length("reasonText") <= 500)
);

CREATE TABLE "billing_audit_events" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "creditNoteId" UUID,
  "actorUserId" UUID,
  "action" "BillingAuditAction" NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");
CREATE UNIQUE INDEX "invoices_sequenceNumber_key" ON "invoices"("sequenceNumber");
CREATE UNIQUE INDEX "invoices_orderId_key" ON "invoices"("orderId");
CREATE UNIQUE INDEX "invoices_shopOrderId_key" ON "invoices"("shopOrderId");
CREATE UNIQUE INDEX "invoices_paymentId_key" ON "invoices"("paymentId");
CREATE UNIQUE INDEX "invoices_snapshotHashSha256_key" ON "invoices"("snapshotHashSha256");
CREATE INDEX "invoices_documentType_issuedAt_idx" ON "invoices"("documentType", "issuedAt");
CREATE INDEX "invoices_customerNameSearch_issuedAt_idx" ON "invoices"("customerNameSearch", "issuedAt");
CREATE INDEX "invoices_customerEmailSearch_issuedAt_idx" ON "invoices"("customerEmailSearch", "issuedAt");

CREATE UNIQUE INDEX "credit_notes_creditNoteNumber_key" ON "credit_notes"("creditNoteNumber");
CREATE UNIQUE INDEX "credit_notes_sequenceNumber_key" ON "credit_notes"("sequenceNumber");
CREATE UNIQUE INDEX "credit_notes_refundAttemptId_key" ON "credit_notes"("refundAttemptId");
CREATE UNIQUE INDEX "credit_notes_idempotencyKey_key" ON "credit_notes"("idempotencyKey");
CREATE UNIQUE INDEX "credit_notes_snapshotHashSha256_key" ON "credit_notes"("snapshotHashSha256");
CREATE INDEX "credit_notes_invoiceId_issuedAt_idx" ON "credit_notes"("invoiceId", "issuedAt");
CREATE INDEX "credit_notes_withdrawalRequestId_idx" ON "credit_notes"("withdrawalRequestId");

CREATE INDEX "billing_audit_events_invoiceId_createdAt_idx" ON "billing_audit_events"("invoiceId", "createdAt");
CREATE INDEX "billing_audit_events_creditNoteId_createdAt_idx" ON "billing_audit_events"("creditNoteId", "createdAt");
CREATE INDEX "billing_audit_events_actorUserId_idx" ON "billing_audit_events"("actorUserId");

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shopOrderId_fkey" FOREIGN KEY ("shopOrderId") REFERENCES "shop_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_refundAttemptId_fkey" FOREIGN KEY ("refundAttemptId") REFERENCES "refund_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_withdrawalRequestId_fkey" FOREIGN KEY ("withdrawalRequestId") REFERENCES "consumer_withdrawal_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "credit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_issued_billing_document_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Issued billing documents are immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "invoices_immutable" BEFORE UPDATE OR DELETE ON "invoices"
FOR EACH ROW EXECUTE FUNCTION "reject_issued_billing_document_mutation"();

CREATE TRIGGER "credit_notes_immutable" BEFORE UPDATE OR DELETE ON "credit_notes"
FOR EACH ROW EXECUTE FUNCTION "reject_issued_billing_document_mutation"();
