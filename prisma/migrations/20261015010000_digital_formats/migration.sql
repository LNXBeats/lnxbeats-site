-- Additive DCN formats. Historical masters, acquisitions and archive payloads remain unchanged.
ALTER TABLE digital_masters ADD COLUMN "mp3AssetId" uuid;
ALTER TABLE digital_masters ADD COLUMN "mp3BitrateKbps" integer;
ALTER TABLE digital_masters ADD COLUMN "encoderVersion" varchar(80);
CREATE UNIQUE INDEX "digital_masters_mp3AssetId_key" ON digital_masters("mp3AssetId");
ALTER TABLE digital_masters ADD CONSTRAINT "digital_masters_mp3AssetId_fkey"
  FOREIGN KEY ("mp3AssetId") REFERENCES assets(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE digital_masters ADD CONSTRAINT digital_mp3_valid CHECK (
  ("mp3AssetId" IS NULL AND "mp3BitrateKbps" IS NULL AND "encoderVersion" IS NULL)
  OR ("mp3AssetId" IS NOT NULL AND "mp3BitrateKbps" IS NOT NULL AND "mp3BitrateKbps" IN (192,256,320)
      AND "encoderVersion" IS NOT NULL AND length(trim("encoderVersion"))>0)
);
ALTER TABLE digital_archives ADD COLUMN format varchar(8) NOT NULL DEFAULT 'WAV';
ALTER TABLE digital_archives ADD CONSTRAINT digital_archive_format_valid CHECK (format IN ('WAV','MP3'));
ALTER TABLE digital_archives DROP CONSTRAINT IF EXISTS "digital_archives_lineId_key";
DROP INDEX IF EXISTS "digital_archives_lineId_key";
CREATE UNIQUE INDEX "digital_archives_lineId_format_key" ON digital_archives("lineId",format);
ALTER TABLE digital_download_tickets ADD COLUMN format varchar(8) NOT NULL DEFAULT 'WAV';
ALTER TABLE digital_download_tickets ADD CONSTRAINT digital_download_format_valid CHECK (format IN ('WAV','MP3'));

-- Master identities are append-only versions. No remaster or derived asset can replace an acquired one.
CREATE FUNCTION digital_preserve_master_formats() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."trackId" IS DISTINCT FROM OLD."trackId" OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW."masterAssetId" IS DISTINCT FROM OLD."masterAssetId" OR NEW."previewAssetId" IS DISTINCT FROM OLD."previewAssetId"
    OR NEW."mp3AssetId" IS DISTINCT FROM OLD."mp3AssetId" OR NEW."mp3BitrateKbps" IS DISTINCT FROM OLD."mp3BitrateKbps"
    OR NEW."encoderVersion" IS DISTINCT FROM OLD."encoderVersion" OR NEW.codec IS DISTINCT FROM OLD.codec
    OR NEW."previewStartMs" IS DISTINCT FROM OLD."previewStartMs" OR NEW."previewDurationMs" IS DISTINCT FROM OLD."previewDurationMs" THEN
    RAISE EXCEPTION 'immutable digital master version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER digital_master_formats_immutable BEFORE UPDATE ON digital_masters
  FOR EACH ROW EXECUTE FUNCTION digital_preserve_master_formats();

CREATE FUNCTION digital_verify_mp3_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."mp3AssetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assets WHERE id=NEW."mp3AssetId" AND visibility='PRIVATE'
      AND "mimeType"='audio/mpeg' AND "checksumSha256" ~ '^[a-f0-9]{64}$' AND "sizeBytes">0
  ) THEN RAISE EXCEPTION 'invalid private digital MP3' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER digital_mp3_visibility BEFORE INSERT OR UPDATE ON digital_masters
  FOR EACH ROW EXECUTE FUNCTION digital_verify_mp3_visibility();

-- Only digital-linked asset identities are protected; editorial rights remain independently mutable.
CREATE FUNCTION digital_preserve_linked_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM digital_masters WHERE "masterAssetId"=OLD.id OR "mp3AssetId"=OLD.id OR "previewAssetId"=OLD.id)
    AND (NEW."storageKey" IS DISTINCT FROM OLD."storageKey" OR NEW."storageBackend" IS DISTINCT FROM OLD."storageBackend"
      OR NEW."storageProvider" IS DISTINCT FROM OLD."storageProvider" OR NEW.visibility IS DISTINCT FROM OLD.visibility
      OR NEW."checksumSha256" IS DISTINCT FROM OLD."checksumSha256" OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType"
      OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes" OR NEW.duration_ms IS DISTINCT FROM OLD.duration_ms
      OR NEW.filename IS DISTINCT FROM OLD.filename OR NEW.type IS DISTINCT FROM OLD.type) THEN
    RAISE EXCEPTION 'immutable digital linked asset' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER digital_linked_asset_immutable BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION digital_preserve_linked_asset();
