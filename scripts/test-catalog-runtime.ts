import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";

config({ path: ".env.local", quiet: true });

const [{ assertApprovedCatalogDatabase }, service, cover, storage, legacy, { prisma }] = await Promise.all([
  import("@/scripts/catalog-guard"), import("@/lib/catalog/service"), import("@/lib/catalog/cover"),
  import("@/lib/catalog/media-storage"), import("@/lib/catalog/legacy"), import("@/lib/prisma"),
]);

let qaAuthorized = false;

async function restoreFixture() {
  if (!qaAuthorized) return;
  const fixtureIndex = legacy.getLegacyCatalogue().findIndex(({ slug }) => slug === "laboratoire-narratif");
  const fixture = legacy.getLegacyCatalogue()[fixtureIndex]!;
  const record = legacy.legacyProjectRecord(fixture, fixtureIndex);
  const existing = await prisma.project.findUnique({ where: { slug: fixture.slug }, include: { assets: { include: { asset: true } } } });
  const storedCovers = existing?.assets.map(({ asset }) => asset.storageKey) ?? [];
  await prisma.$transaction(async (transaction) => {
    if (existing) {
      await transaction.projectAsset.deleteMany({ where: { projectId: existing.id } });
      for (const relation of existing.assets) await transaction.asset.delete({ where: { id: relation.assetId } });
      await transaction.confidenceAnnotation.deleteMany({ where: { projectId: existing.id } });
      await transaction.credit.deleteMany({ where: { projectId: existing.id } });
      await transaction.platformLink.deleteMany({ where: { projectId: existing.id } });
      await transaction.track.deleteMany({ where: { projectId: existing.id } });
      await transaction.favorite.deleteMany({ where: { projectId: existing.id } });
      await transaction.project.delete({ where: { id: existing.id } });
    }
    await transaction.project.create({ data: {
      slug: record.slug, title: record.title, subtitle: record.subtitle, type: record.type, status: record.status,
      catalogPosition: record.catalogPosition, highlighted: record.highlighted, featured: record.featured,
      shortDescription: record.shortDescription, description: record.description, releaseDate: record.releaseDate,
      trackCount: record.trackCount, artworkTone: record.artworkTone, seoTitle: record.seoTitle,
      seoDescription: record.seoDescription, legacySourceVersion: record.legacySourceVersion, confidence: record.confidence,
      tracks: { create: record.tracks }, platformLinks: { create: record.platformLinks }, credits: { create: record.credits },
      confidenceAnnotations: { create: record.confidenceAnnotations as never },
    } });
  });
  for (const key of storedCovers) await storage.removeCatalogCover(key);
}

function projectInput(project: Awaited<ReturnType<typeof service.getAdminCatalogProject>>, title: string) {
  assert.ok(project);
  return {
    updatedAt: project.updatedAt.toISOString(), title, subtitle: project.subtitle ?? "",
    type: project.type.toLowerCase(),
    status: project.status === "IN_DEVELOPMENT" ? "in-development" : project.status.toLowerCase(),
    shortDescription: project.shortDescription ?? "", description: project.description ?? "",
    releaseDate: project.releaseDate?.toISOString().slice(0, 10) ?? "", featured: project.featured,
    trackCount: project.trackCount ?? "", seoTitle: project.seoTitle ?? "", seoDescription: project.seoDescription ?? "",
    confidence: project.confidence.toLowerCase(),
  };
}

