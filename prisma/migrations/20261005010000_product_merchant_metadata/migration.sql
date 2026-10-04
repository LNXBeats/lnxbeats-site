-- Optional factual Merchant attributes; existing catalogue and commerce data remain intact.
ALTER TABLE "products"
  ADD COLUMN "merchantMpn" VARCHAR(70),
  ADD COLUMN "merchantGtin" VARCHAR(14),
  ADD COLUMN "merchantColor" VARCHAR(100),
  ADD COLUMN "merchantIdentifiersAbsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_identifiers_consistent"
  CHECK (NOT "merchantIdentifiersAbsent" OR ("merchantMpn" IS NULL AND "merchantGtin" IS NULL));
