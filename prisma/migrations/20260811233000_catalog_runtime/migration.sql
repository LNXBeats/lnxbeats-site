-- V0.6.0.3: additive catalogue runtime fields and integrity constraints.
ALTER TABLE "projects"
  ADD COLUMN "catalogPosition" INTEGER,
  ADD COLUMN "highlighted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "artworkTone" VARCHAR(32) NOT NULL DEFAULT 'graphite',
  ADD COLUMN "seoTitle" VARCHAR(240),
  ADD COLUMN "seoDescription" TEXT,
  ADD COLUMN "legacySourceVersion" VARCHAR(80);

WITH ordered_projects AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id")::INTEGER AS position
  FROM "projects"
)
UPDATE "projects"
SET "catalogPosition" = ordered_projects.position
FROM ordered_projects
WHERE "projects"."id" = ordered_projects."id";

ALTER TABLE "projects"
  ALTER COLUMN "catalogPosition" SET NOT NULL;

CREATE UNIQUE INDEX "projects_catalogPosition_key" ON "projects"("catalogPosition");
CREATE UNIQUE INDEX "projects_single_featured_idx" ON "projects"("featured") WHERE "featured" = true;
CREATE UNIQUE INDEX "platform_links_projectId_platform_scope_key"
  ON "platform_links"("projectId", "platform", "scope");

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_catalogPosition_positive" CHECK ("catalogPosition" > 0),
  ADD CONSTRAINT "projects_artworkTone_allowed" CHECK ("artworkTone" IN ('gold', 'wine', 'graphite', 'bronze', 'ivory'));
