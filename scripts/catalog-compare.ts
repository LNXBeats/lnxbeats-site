import assert from "node:assert/strict";
import { config } from "dotenv";
import type { Prisma } from "@/generated/prisma/client";

config({ path: ".env.local", quiet: true });

const [{ assertApprovedCatalogDatabase }, legacy, mapper, { prisma }] = await Promise.all([
  import("@/scripts/catalog-guard"), import("@/lib/catalog/legacy"), import("@/lib/catalog/mapper"), import("@/lib/prisma"),
]);

const include = {
  tracks: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  platformLinks: { where: { scope: { in: ["RELEASE" as const, "STORE" as const] } }, orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  credits: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  confidenceAnnotations: true,
  assets: { where: { role: "COVER" as const }, take: 1, include: { asset: true } },
} satisfies Prisma.ProjectInclude;

async function run() {
  await assertApprovedCatalogDatabase();
  const source = legacy.getLegacyCatalogue();
  const rows = await prisma.project.findMany({ orderBy: [{ catalogPosition: "asc" }, { id: "asc" }], include });
  assert.equal(rows.length, legacy.LEGACY_CATALOG_PROJECT_COUNT, "PostgreSQL must contain exactly 25 catalogue projects.");
  const sourceSlugs = source.map(({ slug }) => slug);
  assert.deepEqual(rows.map(({ slug }) => slug), sourceSlugs, "Catalogue order or slugs differ.");
  for (const [index, row] of rows.entries()) {
    assert.deepEqual(
      legacy.normalizeProjectForParity(mapper.mapDatabaseProject(row)),
      legacy.normalizeProjectForParity(source[index]!),
      `Catalogue parity failed for ${row.slug}.`,
    );
  }
  assert.equal(rows.filter(({ featured }) => featured).length, 1, "Exactly one homepage project must be featured.");
  console.info(`Catalogue parity passed: ${rows.length}/${source.length} projects are exact.`);
}

run().finally(() => prisma.$disconnect()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Catalogue comparison failed.");
  process.exitCode = 1;
});
