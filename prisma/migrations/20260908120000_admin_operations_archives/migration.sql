-- V1.2 Admin Operations: additive archive overlay and immutable cleanup audit.
-- No existing business status, financial row, document, stock, or order is rewritten.

CREATE TYPE "AdminManagedRecordType" AS ENUM ('MUSIC_ORDER', 'SHOP_ORDER', 'RIGHTS_REQUEST');
CREATE TYPE "AdminCleanupClassification" AS ENUM ('DELETE_SAFE', 'ARCHIVE_REQUIRED', 'KEEP_ACTION_REQUIRED');
CREATE TYPE "AdminCleanupOperation" AS ENUM ('ARCHIVED', 'HARD_DELETED');

CREATE TABLE "admin_record_archives" (
  "id" UUID NOT NULL,
  "recordType" "AdminManagedRecordType" NOT NULL,
  "recordId" UUID NOT NULL,
  "recordReference" VARCHAR(80) NOT NULL,
  "classification" "AdminCleanupClassification" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "archivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedByUserId" UUID NOT NULL,
  CONSTRAINT "admin_record_archives_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_record_archives_actor_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "admin_cleanup_audit_events" (
  "id" UUID NOT NULL,
  "recordType" "AdminManagedRecordType" NOT NULL,
  "recordId" UUID,
  "recordReference" VARCHAR(80) NOT NULL,
  "operation" "AdminCleanupOperation" NOT NULL,
  "classification" "AdminCleanupClassification" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "actorUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_cleanup_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_cleanup_audit_events_actor_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "admin_record_archives_recordType_recordId_key" ON "admin_record_archives"("recordType", "recordId");
CREATE INDEX "admin_record_archives_recordType_archivedAt_idx" ON "admin_record_archives"("recordType", "archivedAt");
CREATE INDEX "admin_record_archives_recordReference_idx" ON "admin_record_archives"("recordReference");
CREATE INDEX "admin_record_archives_archivedByUserId_idx" ON "admin_record_archives"("archivedByUserId");
CREATE INDEX "admin_cleanup_audit_events_recordType_recordId_createdAt_idx" ON "admin_cleanup_audit_events"("recordType", "recordId", "createdAt");
CREATE INDEX "admin_cleanup_audit_events_recordReference_createdAt_idx" ON "admin_cleanup_audit_events"("recordReference", "createdAt");
CREATE INDEX "admin_cleanup_audit_events_actorUserId_createdAt_idx" ON "admin_cleanup_audit_events"("actorUserId", "createdAt");
