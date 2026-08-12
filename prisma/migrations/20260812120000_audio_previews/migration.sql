-- Add a dedicated catalogue preview identity while keeping the shared Asset
-- and ProjectAsset media architecture. Existing rows remain unchanged.
ALTER TYPE "AssetType" ADD VALUE 'AUDIO_PREVIEW';
ALTER TYPE "ProjectAssetRole" ADD VALUE 'AUDIO_PREVIEW';

ALTER TABLE "assets"
ADD COLUMN "duration_ms" INTEGER;

ALTER TABLE "assets"
ADD CONSTRAINT "assets_duration_ms_non_negative"
CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0);
