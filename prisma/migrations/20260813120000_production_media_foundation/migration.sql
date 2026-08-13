CREATE TYPE "MediaStorageBackend" AS ENUM ('LOCAL', 'OBJECT');
CREATE TYPE "MediaVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

ALTER TABLE "assets"
ADD COLUMN "storageBackend" "MediaStorageBackend" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN "storageProvider" VARCHAR(80) NOT NULL DEFAULT 'local',
ADD COLUMN "visibility" "MediaVisibility" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN "checksumSha256" VARCHAR(64);

UPDATE "assets" AS asset
SET "visibility" = 'PUBLIC'
WHERE EXISTS (
  SELECT 1
  FROM "project_assets" AS project_asset
  WHERE project_asset."assetId" = asset."id"
    AND project_asset."role" IN ('COVER', 'AUDIO_PREVIEW')
);

CREATE INDEX "assets_storageBackend_visibility_idx" ON "assets"("storageBackend", "visibility");

ALTER TABLE "assets"
ADD CONSTRAINT "assets_checksumSha256_format_check"
CHECK ("checksumSha256" IS NULL OR "checksumSha256" ~ '^[0-9a-f]{64}$');
