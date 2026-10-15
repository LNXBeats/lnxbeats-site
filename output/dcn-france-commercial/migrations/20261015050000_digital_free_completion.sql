-- Additive, TEST-only free album completion. No historical row is rewritten.
ALTER TABLE digital_orders DROP CONSTRAINT digital_order_valid;
ALTER TABLE digital_orders ADD CONSTRAINT digital_order_valid CHECK (
  mode='TEST' AND currency='EUR' AND "cartRevision">=0 AND (
    ("totalCents" BETWEEN 1 AND 500000 AND status IN ('PENDING','PAID','FAILED','REQUIRES_REVIEW','PARTIALLY_REFUNDED','REFUNDED','DISPUTED'))
    OR ("totalCents"=0 AND status IN ('GRANTED','REQUIRES_REVIEW')
      AND COALESCE("contractSnapshot"->'acquisition'->>'kind'='FREE_ALBUM_COMPLETION',false))
  ));
ALTER TABLE digital_order_lines DROP CONSTRAINT digital_order_line_valid;
ALTER TABLE digital_order_lines ADD CONSTRAINT digital_order_line_valid CHECK (
  scope IN ('ALBUM','TRACK') AND "offerVersion">0
  AND jsonb_typeof("trackSnapshot")='array' AND jsonb_array_length("trackSnapshot")>0
  AND ("priceCents" BETWEEN 1 AND 100000 OR ("priceCents"=0 AND scope='ALBUM'
    AND COALESCE("completionSnapshot"->>'version'='2'
    AND ("completionSnapshot"->>'basePriceCents')::integer BETWEEN 1 AND 100000
    AND "completionSnapshot"->>'creditCents'="completionSnapshot"->>'basePriceCents'
    AND ("completionSnapshot"->>'eligibleCents')::integer >= ("completionSnapshot"->>'basePriceCents')::integer,false))));
ALTER TABLE digital_cart_lines DROP CONSTRAINT digital_cart_line_valid;
ALTER TABLE digital_cart_lines ADD CONSTRAINT digital_cart_line_valid CHECK ("priceCents">=0 AND "offerVersion">0);

CREATE FUNCTION digital_verify_free_completion_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='digital_order_lines' THEN
    IF NEW."priceCents"=0 AND NOT EXISTS (SELECT 1 FROM digital_orders o WHERE o.id=NEW."orderId" AND o."totalCents"=0
      AND o."contractSnapshot"->'acquisition'->>'kind'='FREE_ALBUM_COMPLETION') THEN
      RAISE EXCEPTION 'zero line requires explicit free album completion' USING ERRCODE='23514';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM digital_orders o WHERE o.id=NEW."orderId" AND o."totalCents"=0) THEN
    IF TG_TABLE_NAME='digital_payment_attempts' THEN
      RAISE EXCEPTION 'free album completion cannot create payment or invoice' USING ERRCODE='23514';
    ELSIF NEW.kind<>'CONTRACT' THEN
      RAISE EXCEPTION 'free album completion cannot create payment or invoice' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER digital_free_line_boundary BEFORE INSERT ON digital_order_lines FOR EACH ROW EXECUTE FUNCTION digital_verify_free_completion_boundary();
CREATE TRIGGER digital_free_payment_boundary BEFORE INSERT ON digital_payment_attempts FOR EACH ROW EXECUTE FUNCTION digital_verify_free_completion_boundary();
CREATE TRIGGER digital_free_document_boundary BEFORE INSERT ON digital_documents FOR EACH ROW EXECUTE FUNCTION digital_verify_free_completion_boundary();
