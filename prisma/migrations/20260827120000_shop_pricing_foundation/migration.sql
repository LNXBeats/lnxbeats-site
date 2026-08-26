-- V1.1.0 Phase 1: additive Admin foundations for versioned music pricing and
-- physical/digital products. Existing Orders and their immutable price
-- snapshots are intentionally untouched. No ShopOrder or Payment relation is
-- introduced by this migration.

CREATE TYPE "MusicPricingStatus" AS ENUM ('ACTIVE', 'RETIRED');
CREATE TYPE "MusicPricingSource" AS ENUM ('IMPORTED', 'ADMIN');
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "ProductAuditAction" AS ENUM (
  'CREATED',
  'UPDATED',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
  'STOCK_ADJUSTED'
);

CREATE TABLE "music_pricing_versions" (
  "id" UUID NOT NULL,
  "version" VARCHAR(32) NOT NULL,
  "status" "MusicPricingStatus" NOT NULL DEFAULT 'RETIRED',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "basePriceCents" INTEGER NOT NULL,
  "coverPriceCents" INTEGER NOT NULL,
  "priorityPriceCents" INTEGER NOT NULL,
  "source" "MusicPricingSource" NOT NULL DEFAULT 'ADMIN',
  "createdByAdminId" UUID,
  "activatedAt" TIMESTAMPTZ(3),
  "retiredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "music_pricing_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "music_pricing_versions_version_nonempty" CHECK (btrim("version") <> ''),
  CONSTRAINT "music_pricing_versions_currency_eur" CHECK ("currency" = 'EUR'),
  CONSTRAINT "music_pricing_versions_amounts_valid" CHECK (
    "basePriceCents" > 0
    AND "basePriceCents" <= 100000000
    AND "coverPriceCents" >= 0
    AND "coverPriceCents" <= 100000000
    AND "priorityPriceCents" >= 0
    AND "priorityPriceCents" <= 100000000
  ),
  CONSTRAINT "music_pricing_versions_admin_actor_required" CHECK (
    "source" <> 'ADMIN' OR "createdByAdminId" IS NOT NULL
  ),
  CONSTRAINT "music_pricing_versions_status_timestamps" CHECK (
    (
      "status" = 'ACTIVE'
      AND "activatedAt" IS NOT NULL
      AND "retiredAt" IS NULL
    )
    OR (
      "status" = 'RETIRED'
      AND ("retiredAt" IS NULL OR "activatedAt" IS NOT NULL)
    )
  ),
  CONSTRAINT "music_pricing_versions_timestamp_order" CHECK (
    "retiredAt" IS NULL
    OR "activatedAt" IS NULL
    OR "retiredAt" >= "activatedAt"
  )
);

CREATE UNIQUE INDEX "music_pricing_versions_version_key"
  ON "music_pricing_versions"("version");
CREATE UNIQUE INDEX "music_pricing_versions_one_active_idx"
  ON "music_pricing_versions"("status")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "music_pricing_versions_status_createdAt_idx"
  ON "music_pricing_versions"("status", "createdAt");
CREATE INDEX "music_pricing_versions_createdByAdminId_idx"
  ON "music_pricing_versions"("createdByAdminId");

