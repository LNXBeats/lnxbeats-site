-- V0.7.4 extends the existing provider-neutral ledger to PayPal Sandbox.
-- The successful-payment constraint remains global per Order. Active
-- preparation is provider-scoped so two browser tabs may create one Stripe
-- and one PayPal attempt while the first verified success still wins.
ALTER TYPE "PaymentProvider" ADD VALUE 'PAYPAL';

DROP INDEX "payments_one_active_per_order_idx";

CREATE UNIQUE INDEX "payments_one_active_per_order_idx"
  ON "payments"("orderId", "provider")
  WHERE "status" IN ('CREATED', 'PENDING', 'REQUIRES_REVIEW')
     OR ("status" = 'FAILED' AND "failureCode" = 'STRIPE_PAYMENT_ATTEMPT_FAILED');
