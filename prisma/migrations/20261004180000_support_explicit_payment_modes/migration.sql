-- No row rewrite. Historical TEST data remains TEST; the application supplies
-- the deployment mode explicitly and refuses cross-environment settlement.
-- No change to other payment domains, ownership, ACLs or immutable amounts.
ALTER TABLE "support_contributions"
  DROP CONSTRAINT "support_test_only",
  ADD CONSTRAINT "support_payment_mode" CHECK ("mode" IN ('TEST', 'LIVE'));
