-- Extend the append-only audit's reason vocabulary, never rewrite receipts/data.
-- One atomic ALTER: the expired/unpaid reason remains valid, all others refused.
ALTER TABLE "provider_event_technical_reviews"
  DROP CONSTRAINT "provider_event_technical_reviews_reason_check",
  ADD CONSTRAINT "provider_event_technical_reviews_reason_check"
    CHECK ("reason" IN ('EXPIRED_UNPAID_SUPPORT_CHECKOUT', 'SUPPORT_PAYMENT_RECONCILED'));
