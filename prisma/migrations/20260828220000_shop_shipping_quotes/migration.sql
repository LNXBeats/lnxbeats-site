-- V1.1.0 Phase 5A: additive, internal-only shipping quote foundation.
-- No carrier API, real tariff, credential, label or Production activation is
-- introduced here. Historical Product and ShopOrder shipping snapshots remain
-- valid and are never backfilled with invented weights.

CREATE TYPE "ShippingRateVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "ShippingRateScope" AS ENUM ('INTERNAL_QA');
CREATE TYPE "ShippingService" AS ENUM ('STANDARD_TRACKED_SIGNATURE');

ALTER TABLE "products"
  ADD COLUMN "shippingWeightGrams" INTEGER;

ALTER TABLE "products"
  ADD CONSTRAINT "products_shipping_weight_valid" CHECK (
    "shippingWeightGrams" IS NULL
    OR ("shippingWeightGrams" >= 1 AND "shippingWeightGrams" <= 30000)
  );

CREATE TABLE "shipping_rate_versions" (
  "id" UUID NOT NULL,
  "version" VARCHAR(64) NOT NULL,
  "status" "ShippingRateVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "scope" "ShippingRateScope" NOT NULL DEFAULT 'INTERNAL_QA',
  "service" "ShippingService" NOT NULL DEFAULT 'STANDARD_TRACKED_SIGNATURE',
  "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
  "countryCode" CHAR(2) NOT NULL DEFAULT 'FR',
  "minimumBillableWeightGrams" INTEGER NOT NULL DEFAULT 150,
  "packagingWeightGrams" INTEGER NOT NULL DEFAULT 0,
  "activatedAt" TIMESTAMPTZ(3),
  "retiredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "shipping_rate_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipping_rate_versions_version_nonempty" CHECK (btrim("version") <> ''),
  CONSTRAINT "shipping_rate_versions_currency_eur" CHECK ("currency" = 'EUR'),
  CONSTRAINT "shipping_rate_versions_country_fr" CHECK ("countryCode" = 'FR'),
  CONSTRAINT "shipping_rate_versions_weights_valid" CHECK (
    "minimumBillableWeightGrams" >= 1
    AND "minimumBillableWeightGrams" <= 1000000
    AND "packagingWeightGrams" >= 0
    AND "packagingWeightGrams" <= 1000000
  ),
  CONSTRAINT "shipping_rate_versions_status_timestamps" CHECK (
    (
      "status" = 'DRAFT'
      AND "activatedAt" IS NULL
      AND "retiredAt" IS NULL
    )
    OR (
      "status" = 'ACTIVE'
      AND "activatedAt" IS NOT NULL
      AND "retiredAt" IS NULL
    )
    OR (
      "status" = 'RETIRED'
      AND "activatedAt" IS NOT NULL
      AND "retiredAt" IS NOT NULL
      AND "retiredAt" >= "activatedAt"
    )
  )
);

CREATE UNIQUE INDEX "shipping_rate_versions_version_key"
  ON "shipping_rate_versions"("version");
CREATE UNIQUE INDEX "shipping_rate_versions_one_active_qa_idx"
  ON "shipping_rate_versions"("scope")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "shipping_rate_versions_status_scope_createdAt_idx"
  ON "shipping_rate_versions"("status", "scope", "createdAt");

CREATE TABLE "shipping_rate_tiers" (
  "id" UUID NOT NULL,
  "shippingRateVersionId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "maxWeightGrams" INTEGER NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shipping_rate_tiers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipping_rate_tiers_position_valid" CHECK (
    "position" >= 0 AND "position" <= 100
  ),
  CONSTRAINT "shipping_rate_tiers_weight_valid" CHECK (
    "maxWeightGrams" >= 1 AND "maxWeightGrams" <= 1000000
  ),
  CONSTRAINT "shipping_rate_tiers_price_valid" CHECK (
    "priceCents" > 0 AND "priceCents" <= 100000000
  )
);

CREATE UNIQUE INDEX "shipping_rate_tiers_version_position_key"
  ON "shipping_rate_tiers"("shippingRateVersionId", "position");
CREATE UNIQUE INDEX "shipping_rate_tiers_version_maxWeight_key"
  ON "shipping_rate_tiers"("shippingRateVersionId", "maxWeightGrams");
CREATE INDEX "shipping_rate_tiers_version_maxWeight_idx"
  ON "shipping_rate_tiers"("shippingRateVersionId", "maxWeightGrams");

