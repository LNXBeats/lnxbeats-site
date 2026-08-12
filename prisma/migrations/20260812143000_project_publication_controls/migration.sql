-- V0.6.1: independent public visibility and deterministic jukebox placement.
CREATE TYPE "ProjectJukeboxPlacement" AS ENUM ('PUBLISHED', 'DEVELOPMENT');

ALTER TABLE "projects"
  ADD COLUMN "publicVisible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "jukeboxPlacement" "ProjectJukeboxPlacement",
  ADD COLUMN "jukeboxPosition" INTEGER;

-- Preserve the current public catalogue. Existing projects with an official
-- cover enter the jukebox matching their already documented editorial status.
UPDATE "projects" AS project
SET
  "jukeboxPlacement" = CASE
    WHEN project."status" = 'PUBLISHED' THEN 'PUBLISHED'::"ProjectJukeboxPlacement"
    WHEN project."status" = 'IN_DEVELOPMENT' THEN 'DEVELOPMENT'::"ProjectJukeboxPlacement"
  END,
  "jukeboxPosition" = project."catalogPosition"
WHERE project."status" IN ('PUBLISHED', 'IN_DEVELOPMENT')
  AND EXISTS (
    SELECT 1
    FROM "project_assets" AS project_asset
    WHERE project_asset."projectId" = project."id"
      AND project_asset."role" = 'COVER'
  );

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_jukeboxPosition_positive"
  CHECK ("jukeboxPosition" IS NULL OR "jukeboxPosition" > 0);

CREATE INDEX "projects_publicVisible_status_catalogPosition_idx"
  ON "projects"("publicVisible", "status", "catalogPosition");

CREATE INDEX "projects_publicVisible_jukeboxPlacement_jukeboxPosition_catalogPosition_idx"
  ON "projects"("publicVisible", "jukeboxPlacement", "jukeboxPosition", "catalogPosition");
