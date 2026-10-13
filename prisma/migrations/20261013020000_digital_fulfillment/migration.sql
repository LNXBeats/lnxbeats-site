-- DCN-1.1 LOCAL/TEST only. Additive: no historical invoice/payment or purchase rewritten.
ALTER TABLE digital_orders ADD COLUMN "contractSnapshot" JSONB;
ALTER TABLE digital_uploads ADD COLUMN "leaseToken" UUID, ADD COLUMN "cleanupAt" TIMESTAMPTZ(3);
ALTER TABLE digital_download_tickets ALTER COLUMN "usesLeft" SET DEFAULT 32;
ALTER TABLE digital_download_tickets DROP CONSTRAINT digital_ticket_valid;
ALTER TABLE digital_download_tickets ADD CONSTRAINT digital_ticket_valid CHECK ("usesLeft" BETWEEN 0 AND 32);
CREATE SEQUENCE digital_test_invoice_sequence;
CREATE SEQUENCE digital_test_credit_note_sequence;

CREATE TABLE digital_documents (
  id UUID PRIMARY KEY, "orderId" UUID NOT NULL REFERENCES digital_orders(id) ON DELETE RESTRICT,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('CONTRACT','INVOICE','CREDIT_NOTE')),
  "businessKey" VARCHAR(255) UNIQUE NOT NULL, number VARCHAR(80) UNIQUE NOT NULL,
  snapshot JSONB NOT NULL, "snapshotHash" CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','READY','RETRY','REQUIRES_REVIEW')),
  pdf BYTEA, "pdfHash" CHAR(64), attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(), "leaseUntil" TIMESTAMPTZ(3), "leaseToken" UUID,
  "errorCode" VARCHAR(80), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CHECK (status<>'READY' OR (pdf IS NOT NULL AND octet_length(pdf) BETWEEN 1 AND 2097152 AND "pdfHash" IS NOT NULL))
);
CREATE INDEX digital_documents_status_availableAt_idx ON digital_documents(status,"availableAt");
CREATE TABLE digital_fulfillments (
  "orderId" UUID PRIMARY KEY REFERENCES digital_orders(id) ON DELETE RESTRICT,
  "confirmationStatus" VARCHAR(24) NOT NULL DEFAULT 'WAITING' CHECK ("confirmationStatus" IN ('WAITING','ACKNOWLEDGED')),
  "confirmationAt" TIMESTAMPTZ(3), "confirmationEvidence" JSONB, "accessReadyAt" TIMESTAMPTZ(3),
  CHECK ("accessReadyAt" IS NULL OR ("confirmationStatus"='ACKNOWLEDGED' AND "confirmationAt" IS NOT NULL AND "confirmationEvidence" IS NOT NULL))
);
CREATE TABLE digital_notifications (
  id UUID PRIMARY KEY, "orderId" UUID NOT NULL REFERENCES digital_orders(id) ON DELETE RESTRICT,
  "businessKey" VARCHAR(255) UNIQUE NOT NULL, kind VARCHAR(30) NOT NULL, recipient VARCHAR(320) NOT NULL,
  template JSONB NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','CAPTURED_QA','SENT','DELIVERED','RETRY','REQUIRES_REVIEW')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5), "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "firstAttemptAt" TIMESTAMPTZ(3), "leaseToken" UUID, "leaseUntil" TIMESTAMPTZ(3),
  "transportId" VARCHAR(180), "capturedAt" TIMESTAMPTZ(3), "sentAt" TIMESTAMPTZ(3), "deliveredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX digital_notifications_status_availableAt_idx ON digital_notifications(status,"availableAt");
CREATE TABLE digital_refunds (
  id UUID PRIMARY KEY, "orderId" UUID NOT NULL REFERENCES digital_orders(id) ON DELETE RESTRICT, "actorId" UUID,
  provider VARCHAR(10) NOT NULL CHECK (provider IN ('STRIPE','PAYPAL')), "paymentReference" VARCHAR(255) NOT NULL,
  "idempotencyKey" VARCHAR(180) UNIQUE NOT NULL, "providerReference" VARCHAR(255) UNIQUE,
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" BETWEEN 1 AND 500000), currency VARCHAR(3) NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  targets JSONB NOT NULL CHECK (jsonb_typeof(targets)='array'), purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('RESOLUTION','PRICE_REDUCTION','EXTERNAL_REVIEW')),
  status VARCHAR(24) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','PENDING','SUCCEEDED','FAILED','REQUIRES_REVIEW')),
  "allocationStatus" VARCHAR(20) NOT NULL DEFAULT 'MATCHED' CHECK ("allocationStatus" IN ('MATCHED','REVIEW')),
  "leaseUntil" TIMESTAMPTZ(3), "confirmedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CHECK (status<>'SUCCEEDED' OR ("confirmedAt" IS NOT NULL AND "providerReference" IS NOT NULL))
);
CREATE INDEX digital_refunds_orderId_status_idx ON digital_refunds("orderId",status);
CREATE TABLE digital_disputes (
  id UUID PRIMARY KEY, "orderId" UUID NOT NULL REFERENCES digital_orders(id) ON DELETE RESTRICT,
  provider VARCHAR(10) NOT NULL CHECK (provider IN ('STRIPE','PAYPAL')), "providerReference" VARCHAR(255) UNIQUE NOT NULL,
  "paymentReference" VARCHAR(255) NOT NULL, "amountCents" INTEGER NOT NULL CHECK ("amountCents">0),
  currency VARCHAR(3) NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  status VARCHAR(24) NOT NULL CHECK (status IN ('OPEN','WON','LOST','REQUIRES_REVIEW')),
  "evidenceHash" CHAR(64) NOT NULL, "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX digital_disputes_orderId_status_idx ON digital_disputes("orderId",status);
CREATE TABLE digital_inbox (
  id UUID PRIMARY KEY, "orderId" UUID REFERENCES digital_orders(id) ON DELETE RESTRICT,
  provider VARCHAR(10) NOT NULL CHECK (provider IN ('STRIPE','PAYPAL')), "eventId" VARCHAR(180) NOT NULL,
  "eventType" VARCHAR(100) NOT NULL, payload JSONB NOT NULL, "bodyHash" CHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','PROCESSED','RETRY','REQUIRES_REVIEW','IGNORED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8), "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "leaseUntil" TIMESTAMPTZ(3), "leaseToken" UUID, "errorCode" VARCHAR(80), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  UNIQUE(provider,"eventId")
);
CREATE INDEX digital_inbox_status_availableAt_idx ON digital_inbox(status,"availableAt");
CREATE TABLE digital_work_slots (
  id VARCHAR(20) PRIMARY KEY CHECK (id IN ('audio-0','audio-1','zip-0')), "jobId" UUID, "leaseToken" UUID, "leaseUntil" TIMESTAMPTZ(3)
);
INSERT INTO digital_work_slots(id) VALUES('audio-0'),('audio-1'),('zip-0');
CREATE TABLE digital_archives (
  id UUID PRIMARY KEY, "lineId" UUID UNIQUE NOT NULL REFERENCES digital_order_lines(id) ON DELETE RESTRICT,
  "snapshotHash" CHAR(64) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','READY','REQUIRES_REVIEW')),
  "storageKey" VARCHAR(500), "storageBackend" VARCHAR(12), "storageProvider" VARCHAR(20), "sizeBytes" BIGINT, checksum CHAR(64), "leaseToken" UUID, "leaseUntil" TIMESTAMPTZ(3),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3), "errorCode" VARCHAR(80), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CHECK (status<>'READY' OR ("storageKey" IS NOT NULL AND "sizeBytes" BETWEEN 1 AND 4294967295 AND checksum IS NOT NULL))
);
CREATE INDEX digital_archives_status_leaseUntil_idx ON digital_archives(status,"leaseUntil");