CREATE TABLE "music_pricing_configurations" (
  "key" VARCHAR(64) NOT NULL,
  "activeVersionId" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedByAdminId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "music_pricing_configurations_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "music_pricing_configurations_singleton" CHECK ("key" = 'music-order'),
  CONSTRAINT "music_pricing_configurations_revision_positive" CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "music_pricing_configurations_activeVersionId_key"
  ON "music_pricing_configurations"("activeVersionId");
CREATE INDEX "music_pricing_configurations_updatedByAdminId_idx"
  ON "music_pricing_configurations"("updatedByAdminId");

CREATE TABLE "music_pricing_activations" (
  "id" UUID NOT NULL,
  "previousVersionId" UUID,
  "activatedVersionId" UUID NOT NULL,
  "actorAdminId" UUID,
  "source" "MusicPricingSource" NOT NULL,
  "configurationRevision" INTEGER NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "music_pricing_activations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "music_pricing_activations_revision_positive" CHECK ("configurationRevision" > 0),
  CONSTRAINT "music_pricing_activations_admin_actor_required" CHECK (
    "source" <> 'ADMIN' OR "actorAdminId" IS NOT NULL
  ),
  CONSTRAINT "music_pricing_activations_versions_distinct" CHECK (
    "previousVersionId" IS NULL OR "previousVersionId" <> "activatedVersionId"
  )
);

CREATE INDEX "music_pricing_activations_activatedVersionId_occurredAt_idx"
  ON "music_pricing_activations"("activatedVersionId", "occurredAt");
CREATE INDEX "music_pricing_activations_previousVersionId_idx"
  ON "music_pricing_activations"("previousVersionId");
CREATE INDEX "music_pricing_activations_actorAdminId_idx"
  ON "music_pricing_activations"("actorAdminId");

CREATE TABLE "products" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(160) NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "description" TEXT NOT NULL,
  "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
  "priceCents" INTEGER,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "trackInventory" BOOLEAN NOT NULL DEFAULT false,
  "stock" INTEGER,
  "shippingRequired" BOOLEAN NOT NULL DEFAULT false,
  "shippingPriceCents" INTEGER NOT NULL DEFAULT 0,
  "position" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMPTZ(3),
  "archivedAt" TIMESTAMPTZ(3),
  "lockVersion" INTEGER NOT NULL DEFAULT 1,
  "createdByAdminId" UUID,
  "updatedByAdminId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "products_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "products_title_nonempty" CHECK (btrim("title") <> ''),
  CONSTRAINT "products_description_nonempty" CHECK (btrim("description") <> ''),
  CONSTRAINT "products_currency_eur" CHECK ("currency" = 'EUR'),
  CONSTRAINT "products_price_valid" CHECK (
    "priceCents" IS NULL OR ("priceCents" > 0 AND "priceCents" <= 100000000)
  ),
  CONSTRAINT "products_inventory_consistent" CHECK (
    ("trackInventory" = false AND "stock" IS NULL)
    OR (
      "trackInventory" = true
      AND "stock" IS NOT NULL
      AND "stock" >= 0
      AND "stock" <= 1000000
    )
  ),
  CONSTRAINT "products_shipping_consistent" CHECK (
    "shippingPriceCents" >= 0
    AND "shippingPriceCents" <= 100000000
    AND ("shippingRequired" = true OR "shippingPriceCents" = 0)
  ),
  CONSTRAINT "products_position_valid" CHECK ("position" >= 0 AND "position" <= 1000000),
  CONSTRAINT "products_lock_version_positive" CHECK ("lockVersion" > 0),
  CONSTRAINT "products_status_timestamps" CHECK (
    (
      "status" = 'DRAFT'
      AND "publishedAt" IS NULL
      AND "archivedAt" IS NULL
    )
    OR (
      "status" = 'PUBLISHED'
      AND "priceCents" IS NOT NULL
      AND "publishedAt" IS NOT NULL
      AND "archivedAt" IS NULL
    )
    OR (
      "status" = 'ARCHIVED'
      AND "archivedAt" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
CREATE INDEX "products_status_position_createdAt_idx"
  ON "products"("status", "position", "createdAt");
CREATE INDEX "products_createdByAdminId_idx" ON "products"("createdByAdminId");
CREATE INDEX "products_updatedByAdminId_idx" ON "products"("updatedByAdminId");

CREATE TABLE "product_assets" (
  "productId" UUID NOT NULL,
  "assetId" UUID NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_assets_pkey" PRIMARY KEY ("productId", "assetId"),
  CONSTRAINT "product_assets_position_valid" CHECK ("position" >= 0 AND "position" <= 1000000)
);

CREATE UNIQUE INDEX "product_assets_productId_position_key"
  ON "product_assets"("productId", "position");
CREATE INDEX "product_assets_assetId_idx" ON "product_assets"("assetId");

CREATE TABLE "product_stock_adjustments" (
  "id" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "delta" INTEGER NOT NULL,
  "stockBefore" INTEGER NOT NULL,
  "stockAfter" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "actorAdminId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_stock_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_stock_adjustments_delta_valid" CHECK (
    "delta" <> 0 AND "delta" >= -1000000 AND "delta" <= 1000000
  ),
  CONSTRAINT "product_stock_adjustments_stocks_nonnegative" CHECK (
    "stockBefore" >= 0
    AND "stockBefore" <= 1000000
    AND "stockAfter" >= 0
    AND "stockAfter" <= 1000000
  ),
  CONSTRAINT "product_stock_adjustments_arithmetic" CHECK (
    "stockAfter" = "stockBefore" + "delta"
  ),
  CONSTRAINT "product_stock_adjustments_reason_nonempty" CHECK (btrim("reason") <> '')
);

CREATE INDEX "product_stock_adjustments_productId_createdAt_idx"
  ON "product_stock_adjustments"("productId", "createdAt");
CREATE INDEX "product_stock_adjustments_actorAdminId_idx"
  ON "product_stock_adjustments"("actorAdminId");

CREATE TABLE "product_audit_events" (
  "id" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "action" "ProductAuditAction" NOT NULL,
  "actorAdminId" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_audit_events_metadata_object" CHECK (jsonb_typeof("metadata") = 'object')
);

CREATE INDEX "product_audit_events_productId_occurredAt_idx"
  ON "product_audit_events"("productId", "occurredAt");
CREATE INDEX "product_audit_events_actorAdminId_idx"
  ON "product_audit_events"("actorAdminId");

ALTER TABLE "music_pricing_versions"
  ADD CONSTRAINT "music_pricing_versions_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "music_pricing_configurations"
  ADD CONSTRAINT "music_pricing_configurations_activeVersionId_fkey"
  FOREIGN KEY ("activeVersionId") REFERENCES "music_pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "music_pricing_configurations_updatedByAdminId_fkey"
  FOREIGN KEY ("updatedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "music_pricing_activations"
  ADD CONSTRAINT "music_pricing_activations_previousVersionId_fkey"
  FOREIGN KEY ("previousVersionId") REFERENCES "music_pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "music_pricing_activations_activatedVersionId_fkey"
  FOREIGN KEY ("activatedVersionId") REFERENCES "music_pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "music_pricing_activations_actorAdminId_fkey"
  FOREIGN KEY ("actorAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "products"
  ADD CONSTRAINT "products_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "products_updatedByAdminId_fkey"
  FOREIGN KEY ("updatedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_assets"
  ADD CONSTRAINT "product_assets_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "product_assets_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_stock_adjustments"
  ADD CONSTRAINT "product_stock_adjustments_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "product_stock_adjustments_actorAdminId_fkey"
  FOREIGN KEY ("actorAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_audit_events"
  ADD CONSTRAINT "product_audit_events_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "product_audit_events_actorAdminId_fkey"
  FOREIGN KEY ("actorAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fail closed if these canonical immutable versions already exist with values
-- different from the V1.0.0 snapshots. The migration never rewrites an
-- existing pricing definition.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "music_pricing_versions"
    WHERE "version" = '2026-08-v1'
      AND (
        "currency" <> 'EUR'
        OR "basePriceCents" <> 5000
        OR "coverPriceCents" <> 1000
        OR "priorityPriceCents" <> 3000
        OR "status" <> 'RETIRED'
        OR "source" <> 'IMPORTED'
      )
  ) THEN
    RAISE EXCEPTION 'MUSIC_PRICING_SEED_CONFLICT_2026_08_V1';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "music_pricing_versions"
    WHERE "version" = '2026-08-v2'
      AND (
        "currency" <> 'EUR'
        OR "basePriceCents" <> 2000
        OR "coverPriceCents" <> 1000
        OR "priorityPriceCents" <> 3000
        OR "status" <> 'ACTIVE'
        OR "source" <> 'IMPORTED'
      )
  ) THEN
    RAISE EXCEPTION 'MUSIC_PRICING_SEED_CONFLICT_2026_08_V2';
  END IF;
END
$$;

INSERT INTO "music_pricing_versions" (
  "id", "version", "status", "currency", "basePriceCents",
  "coverPriceCents", "priorityPriceCents", "source", "activatedAt",
  "retiredAt", "createdAt", "updatedAt"
) VALUES
  (
    gen_random_uuid(), '2026-08-v1', 'RETIRED', 'EUR', 5000, 1000, 3000,
    'IMPORTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(), '2026-08-v2', 'ACTIVE', 'EUR', 2000, 1000, 3000,
    'IMPORTED', CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "music_pricing_configurations" (
  "key", "activeVersionId", "revision", "createdAt", "updatedAt"
)
SELECT
  'music-order', "id", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "music_pricing_versions"
WHERE "version" = '2026-08-v2';

INSERT INTO "music_pricing_activations" (
  "id", "previousVersionId", "activatedVersionId", "source",
  "configurationRevision", "occurredAt"
)
SELECT
  gen_random_uuid(), previous."id", activated."id", 'IMPORTED', 1,
  CURRENT_TIMESTAMP
FROM "music_pricing_versions" AS previous
CROSS JOIN "music_pricing_versions" AS activated
WHERE previous."version" = '2026-08-v1'
  AND activated."version" = '2026-08-v2';

-- Post-seed invariant: exactly one version is active and the singleton points
-- to that canonical imported V1.0.0 version. A partial or ambiguous import is
-- a deployment failure, never an implicit fallback.
DO $$
BEGIN
  IF (SELECT count(*) FROM "music_pricing_versions" WHERE "status" = 'ACTIVE') <> 1 THEN
    RAISE EXCEPTION 'MUSIC_PRICING_ACTIVE_VERSION_COUNT_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "music_pricing_configurations" AS configuration
    INNER JOIN "music_pricing_versions" AS version
      ON version."id" = configuration."activeVersionId"
    WHERE configuration."key" = 'music-order'
      AND configuration."revision" = 1
      AND version."version" = '2026-08-v2'
      AND version."status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'MUSIC_PRICING_CONFIGURATION_SEED_INVALID';
  END IF;

  IF (
    SELECT count(*)
    FROM "music_pricing_activations" AS activation
    INNER JOIN "music_pricing_versions" AS previous
      ON previous."id" = activation."previousVersionId"
    INNER JOIN "music_pricing_versions" AS activated
      ON activated."id" = activation."activatedVersionId"
    WHERE previous."version" = '2026-08-v1'
      AND activated."version" = '2026-08-v2'
      AND activation."source" = 'IMPORTED'
      AND activation."configurationRevision" = 1
  ) <> 1 THEN
    RAISE EXCEPTION 'MUSIC_PRICING_ACTIVATION_SEED_INVALID';
  END IF;
END
$$;