async function run() {
  const { target } = await assertApprovedCatalogDatabase();
  assert.equal(target, "lnx-studio-v0603-test", "Runtime mutations are allowed only on the disposable catalogue database.");
  qaAuthorized = true;
  await restoreFixture();
  assert.equal(await prisma.project.count(), 25);
  const initial = await service.getAdminCatalogProject("laboratoire-narratif");
  assert.ok(initial);

  const input = projectInput(initial, `${initial.title} QA`);
  const competing = await Promise.allSettled([
    service.updateCatalogProject(initial.id, input), service.updateCatalogProject(initial.id, input),
  ]);
  assert.equal(competing.filter(({ status }) => status === "fulfilled").length, 1, "Optimistic locking must accept one concurrent edit only.");

  await service.addCatalogTrack(initial.id, { title: "Piste QA 1", durationSeconds: "75", status: "announced" });
  await service.addCatalogTrack(initial.id, { title: "Piste QA 2", durationSeconds: "", status: "unlisted" });
  let changed = await service.getAdminCatalogProject(initial.slug);
  assert.ok(changed && changed.tracks.length === 2);
  await service.moveCatalogTrack(initial.id, changed.tracks[1]!.id, "up");
  changed = await service.getAdminCatalogProject(initial.slug);
  assert.equal(changed?.tracks[0]?.title, "Piste QA 2");
  await service.updateCatalogTrack(initial.id, changed!.tracks[0]!.id, { title: "Piste QA déplacée", durationSeconds: "90", status: "released" });
  await service.deleteCatalogTrack(initial.id, changed!.tracks[1]!.id);
  assert.equal((await service.getAdminCatalogProject(initial.slug))?.tracks.length, 1);

  const link = await service.addCatalogPlatformLink(initial.id, { platform: "other", scope: "release", label: "Lien QA", url: "https://example.invalid/lnx-catalogue" });
  await service.updateCatalogPlatformLink(initial.id, link.id, { platform: "other", scope: "store", label: "Boutique QA", url: "https://example.invalid/lnx-catalogue-store" });
  await service.deleteCatalogPlatformLink(initial.id, link.id);
  assert.equal((await service.getAdminCatalogProject(initial.slug))?.platformLinks.length, 0);

  const beforeCover = await service.getAdminCatalogProject(initial.slug);
  assert.ok(beforeCover);
  const png = await sharp({ create: { width: 3_000, height: 3_000, channels: 3, background: "#d6b36a" } }).png().toBuffer();
  const file = new File([png], "qa-cover-3000.png", { type: "image/png" });
  await cover.replaceCatalogCover(initial.id, beforeCover.updatedAt.toISOString(), file, "Cover QA jetable");
  const withCover = await service.getAdminCatalogProject(initial.slug);
  assert.equal(withCover?.assets.length, 1);
  const asset = withCover!.assets[0]!.asset;
  const bytes = await storage.readCatalogCover(asset.storageKey);
  assert.ok(bytes.length > 0);
  assert.equal(asset.mimeType, "image/webp");

  const concurrentSource = await service.getAdminCatalogProject(initial.slug);
  assert.ok(concurrentSource);
  const concurrentJpeg = await sharp({ create: { width: 3_000, height: 3_000, channels: 3, background: "#2c2219" } }).jpeg().toBuffer();
  const concurrentFile = new File([concurrentJpeg], "qa-cover-concurrent-3000.jpg", { type: "image/jpeg" });
  const concurrent = await Promise.allSettled([
    cover.replaceCatalogCover(initial.id, concurrentSource.updatedAt.toISOString(), concurrentFile, "Cover QA concurrente A"),
    cover.replaceCatalogCover(initial.id, concurrentSource.updatedAt.toISOString(), concurrentFile, "Cover QA concurrente B"),
  ]);
  assert.equal(concurrent.filter(({ status }) => status === "fulfilled").length, 1, "Concurrent cover replacement must accept one write only.");
  const afterConcurrent = await service.getAdminCatalogProject(initial.slug);
  assert.equal(afterConcurrent?.assets.length, 1);
  const finalAsset = afterConcurrent!.assets[0]!.asset;

  await prisma.$transaction(async (transaction) => {
    await transaction.projectAsset.deleteMany({ where: { assetId: finalAsset.id } });
    await transaction.asset.delete({ where: { id: finalAsset.id } });
  });
  await storage.removeCatalogCover(finalAsset.storageKey);
  console.info("Catalogue runtime passed: concurrency, project, track, platform and private cover storage checks.");
}

run().finally(async () => {
  await restoreFixture();
  await prisma.$disconnect();
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Catalogue runtime failed.");
  process.exitCode = 1;
});
