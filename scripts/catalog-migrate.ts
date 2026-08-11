import { config } from "dotenv";
import type { Prisma } from "@/generated/prisma/client";

config({ path: ".env.local", quiet: true });

const dryRun = process.argv.includes("--dry-run");
const [{ assertApprovedCatalogDatabase }, legacy, mapper, { prisma }] = await Promise.all([
  import("@/scripts/catalog-guard"),
  import("@/lib/catalog/legacy"),
  import("@/lib/catalog/mapper"),
  import("@/lib/prisma"),
]);

const include = {
  tracks: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  platformLinks: { where: { scope: { in: ["RELEASE" as const, "STORE" as const] } }, orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  credits: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  confidenceAnnotations: true,
  assets: { where: { role: "COVER" as const }, take: 1, include: { asset: true } },
} satisfies Prisma.ProjectInclude;

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function run() {
  const { target } = await assertApprovedCatalogDatabase();
  const source = legacy.getLegacyCatalogue();
  let creates = 0;
  let skips = 0;
  const conflicts: string[] = [];

  const runtimeColumns = await prisma.$queryRaw<Array<{ present: bigint }>>`
    SELECT COUNT(*)::bigint AS present
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'projects' AND column_name = 'legacySourceVersion'
  `;
  if (dryRun && Number(runtimeColumns[0]?.present ?? 0) === 0) {
    const existing = await prisma.$queryRaw<Array<{ slug: string }>>`SELECT "slug" FROM "projects" ORDER BY "slug"`;
    const existingSlugs = new Set(existing.map(({ slug }) => slug));
    creates = source.filter(({ slug }) => !existingSlugs.has(slug)).length;
    conflicts.push(...source.filter(({ slug }) => existingSlugs.has(slug)).map(({ slug }) => slug));
    console.info(`Catalogue dry-run on ${target}: ${creates} create(s), 0 identical skip(s), ${conflicts.length} conflict(s).`);
    if (conflicts.length) throw new Error(`Pre-migration catalogue conflicts require a manual review: ${conflicts.join(", ")}`);
    return;
  }

  for (const project of source) {
    const existing = await prisma.project.findUnique({ where: { slug: project.slug }, include });
    if (!existing) { creates += 1; continue; }
    const equal = same(legacy.normalizeProjectForParity(project), legacy.normalizeProjectForParity(mapper.mapDatabaseProject(existing)));
    if (existing.legacySourceVersion === legacy.CATALOG_SOURCE_VERSION && equal) skips += 1;
    else conflicts.push(project.slug);
  }

  console.info(`Catalogue ${dryRun ? "dry-run" : "migration"} on ${target}: ${creates} create(s), ${skips} identical skip(s), ${conflicts.length} conflict(s).`);
  if (conflicts.length) throw new Error(`Catalogue conflicts require a manual review: ${conflicts.join(", ")}`);
  if (dryRun) return;

  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('lnx-catalog-v0603')) IS NULL AS locked`;
    for (const [index, project] of source.entries()) {
      const exists = await transaction.project.findUnique({ where: { slug: project.slug }, select: { id: true } });
      if (exists) continue;
      const record = legacy.legacyProjectRecord(project, index);
      await transaction.project.create({
        data: {
          slug: record.slug, title: record.title, subtitle: record.subtitle,
          type: record.type, status: record.status, catalogPosition: record.catalogPosition,
          highlighted: record.highlighted, featured: record.featured,
          shortDescription: record.shortDescription, description: record.description,
          releaseDate: record.releaseDate, trackCount: record.trackCount,
          artworkTone: record.artworkTone, seoTitle: record.seoTitle,
          seoDescription: record.seoDescription, legacySourceVersion: record.legacySourceVersion,
          confidence: record.confidence,
          tracks: { create: record.tracks },
          platformLinks: { create: record.platformLinks },
          credits: { create: record.credits },
          confidenceAnnotations: { create: record.confidenceAnnotations as never },
        },
      });
    }
  });
  console.info(`Catalogue migration complete: ${await prisma.project.count()} project(s) in PostgreSQL.`);
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Catalogue migration failed.");
    process.exitCode = 1;
  });
