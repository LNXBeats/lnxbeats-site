-- Additive DCN extension. No historical request, acquisition, document or email is rewritten.
ALTER TYPE "ConsumerContractType" ADD VALUE 'DIGITAL_ORDER';
ALTER TABLE consumer_withdrawal_requests
  ADD COLUMN "digitalOrderId" UUID REFERENCES digital_orders(id) ON DELETE RESTRICT,
  ADD COLUMN "requestKind" VARCHAR(20) NOT NULL DEFAULT 'WITHDRAWAL',
  ADD COLUMN "reviewReason" VARCHAR(2000),
  ADD CONSTRAINT consumer_request_kind CHECK ("requestKind" IN ('WITHDRAWAL','NON_CONFORMITY','GOODWILL')),
  ADD CONSTRAINT consumer_request_review_reason CHECK ("reviewReason" IS NULL OR length(btrim("reviewReason")) BETWEEN 10 AND 2000);
ALTER TABLE consumer_withdrawal_requests DROP CONSTRAINT consumer_withdrawal_requests_parent_scope;
-- Cast to text permits a newly added enum value before this migration commits.
ALTER TABLE consumer_withdrawal_requests ADD CONSTRAINT consumer_withdrawal_requests_parent_scope CHECK (
  ("identityMatch"='UNMATCHED' AND "orderId" IS NULL AND "shopOrderId" IS NULL AND "digitalOrderId" IS NULL)
  OR ("identityMatch"='MATCHED' AND "contractType"::text='MUSIC_ORDER' AND "orderId" IS NOT NULL AND "shopOrderId" IS NULL AND "digitalOrderId" IS NULL)
  OR ("identityMatch"='MATCHED' AND "contractType"::text='SHOP_ORDER' AND "orderId" IS NULL AND "shopOrderId" IS NOT NULL AND "digitalOrderId" IS NULL)
  OR ("identityMatch"='MATCHED' AND "contractType"::text='DIGITAL_ORDER' AND "orderId" IS NULL AND "shopOrderId" IS NULL AND "digitalOrderId" IS NOT NULL)
);
CREATE INDEX "consumer_withdrawal_requests_digitalOrderId_receivedAt_idx" ON consumer_withdrawal_requests("digitalOrderId","receivedAt");
ALTER TABLE digital_notifications ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE digital_notifications ADD COLUMN "withdrawalRequestId" UUID REFERENCES consumer_withdrawal_requests(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE digital_notifications ADD CONSTRAINT digital_notification_parent CHECK (
  ("orderId" IS NOT NULL AND "withdrawalRequestId" IS NULL AND kind <> 'CONSUMER_REQUEST_ACK')
  OR ("orderId" IS NULL AND "withdrawalRequestId" IS NOT NULL AND kind='CONSUMER_REQUEST_ACK')
);
-- The durable original acknowledgement cannot be rewritten by an owner tool.
CREATE FUNCTION consumer_preserve_acknowledgement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW."requestNumber",NEW."acknowledgementSnapshot",NEW."acknowledgementHashSha256",NEW."acknowledgementCreatedAt",NEW."receivedAt",NEW."contractType",NEW."requestKind",NEW."claimedOrderReference",NEW."claimantFirstName",NEW."claimantLastName",NEW."claimantEmail",NEW."productDescription",NEW.quantity,NEW.reason,NEW."declarationText",NEW."deduplicationHashSha256",NEW."orderId",NEW."shopOrderId",NEW."digitalOrderId",NEW."identityMatch",NEW."termsVersion")
    IS DISTINCT FROM
    (OLD.id,OLD."requestNumber",OLD."acknowledgementSnapshot",OLD."acknowledgementHashSha256",OLD."acknowledgementCreatedAt",OLD."receivedAt",OLD."contractType",OLD."requestKind",OLD."claimedOrderReference",OLD."claimantFirstName",OLD."claimantLastName",OLD."claimantEmail",OLD."productDescription",OLD.quantity,OLD.reason,OLD."declarationText",OLD."deduplicationHashSha256",OLD."orderId",OLD."shopOrderId",OLD."digitalOrderId",OLD."identityMatch",OLD."termsVersion") THEN
    RAISE EXCEPTION 'immutable consumer acknowledgement' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER consumer_acknowledgement_immutable BEFORE UPDATE ON consumer_withdrawal_requests FOR EACH ROW EXECUTE FUNCTION consumer_preserve_acknowledgement();
