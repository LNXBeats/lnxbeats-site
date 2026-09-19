-- V3.3 corrective media pipeline: durable private multipart-upload sessions.
-- Additive only; the reviewed V3.3 foundation migration is intentionally unchanged.
CREATE TYPE "CreationMediaUploadStatus" AS ENUM (
  'UPLOADING', 'QUARANTINE', 'VALIDATING', 'READY', 'REJECTED', 'ABORTED', 'EXPIRED'
);

CREATE TABLE "creation_media_upload_sessions" (
  "id" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "creationId" UUID NOT NULL,
  "creationSlug" VARCHAR(160) NOT NULL,
  "actorUserId" UUID NOT NULL,
  "role" "CreationAssetRole" NOT NULL,
  "status" "CreationMediaUploadStatus" NOT NULL DEFAULT 'UPLOADING',
  "expectedLockVersion" INTEGER NOT NULL,
  "expectedAssetId" UUID,
  "rightsConfirmed" BOOLEAN NOT NULL,
  "alt" VARCHAR(500),
  "originalFilename" VARCHAR(255) NOT NULL,
  "declaredMimeType" VARCHAR(160) NOT NULL,
  "declaredSizeBytes" BIGINT NOT NULL,
  "quarantineKey" VARCHAR(500) NOT NULL,
  "provider" VARCHAR(80) NOT NULL,
  "providerUploadId" TEXT NOT NULL,
  "partSizeBytes" INTEGER NOT NULL,
  "partCount" INTEGER NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "validationStartedAt" TIMESTAMPTZ(3),
  "validationFinishedAt" TIMESTAMPTZ(3),
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "leaseToken" UUID,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" VARCHAR(80),
  "resultAssetId" UUID,
  "resultLockVersion" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "creation_media_upload_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "creation_media_upload_sessions_video_only" CHECK ("role" = 'VIDEO'),
  CONSTRAINT "creation_media_upload_sessions_slug_format" CHECK ("creationSlug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "creation_media_upload_sessions_token_hash" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "creation_media_upload_sessions_size_valid" CHECK ("declaredSizeBytes" > 0 AND "declaredSizeBytes" <= 209715200),
  CONSTRAINT "creation_media_upload_sessions_contract_valid" CHECK (
    "expectedLockVersion" > 0 AND "rightsConfirmed" = TRUE AND "declaredMimeType" = 'video/mp4'
  ),
  CONSTRAINT "creation_media_upload_sessions_parts_valid" CHECK (
    "partSizeBytes" = 8388608 AND "partCount" BETWEEN 1 AND 10000
  ),
  CONSTRAINT "creation_media_upload_sessions_attempts_valid" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "creation_media_upload_sessions_tokenHash_key" ON "creation_media_upload_sessions"("tokenHash");
CREATE UNIQUE INDEX "creation_media_upload_sessions_quarantineKey_key" ON "creation_media_upload_sessions"("quarantineKey");
CREATE UNIQUE INDEX "creation_media_upload_sessions_providerUploadId_key" ON "creation_media_upload_sessions"("providerUploadId");
CREATE INDEX "creation_media_upload_sessions_actor_status_expiry_idx" ON "creation_media_upload_sessions"("actorUserId", "status", "expiresAt");
CREATE INDEX "creation_media_upload_sessions_creation_role_status_idx" ON "creation_media_upload_sessions"("creationId", "role", "status");
CREATE INDEX "creation_media_upload_sessions_worker_idx" ON "creation_media_upload_sessions"("status", "availableAt", "leaseExpiresAt", "createdAt");

ALTER TABLE "creation_media_upload_sessions"
  ADD CONSTRAINT "creation_media_upload_sessions_creationId_fkey"
  FOREIGN KEY ("creationId") REFERENCES "creations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "creation_media_upload_sessions"
  ADD CONSTRAINT "creation_media_upload_sessions_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