-- Enforce immutable commercial snapshots even if an owner tool mistakenly attempts a rewrite.
CREATE FUNCTION digital_preserve_document_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW."orderId",NEW.kind,NEW."businessKey",NEW.number,NEW.snapshot,NEW."snapshotHash",NEW."createdAt")
     IS DISTINCT FROM (OLD.id,OLD."orderId",OLD.kind,OLD."businessKey",OLD.number,OLD.snapshot,OLD."snapshotHash",OLD."createdAt")
     OR (OLD.status='READY' AND (NEW.status,NEW.pdf,NEW."pdfHash") IS DISTINCT FROM (OLD.status,OLD.pdf,OLD."pdfHash")) THEN
    RAISE EXCEPTION 'immutable digital document' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER digital_document_immutable BEFORE UPDATE ON digital_documents FOR EACH ROW EXECUTE FUNCTION digital_preserve_document_snapshot();
CREATE FUNCTION digital_preserve_contract_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."contractSnapshot" IS DISTINCT FROM OLD."contractSnapshot" THEN
    RAISE EXCEPTION 'immutable digital contract' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER digital_contract_immutable BEFORE UPDATE ON digital_orders FOR EACH ROW EXECUTE FUNCTION digital_preserve_contract_snapshot();
CREATE OR REPLACE FUNCTION digital_verify_entitlement_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM digital_order_lines l JOIN digital_orders o ON o.id=l."orderId"
    WHERE l.id=NEW."lineId" AND o."userId"=NEW."userId" AND EXISTS
      (SELECT 1 FROM jsonb_array_elements(l."trackSnapshot") t WHERE t->>'masterId'=NEW."masterId"::text)) THEN
    RAISE EXCEPTION 'digital entitlement owner or acquired version mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
