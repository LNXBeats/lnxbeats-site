-- V3.3: additive foundation for the distinct Creations & collaborations
-- catalogue. The historical music catalogue, commerce, Rights and existing
-- assets are not rewritten by this migration.

CREATE TYPE "CreationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "CreationPrimaryMedia" AS ENUM ('COVER', 'AUDIO', 'VIDEO');
CREATE TYPE "CreationAssetRole" AS ENUM ('COVER', 'VIDEO_POSTER', 'AUDIO', 'VIDEO');

CREATE TABLE "creations" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(160) NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "summary" VARCHAR(1000),
  "description" TEXT,
  "collaborator" VARCHAR(240),
  "credits" TEXT,
  "category" VARCHAR(120),
  "primaryMedia" "CreationPrimaryMedia",
  "position" INTEGER NOT NULL DEFAULT 0,
  "status" "CreationStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMPTZ(3),
  "seoTitle" VARCHAR(240),
  "seoDescription" TEXT,
  "lockVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "creations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "creations_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "creations_title_nonempty" CHECK (btrim("title") <> ''),
  CONSTRAINT "creations_summary_nonempty" CHECK ("summary" IS NULL OR btrim("summary") <> ''),
  CONSTRAINT "creations_description_nonempty" CHECK ("description" IS NULL OR btrim("description") <> ''),
  CONSTRAINT "creations_collaborator_nonempty" CHECK ("collaborator" IS NULL OR btrim("collaborator") <> ''),
  CONSTRAINT "creations_credits_nonempty" CHECK ("credits" IS NULL OR btrim("credits") <> ''),
  CONSTRAINT "creations_category_nonempty" CHECK ("category" IS NULL OR btrim("category") <> ''),
  CONSTRAINT "creations_seo_title_nonempty" CHECK ("seoTitle" IS NULL OR btrim("seoTitle") <> ''),
  CONSTRAINT "creations_seo_description_nonempty" CHECK ("seoDescription" IS NULL OR btrim("seoDescription") <> ''),
  CONSTRAINT "creations_position_valid" CHECK ("position" >= 0 AND "position" <= 1000000),
  CONSTRAINT "creations_lock_version_positive" CHECK ("lockVersion" > 0),
  CONSTRAINT "creations_published_fields_complete" CHECK (
    "status" <> 'PUBLISHED'
    OR ("summary" IS NOT NULL AND btrim("summary") <> '' AND "primaryMedia" IS NOT NULL)
  ),
  CONSTRAINT "creations_status_timestamps" CHECK (
    ("status" = 'DRAFT' AND "publishedAt" IS NULL)
    OR ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL)
    OR ("status" = 'ARCHIVED' AND "publishedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "creations_slug_key" ON "creations"("slug");
CREATE INDEX "creations_status_position_id_idx"
  ON "creations"("status", "position", "id");

CREATE TABLE "creation_assets" (
  "creationId" UUID NOT NULL,
  "role" "CreationAssetRole" NOT NULL,
  "assetId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "creation_assets_pkey" PRIMARY KEY ("creationId", "role")
);

CREATE INDEX "creation_assets_assetId_idx" ON "creation_assets"("assetId");

CREATE TABLE "creation_external_links" (
  "id" UUID NOT NULL,
  "creationId" UUID NOT NULL,
  "label" VARCHAR(180) NOT NULL,
  "url" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "creation_external_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "creation_external_links_label_nonempty" CHECK (btrim("label") <> ''),
  CONSTRAINT "creation_external_links_https" CHECK ("url" ~ '^https://'),
  CONSTRAINT "creation_external_links_position_valid" CHECK ("position" >= 0 AND "position" <= 1000000)
);

CREATE UNIQUE INDEX "creation_external_links_creationId_url_key"
  ON "creation_external_links"("creationId", "url");
CREATE INDEX "creation_external_links_creationId_position_id_idx"
  ON "creation_external_links"("creationId", "position", "id");

ALTER TABLE "creation_assets"
  ADD CONSTRAINT "creation_assets_creationId_fkey"
  FOREIGN KEY ("creationId") REFERENCES "creations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "creation_assets_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "creation_external_links"
  ADD CONSTRAINT "creation_external_links_creationId_fkey"
  FOREIGN KEY ("creationId") REFERENCES "creations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
