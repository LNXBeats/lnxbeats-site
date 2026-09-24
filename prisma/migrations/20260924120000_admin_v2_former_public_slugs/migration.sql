-- Additive URL history. No existing rows or public URLs are rewritten.
ALTER TABLE "projects" ADD COLUMN "formerSlugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "creations" ADD COLUMN "formerSlugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "products" ADD COLUMN "formerSlugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
