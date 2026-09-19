-- V3.4 is additive: explicit worker phases plus creation-scoped collaborators.
ALTER TYPE "CreationMediaUploadStatus" ADD VALUE IF NOT EXISTS 'ANALYZING';
ALTER TYPE "CreationMediaUploadStatus" ADD VALUE IF NOT EXISTS 'TRANSCODING';

-- Raise only the reviewed source-upload ceiling. The checkout, public media and
-- all other size contracts remain unchanged. PostgreSQL cannot alter a CHECK
-- expression in place, so the named constraint is replaced without touching
-- any row or column.
ALTER TABLE "creation_media_upload_sessions"
  DROP CONSTRAINT "creation_media_upload_sessions_size_valid";
ALTER TABLE "creation_media_upload_sessions"
  ADD CONSTRAINT "creation_media_upload_sessions_size_valid"
  CHECK ("declaredSizeBytes" > 0 AND "declaredSizeBytes" <= 524288000);

ALTER TABLE "creation_media_upload_sessions"
  DROP CONSTRAINT "creation_media_upload_sessions_contract_valid";
ALTER TABLE "creation_media_upload_sessions"
  ADD CONSTRAINT "creation_media_upload_sessions_contract_valid"
  CHECK (
    "expectedLockVersion" > 0 AND
    "rightsConfirmed" = TRUE AND
    "declaredMimeType" IN ('video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm')
  );

CREATE TABLE "creation_collaborators" (
  "id" UUID NOT NULL,
  "creationId" UUID NOT NULL,
  "displayName" VARCHAR(180) NOT NULL,
  "role" VARCHAR(120),
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "creation_collaborators_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "creation_collaborators_name_valid" CHECK (btrim("displayName") <> ''),
  CONSTRAINT "creation_collaborators_role_valid" CHECK ("role" IS NULL OR btrim("role") <> ''),
  CONSTRAINT "creation_collaborators_position_valid" CHECK ("position" >= 0)
);

CREATE TABLE "creation_collaborator_links" (
  "id" UUID NOT NULL,
  "collaboratorId" UUID NOT NULL,
  "platform" VARCHAR(40) NOT NULL,
  "label" VARCHAR(120),
  "url" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "creation_collaborator_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "creation_collaborator_links_platform_valid" CHECK ("platform" ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  CONSTRAINT "creation_collaborator_links_label_valid" CHECK ("label" IS NULL OR btrim("label") <> ''),
  CONSTRAINT "creation_collaborator_links_url_valid" CHECK ("url" ~ '^https://[^[:space:]]+$'),
  CONSTRAINT "creation_collaborator_links_position_valid" CHECK ("position" >= 0)
);

CREATE INDEX "creation_collaborators_creationId_position_id_idx"
  ON "creation_collaborators"("creationId", "position", "id");
CREATE UNIQUE INDEX "creation_collaborator_links_collaboratorId_url_key"
  ON "creation_collaborator_links"("collaboratorId", "url");
CREATE INDEX "creation_collaborator_links_collaboratorId_position_id_idx"
  ON "creation_collaborator_links"("collaboratorId", "position", "id");

ALTER TABLE "creation_collaborators"
  ADD CONSTRAINT "creation_collaborators_creationId_fkey"
  FOREIGN KEY ("creationId") REFERENCES "creations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "creation_collaborator_links"
  ADD CONSTRAINT "creation_collaborator_links_collaboratorId_fkey"
  FOREIGN KEY ("collaboratorId") REFERENCES "creation_collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