ALTER TABLE "shipping_rate_tiers"
  ADD CONSTRAINT "shipping_rate_tiers_version_fkey"
  FOREIGN KEY ("shippingRateVersionId") REFERENCES "shipping_rate_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shop_orders"
  ADD COLUMN "shippingRateVersionId" UUID,
  ADD COLUMN "shippingQuoteVersion" VARCHAR(64),
  ADD COLUMN "shippingMethod" VARCHAR(80),
  ADD COLUMN "shippingWeightGrams" INTEGER,
  ADD COLUMN "shippingPackagingGrams" INTEGER,
  ADD COLUMN "shippingBillableGrams" INTEGER;

ALTER TABLE "shop_orders"
  ADD CONSTRAINT "shop_orders_shipping_quote_snapshot" CHECK (
    (
      "shippingRateVersionId" IS NULL
      AND "shippingQuoteVersion" IS NULL
      AND "shippingMethod" IS NULL
      AND "shippingWeightGrams" IS NULL
      AND "shippingPackagingGrams" IS NULL
      AND "shippingBillableGrams" IS NULL
    )
    OR (
      "shippingRequired" = true
      AND "shippingRateVersionId" IS NOT NULL
      AND "shippingQuoteVersion" IS NOT NULL
      AND btrim("shippingQuoteVersion") <> ''
      AND "shippingMethod" IS NOT NULL
      AND btrim("shippingMethod") <> ''
      AND "shippingWeightGrams" IS NOT NULL
      AND "shippingWeightGrams" > 0
      AND "shippingWeightGrams" <= 1000000
      AND "shippingPackagingGrams" IS NOT NULL
      AND "shippingPackagingGrams" >= 0
      AND "shippingPackagingGrams" <= 1000000
      AND "shippingBillableGrams" IS NOT NULL
      AND "shippingBillableGrams" >= "shippingWeightGrams" + "shippingPackagingGrams"
      AND "shippingBillableGrams" <= 1000000
      AND "shippingCents" > 0
    )
  );

CREATE INDEX "shop_orders_shippingRateVersionId_idx"
  ON "shop_orders"("shippingRateVersionId");

ALTER TABLE "shop_orders"
  ADD CONSTRAINT "shop_orders_shippingRateVersionId_fkey"
  FOREIGN KEY ("shippingRateVersionId") REFERENCES "shipping_rate_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shop_order_items"
  ADD COLUMN "unitShippingWeightGrams" INTEGER,
  ADD COLUMN "lineShippingWeightGrams" INTEGER;

ALTER TABLE "shop_order_items"
  ADD CONSTRAINT "shop_order_items_shipping_weight_snapshot" CHECK (
    (
      "unitShippingWeightGrams" IS NULL
      AND "lineShippingWeightGrams" IS NULL
    )
    OR (
      "shippingRequired" = true
      AND "unitShippingWeightGrams" IS NOT NULL
      AND "unitShippingWeightGrams" > 0
      AND "unitShippingWeightGrams" <= 30000
      AND "lineShippingWeightGrams" IS NOT NULL
      AND "lineShippingWeightGrams"::BIGINT =
        "unitShippingWeightGrams"::BIGINT * "quantity"::BIGINT
      AND "lineShippingWeightGrams" <= 1000000
    )
  );

-- A rate definition can be retired after use, but its financial and weight
-- interpretation cannot be rewritten once a ShopOrder references it.
CREATE FUNCTION prevent_used_shipping_rate_definition_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "shop_orders"
    WHERE "shippingRateVersionId" = OLD."id"
  ) AND (
    OLD."version" IS DISTINCT FROM NEW."version"
    OR OLD."scope" IS DISTINCT FROM NEW."scope"
    OR OLD."service" IS DISTINCT FROM NEW."service"
    OR OLD."currency" IS DISTINCT FROM NEW."currency"
    OR OLD."countryCode" IS DISTINCT FROM NEW."countryCode"
    OR OLD."minimumBillableWeightGrams" IS DISTINCT FROM NEW."minimumBillableWeightGrams"
    OR OLD."packagingWeightGrams" IS DISTINCT FROM NEW."packagingWeightGrams"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'shipping_rate_versions_used_definition_immutable',
      MESSAGE = 'A used shipping rate definition is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "shipping_rate_versions_used_definition_immutable_trigger"
  BEFORE UPDATE ON "shipping_rate_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_used_shipping_rate_definition_update();

CREATE FUNCTION prevent_used_shipping_rate_tier_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rate_version_id UUID;
BEGIN
  rate_version_id := COALESCE(NEW."shippingRateVersionId", OLD."shippingRateVersionId");
  IF EXISTS (
    SELECT 1 FROM "shop_orders"
    WHERE "shippingRateVersionId" = rate_version_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'shipping_rate_tiers_used_immutable',
      MESSAGE = 'Tiers of a used shipping rate version are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "shipping_rate_tiers_used_immutable_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "shipping_rate_tiers"
  FOR EACH ROW EXECUTE FUNCTION prevent_used_shipping_rate_tier_mutation();
