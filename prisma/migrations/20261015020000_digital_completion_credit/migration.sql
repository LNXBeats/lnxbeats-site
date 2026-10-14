-- Additive DCN only. Historical line snapshots and documents remain unchanged.
ALTER TABLE digital_order_lines ADD COLUMN "completionSnapshot" JSONB;
CREATE TABLE digital_completion_credits (
  id UUID PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "trackId" UUID NOT NULL REFERENCES tracks(id) ON DELETE RESTRICT,
  "sourceLineId" UUID NOT NULL REFERENCES digital_order_lines(id) ON DELETE RESTRICT,
  "targetLineId" UUID NOT NULL REFERENCES digital_order_lines(id) ON DELETE RESTRICT,
  "amountCents" INTEGER NOT NULL,
  "sourceNetCents" INTEGER NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'RESERVED',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT digital_completion_credit_valid CHECK (
    status IN ('RESERVED','CONSUMED','RELEASED') AND "amountCents">0
    AND "sourceNetCents">="amountCents" AND "sourceLineId"<>"targetLineId")
);
CREATE UNIQUE INDEX "digital_completion_credits_targetLineId_trackId_key" ON digital_completion_credits("targetLineId","trackId");
CREATE INDEX "digital_completion_credits_userId_trackId_status_idx" ON digital_completion_credits("userId","trackId",status);
CREATE INDEX "digital_completion_credits_sourceLineId_status_idx" ON digital_completion_credits("sourceLineId",status);
CREATE UNIQUE INDEX digital_completion_credit_once ON digital_completion_credits("userId","trackId") WHERE status IN ('RESERVED','CONSUMED');

CREATE FUNCTION digital_verify_completion_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.id,NEW."userId",NEW."trackId",NEW."sourceLineId",NEW."targetLineId",NEW."amountCents",NEW."sourceNetCents",NEW."createdAt")
    IS DISTINCT FROM (OLD.id,OLD."userId",OLD."trackId",OLD."sourceLineId",OLD."targetLineId",OLD."amountCents",OLD."sourceNetCents",OLD."createdAt") THEN
    RAISE EXCEPTION 'immutable completion credit proof' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (OLD.status='CONSUMED' AND NEW.status<>'CONSUMED' OR OLD.status='RELEASED' AND NEW.status<>'RELEASED') THEN
    RAISE EXCEPTION 'terminal completion credit' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM digital_order_lines s JOIN digital_orders so ON so.id=s."orderId"
    JOIN digital_order_lines t ON t.id=NEW."targetLineId" JOIN digital_orders o ON o.id=t."orderId"
    WHERE s.id=NEW."sourceLineId" AND s.scope='TRACK' AND t.scope='ALBUM'
    AND so."userId"=NEW."userId" AND o."userId"=NEW."userId"
    AND so.currency='EUR' AND o.currency='EUR' AND so.mode=o.mode
    AND jsonb_array_length(s."trackSnapshot")=1
    AND s."trackSnapshot"->0->>'trackId'=NEW."trackId"::text
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(t."trackSnapshot") a WHERE a->>'trackId'=NEW."trackId"::text AND a->>'masterId'=s."trackSnapshot"->0->>'masterId')
  ) THEN RAISE EXCEPTION 'completion credit owner/content mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER digital_completion_credit_proof BEFORE INSERT OR UPDATE ON digital_completion_credits FOR EACH ROW EXECUTE FUNCTION digital_verify_completion_credit();
CREATE FUNCTION digital_preserve_completion_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."completionSnapshot" IS DISTINCT FROM OLD."completionSnapshot" THEN
    RAISE EXCEPTION 'immutable completion snapshot' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER digital_completion_snapshot_immutable BEFORE UPDATE ON digital_order_lines FOR EACH ROW EXECUTE FUNCTION digital_preserve_completion_snapshot();
