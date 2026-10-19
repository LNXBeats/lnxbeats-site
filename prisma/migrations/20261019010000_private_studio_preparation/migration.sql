-- LOCAL QA ONLY until a separate release authorisation. No catalogue, contract,
-- acquisition, price, gateway or historical master is updated by this migration.
ALTER TABLE digital_uploads ADD COLUMN "processingProfile" varchar(20) NOT NULL DEFAULT 'LEGACY';
ALTER TABLE digital_uploads ADD CONSTRAINT digital_upload_profile_valid CHECK ("processingProfile" IN ('LEGACY','STUDIO_V1'));
CREATE TABLE digital_studio_jobs (
 id uuid PRIMARY KEY, "uploadId" uuid NOT NULL REFERENCES digital_uploads(id) ON DELETE RESTRICT,
 attempt integer NOT NULL DEFAULT 1 CHECK(attempt>0), "actorId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 "trackId" uuid NOT NULL REFERENCES tracks(id) ON DELETE RESTRICT,
 "baseMasterId" uuid REFERENCES digital_masters(id) ON DELETE RESTRICT,
 "expectedVersion" integer NOT NULL DEFAULT 0 CHECK("expectedVersion">=0),
 title varchar(240) NOT NULL, album varchar(240), metadata jsonb NOT NULL,
 "sourceAssetId" uuid REFERENCES assets(id) ON DELETE RESTRICT, "sourceSha256" char(64), "sourceLossy" boolean NOT NULL DEFAULT false,
 status varchar(20) NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PROCESSING','READY','FAILED')),
 phase varchar(20) NOT NULL DEFAULT 'IMPORTED' CHECK(phase IN ('IMPORTED','ANALYZING','MASTERING','CONVERTING','VERIFYING','READY','ERROR')),
 decision varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(decision IN ('PENDING','APPROVED','REJECTED')),
 binding char(64), report jsonb, "errorCode" varchar(80), "leaseToken" uuid, "leaseUntil" timestamptz(3),
 "publishedMasterId" uuid REFERENCES digital_masters(id) ON DELETE RESTRICT, "allowExistingPurchases" boolean NOT NULL DEFAULT false,
 "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamptz(3) NOT NULL,
 CONSTRAINT "digital_studio_jobs_uploadId_attempt_key" UNIQUE("uploadId",attempt),
 CHECK("sourceSha256" IS NULL OR "sourceSha256" ~ '^[a-f0-9]{64}$'),
 CHECK(binding IS NULL OR binding ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "digital_studio_jobs_trackId_createdAt_idx" ON digital_studio_jobs("trackId","createdAt");
CREATE INDEX "digital_studio_jobs_status_leaseUntil_idx" ON digital_studio_jobs(status,"leaseUntil");
CREATE TABLE digital_studio_artifacts (
 id uuid PRIMARY KEY, "jobId" uuid NOT NULL REFERENCES digital_studio_jobs(id) ON DELETE RESTRICT,
 role varchar(24) NOT NULL CHECK(role IN ('ORIGINAL','MP3','WAV_CD','WAV_24','PREVIEW','AUDITION_WAV_CD','AUDITION_WAV_24')),
 "assetId" uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT, "sampleRate" integer, "bitDepth" integer, "bitrateKbps" integer,
 "integratedLufs" double precision, "truePeakDbtp" double precision, "metadataVerified" boolean NOT NULL DEFAULT false,
 "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "digital_studio_artifacts_jobId_role_key" UNIQUE("jobId",role)
);
CREATE INDEX "digital_studio_artifacts_assetId_idx" ON digital_studio_artifacts("assetId");
CREATE FUNCTION digital_studio_preserve_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW."uploadId" IS DISTINCT FROM OLD."uploadId" OR NEW.attempt IS DISTINCT FROM OLD.attempt
 OR NEW."actorId" IS DISTINCT FROM OLD."actorId" OR NEW."trackId" IS DISTINCT FROM OLD."trackId"
 OR NEW."baseMasterId" IS DISTINCT FROM OLD."baseMasterId" OR NEW."expectedVersion" IS DISTINCT FROM OLD."expectedVersion"
 OR NEW.title IS DISTINCT FROM OLD.title OR NEW.album IS DISTINCT FROM OLD.album OR NEW.metadata IS DISTINCT FROM OLD.metadata
 OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
 OR (OLD."sourceAssetId" IS NOT NULL AND (NEW."sourceAssetId" IS DISTINCT FROM OLD."sourceAssetId" OR NEW."sourceSha256" IS DISTINCT FROM OLD."sourceSha256"))
 OR (OLD.binding IS NOT NULL AND (NEW.binding IS DISTINCT FROM OLD.binding OR NEW.report IS DISTINCT FROM OLD.report OR NEW."sourceLossy" IS DISTINCT FROM OLD."sourceLossy"))
 OR (OLD.decision IN ('APPROVED','REJECTED') AND (NEW.decision IS DISTINCT FROM OLD.decision
   OR NEW."publishedMasterId" IS DISTINCT FROM OLD."publishedMasterId" OR NEW."allowExistingPurchases" IS DISTINCT FROM OLD."allowExistingPurchases"))
 THEN RAISE EXCEPTION 'immutable studio version identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER digital_studio_identity_immutable BEFORE UPDATE ON digital_studio_jobs FOR EACH ROW EXECUTE FUNCTION digital_studio_preserve_identity();
CREATE FUNCTION digital_studio_artifact_private() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM assets WHERE id=NEW."assetId" AND visibility='PRIVATE' AND "checksumSha256" ~ '^[a-f0-9]{64}$' AND "sizeBytes">0)
 THEN RAISE EXCEPTION 'private studio asset required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM digital_studio_jobs WHERE id=NEW."jobId" AND binding IS NOT NULL)
 THEN RAISE EXCEPTION 'immutable studio artifacts' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER digital_studio_artifact_private_check BEFORE INSERT OR UPDATE ON digital_studio_artifacts FOR EACH ROW EXECUTE FUNCTION digital_studio_artifact_private();
CREATE FUNCTION digital_studio_preserve_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM digital_studio_artifacts WHERE "assetId"=OLD.id)
 AND (NEW."storageKey" IS DISTINCT FROM OLD."storageKey" OR NEW."storageBackend" IS DISTINCT FROM OLD."storageBackend"
 OR NEW."storageProvider" IS DISTINCT FROM OLD."storageProvider" OR NEW.visibility IS DISTINCT FROM OLD.visibility
 OR NEW."checksumSha256" IS DISTINCT FROM OLD."checksumSha256" OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType"
 OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes" OR NEW.duration_ms IS DISTINCT FROM OLD.duration_ms OR NEW.filename IS DISTINCT FROM OLD.filename)
 THEN RAISE EXCEPTION 'immutable studio asset' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER digital_studio_linked_asset_immutable BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION digital_studio_preserve_asset();
