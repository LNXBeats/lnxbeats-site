import assert from "node:assert/strict";
import { config } from "dotenv";
import sharp from "sharp";

config({ path: ".env.local", quiet: true });

const [{ assertApprovedCatalogDatabase }, service, cover, storage, legacy, queries, { prisma }] = await Promise.all([
  import("@/scripts/catalog-guard"), import("@/lib/catalog/service"), import("@/lib/catalog/cover"),
  import("@/lib/catalog/media-storage"), import("@/lib/catalog/legacy"), import("@/lib/catalog/queries"), import("@/lib/prisma"),
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
    publicVisible: project.publicVisible,
    jukeboxPlacement: project.jukeboxPlacement === "PUBLISHED" ? "published" : project.jukeboxPlacement === "DEVELOPMENT" ? "development" : "none",
    jukeboxPosition: project.jukeboxPosition ?? "",
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

  const input = { ...projectInput(initial, `${initial.title} QA`), status: "published", publicVisible: false, jukeboxPlacement: "development", jukeboxPosition: "7", description: "Récit éditorial QA persisté." };
  const competing = await Promise.allSettled([
    service.updateCatalogProject(initial.id, input), service.updateCatalogProject(initial.id, input),
  ]);
  assert.equal(competing.filter(({ status }) => status === "fulfilled").length, 1, "Optimistic locking must accept one concurrent edit only.");
  let changed = await service.getAdminCatalogProject(initial.slug);
  assert.equal(changed?.status, "PUBLISHED");
  assert.equal(changed?.publicVisible, false);
  assert.equal(changed?.jukeboxPlacement, "DEVELOPMENT");
  assert.equal(changed?.jukeboxPosition, 7);
  assert.equal(changed?.description, "Récit éditorial QA persisté.");
  assert.equal(await queries.getPublicProjectBySlug(initial.slug), null);
  assert.equal((await queries.listSitemapProjects()).some(({ slug }) => slug === initial.slug), false);
  assert.ok(changed);
  await service.updateCatalogProject(initial.id, { ...projectInput(changed, changed.title), publicVisible: true });
  assert.ok(await queries.getPublicProjectBySlug(initial.slug));
  assert.equal((await queries.listSitemapProjects()).some(({ slug }) => slug === initial.slug), true);

  await service.addCatalogTrack(initial.id, { title: "Piste QA 1", durationSeconds: "75", status: "announced" });
  await service.addCatalogTrack(initial.id, { title: "Piste QA 2", durationSeconds: "", status: "unlisted" });
  changed = await service.getAdminCatalogProject(initial.slug);
  assert.ok(changed && changed.tracks.length === 2);
  await service.moveCatalogTrack(initial.id, changed.tracks[1]!.id, "up");
  changed = await service.getAdminCatalogProject(initial.slug);
  assert.equal(changed?.tracks[0]?.title, "Piste QA 2");
  await service.updateCatalogTrack(initial.id, changed!.tracks[0]!.id, { title: "Piste QA déplacée", durationSeconds: "90", status: "released" });
  await service.deleteCatalogTrack(initial.id, changed!.tracks[1]!.id);
  assert.equal((await service.getAdminCatalogProject(initial.slug))?.tracks.length, 1);

  const credit = await service.addCatalogCredit(initial.id, { role: "writer", name: "Crédit QA", note: "Paroles" });
  await service.updateCatalogCredit(initial.id, credit.id, { role: "producer", name: "Crédit QA modifié", note: "Production" });
  assert.equal((await service.getAdminCatalogProject(initial.slug))?.credits.find(({ id }) => id === credit.id)?.role, "PRODUCER");
  assert.equal((await queries.getPublicProjectBySlug(initial.slug))?.credits.some(({ name }) => name === "Crédit QA modifié"), true);
  await service.deleteCatalogCredit(initial.id, credit.id);
  assert.equal((await service.getAdminCatalogProject(initial.slug))?.credits.some(({ id }) => id === credit.id), false);
  assert.equal((await queries.getPublicProjectBySlug(initial.slug))?.credits.length, 0);

  const link = await service.addCatalogPlatformLink(initial.id, { platform: "other", scope: "release", label: "Lien QA", url: "https://example.invalid/lnx-catalogue" });
  await service.updateCatalogPlatformLink(initial.id, link.id, { platform: "other", scope: "store", label: "Boutique QA", url: "https://example.invalid/lnx-catalogue-store" });
  await service.deleteCatalogPlatformLink(initial.id, link.id);
  assert.equal((await service.getAdminCatalogProject(initial.slug))?.platformLinks.length, 0);

  const beforeCover = await service.getAdminCatalogProject(initial.slug);
  assert.ok(beforeCover);
  const png = await sharp({ create: { width: 3_000, height: 3_000, channels: 3, background: "#d6b36a" } }).png().toBuffer();
  const file = new File([png], "qa-cover-3000.png", { type: "image/png" });
  const staleProjectUpdatedAt = beforeCover.updatedAt;
  await service.updateCatalogProject(initial.id, projectInput(beforeCover, `${beforeCover.title} indépendant`));
  const afterIndependentProjectEdit = await service.getAdminCatalogProject(initial.slug);
  assert.ok(afterIndependentProjectEdit);
  assert.notEqual(afterIndependentProjectEdit.updatedAt.getTime(), staleProjectUpdatedAt.getTime());
  await cover.replaceCatalogCover(initial.id, null, file, "Cover QA jetable");
  const withCover = await service.getAdminCatalogProject(initial.slug);
  assert.equal(withCover?.assets.length, 1);
  const asset = withCover!.assets[0]!.asset;
  const bytes = await storage.readCatalogCover(asset.storageKey);
  assert.ok(bytes.length > 0);
  assert.equal(asset.mimeType, "image/webp");

  const expectedCoverA = asset.id;
  const concurrentJpeg = await sharp({ create: { width: 3_000, height: 3_000, channels: 3, background: "#2c2219" } }).jpeg().toBuffer();
  await cover.replaceCatalogCover(initial.id, expectedCoverA, new File([concurrentJpeg], "qa-cover-b-3000.jpg", { type: "image/jpeg" }), "Cover QA B");
  const withCoverB = await service.getAdminCatalogProject(initial.slug);
  const coverB = withCoverB!.assets[0]!.asset;
  await assert.rejects(
    cover.replaceCatalogCover(initial.id, expectedCoverA, new File([concurrentJpeg], "qa-cover-c-3000.jpg", { type: "image/jpeg" }), "Cover QA C"),
    (error: unknown) => error instanceof cover.CatalogCoverConflictError && error.currentCoverAssetId === coverB.id,
  );
  assert.equal((await service.getAdminCatalogProject(initial.slug))?.assets[0]?.asset.id, coverB.id, "A stale client must not replace cover B.");

  await assert.rejects(
    cover.deleteCatalogCover(initial.id, expectedCoverA),
    (error: unknown) => error instanceof cover.CatalogCoverConflictError && error.currentCoverAssetId === coverB.id,
  );
  await cover.deleteCatalogCover(initial.id, coverB.id);
  assert.equal((await service.getAdminCatalogProject(initial.slug))?.assets.length, 0);

  const firstCoverRace = await Promise.allSettled([
    cover.replaceCatalogCover(initial.id, null, new File([png], "qa-first-cover-a.png", { type: "image/png" }), "Première cover A"),
    cover.replaceCatalogCover(initial.id, null, new File([concurrentJpeg], "qa-first-cover-b.jpg", { type: "image/jpeg" }), "Première cover B"),
  ]);
  assert.equal(firstCoverRace.filter(({ status }) => status === "fulfilled").length, 1, "Concurrent first covers must accept one write only.");
  const rejectedFirstCover = firstCoverRace.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.equal(rejectedFirstCover.length, 1);
  assert.ok(rejectedFirstCover[0]!.reason instanceof cover.CatalogCoverConflictError);
  const afterConcurrentFirstCover = await service.getAdminCatalogProject(initial.slug);
  assert.equal(afterConcurrentFirstCover?.assets.length, 1);
  const finalAsset = afterConcurrentFirstCover!.assets[0]!.asset;

  await cover.deleteCatalogCover(initial.id, finalAsset.id);
  assert.equal((await service.getAdminCatalogProject(initial.slug))?.assets.length, 0);
  console.info("Catalogue runtime passed: publication, tracks, credits, cover concurrency and safe cover deletion validated.");
}

run().finally(async () => {
  await restoreFixture();
  await prisma.$disconnect();
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Catalogue runtime failed.");
  process.exitCode = 1;
});
