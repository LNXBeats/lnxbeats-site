-- Additive migration after private Studio preparation. Migration 58 is not
-- rewritten. No historical upload, master, acquisition, offer or media changes.
ALTER TABLE digital_studio_jobs ALTER COLUMN "uploadId" DROP NOT NULL;
ALTER TABLE digital_studio_jobs ADD COLUMN "preparationKey" char(64);
ALTER TABLE digital_studio_jobs ADD COLUMN "previewStartMs" integer;
ALTER TABLE digital_studio_jobs ADD CONSTRAINT digital_studio_preview_start_valid CHECK("previewStartMs" IS NULL OR "previewStartMs">=0);
ALTER TABLE digital_studio_jobs ADD CONSTRAINT digital_studio_existing_source_bound CHECK(
 ("uploadId" IS NOT NULL AND "preparationKey" IS NULL) OR
 ("uploadId" IS NULL AND "preparationKey" IS NOT NULL AND "preparationKey" ~ '^[a-f0-9]{64}$'
  AND "sourceAssetId" IS NOT NULL AND "sourceSha256" IS NOT NULL AND "baseMasterId" IS NOT NULL
  AND "expectedVersion">0 AND "previewStartMs" IS NOT NULL));
ALTER TABLE digital_studio_jobs ADD CONSTRAINT "digital_studio_jobs_preparationKey_attempt_key" UNIQUE("preparationKey",attempt);
CREATE FUNCTION digital_studio_preserve_existing_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."preparationKey" IS DISTINCT FROM OLD."preparationKey" OR NEW."previewStartMs" IS DISTINCT FROM OLD."previewStartMs"
 THEN RAISE EXCEPTION 'immutable studio preparation identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER digital_studio_existing_identity_immutable BEFORE UPDATE ON digital_studio_jobs FOR EACH ROW EXECUTE FUNCTION digital_studio_preserve_existing_identity();
