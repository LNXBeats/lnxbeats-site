-- Extend only the digital domain. No offer, approval, price, payment or history is inserted.
ALTER TABLE digital_orders DROP CONSTRAINT digital_order_valid;
ALTER TABLE digital_orders ADD CONSTRAINT digital_order_valid CHECK (
  mode IN ('TEST','LIVE') AND currency='EUR' AND "cartRevision">=0 AND (
    ("totalCents" BETWEEN 1 AND 500000 AND status IN ('PENDING','PAID','FAILED','REQUIRES_REVIEW','PARTIALLY_REFUNDED','REFUNDED','DISPUTED'))
    OR ("totalCents"=0 AND status IN ('GRANTED','REQUIRES_REVIEW')
      AND COALESCE("contractSnapshot"->'acquisition'->>'kind'='FREE_ALBUM_COMPLETION',false))
  ) AND (mode='TEST' OR COALESCE(
    "contractSnapshot"->>'mode'='LIVE'
    AND "contractSnapshot"->>'policy'='DCN-FRANCE-LIVE-EXPLICIT-RECEIPT-1'
    AND "contractSnapshot"->>'approvedForLive'='true'
    AND "contractSnapshot"->'terms'->>'status'='APPROVED'
    AND "jurisdictionSnapshot"->>'approvalScope'='LIVE'
    AND "jurisdictionSnapshot"->>'countryCode'='FR'
    AND "jurisdictionSnapshot"->>'subdivisionCode'='FR-MET',false))
);

-- Never convert a TEST receipt into LIVE or change an acquired financial identity.
CREATE FUNCTION digital_preserve_order_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW."userId",NEW."idempotencyKey",NEW."cartRevision",NEW.mode,NEW.currency,
      NEW."totalCents",NEW."termsVersion",NEW."termsHash",NEW."earlyDelivery",NEW."withdrawalAcknowledged")
    IS DISTINCT FROM
     (OLD.id,OLD."userId",OLD."idempotencyKey",OLD."cartRevision",OLD.mode,OLD.currency,
      OLD."totalCents",OLD."termsVersion",OLD."termsHash",OLD."earlyDelivery",OLD."withdrawalAcknowledged") THEN
    RAISE EXCEPTION 'immutable digital order identity' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER digital_order_identity_immutable BEFORE UPDATE ON digital_orders
  FOR EACH ROW EXECUTE FUNCTION digital_preserve_order_identity();

-- LIVE documents reuse the established invoice_sequence/credit_note_sequence.
-- TEST sequences remain untouched. Scoped USAGE is granted by the reviewed runtime provisioner.
