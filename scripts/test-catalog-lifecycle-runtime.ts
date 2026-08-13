import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true, override: false });

const QA_SLUGS = ["qa-catalogue-v06301", "qa-catalogue-v06301-double", "qa-catalogue-v06301-shared"] as const;
const QA_ORDER_NUMBER = "QA-V06301-ASSET-SHARED";
const mediaRoot = process.env.MEDIA_LOCAL_PUBLIC_ROOT;

const [{ assertApprovedCatalogDatabase }, service, queries, storage, mediaStorage, { prisma }] = await Promise.all([
  import("@/scripts/catalog-guard"),
  import("@/lib/catalog/service"),
  import("@/lib/catalog/queries"),
  import("@/lib/catalog/media-storage"),
  import("@/lib/media/storage"),
  import("@/lib/prisma"),
]);

async function guard() {
  const { target } = await assertApprovedCatalogDatabase();
  assert.equal(target, "lnx-studio-v0603-test");
  assert.equal(process.env.MEDIA_STORAGE_DRIVER, "local");
  assert.notEqual(process.env.MEDIA_DEPLOYMENT_ENV, "production");
  assert.ok(mediaRoot);
  assert.ok(path.resolve(mediaRoot).startsWith("/private/tmp/lnx-studio-v06301-"));
  assert.ok(process.env.MEDIA_LOCAL_PRIVATE_ROOT);
  assert.ok(path.resolve(process.env.MEDIA_LOCAL_PRIVATE_ROOT).startsWith("/private/tmp/lnx-studio-v06301-"));
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  assert.ok(proofPath);
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as { name?: string; exports?: { database?: { connectionString?: string } } };
  assert.equal(proof.name, target);
  assert.equal(proof.exports?.database?.connectionString, process.env.DATABASE_URL);
}

async function deleteOrphanedAssets(assetIds: string[]) {
  if (!assetIds.length) return;
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds }, projects: { none: {} }, orders: { none: {} } },
    select: { id: true, storageKey: true, storageBackend: true, storageProvider: true, visibility: true },
  });
  for (const asset of assets) {
    try {
      await mediaStorage.deleteMediaObject(asset);
      await prisma.asset.deleteMany({ where: { id: asset.id, projects: { none: {} }, orders: { none: {} } } });
    } catch {
      console.error("A catalogue lifecycle QA media object could not be cleaned; its orphan Asset row was preserved.");
    }
  }
}

async function forceRemoveQaData() {
  const projects = await prisma.project.findMany({ where: { slug: { in: [...QA_SLUGS] } }, select: { id: true } });
  const projectIds = projects.map(({ id }) => id);
  const qaOrder = await prisma.order.findUnique({ where: { orderNumber: QA_ORDER_NUMBER }, select: { id: true } });
  const relations = await prisma.projectAsset.findMany({ where: { projectId: { in: projectIds } }, select: { assetId: true } });
  const orderRelations = qaOrder ? await prisma.orderAsset.findMany({ where: { orderId: qaOrder.id }, select: { assetId: true } }) : [];
  const assetIds = [...new Set([...relations, ...orderRelations].map(({ assetId }) => assetId))];
  const tracks = await prisma.track.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } });
  await prisma.$transaction(async (transaction) => {
    await transaction.credit.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { trackId: { in: tracks.map(({ id }) => id) } }] } });
    await transaction.platformLink.deleteMany({ where: { projectId: { in: projectIds } } });
    await transaction.confidenceAnnotation.deleteMany({ where: { projectId: { in: projectIds } } });
    await transaction.favorite.deleteMany({ where: { projectId: { in: projectIds } } });
    await transaction.projectAsset.deleteMany({ where: { projectId: { in: projectIds } } });
    await transaction.track.deleteMany({ where: { projectId: { in: projectIds } } });
    await transaction.project.deleteMany({ where: { id: { in: projectIds } } });
    if (qaOrder) {
      await transaction.orderAsset.deleteMany({ where: { orderId: qaOrder.id } });
      await transaction.orderEvent.deleteMany({ where: { orderId: qaOrder.id } });
      await transaction.commercialLicense.deleteMany({ where: { orderId: qaOrder.id } });
      await transaction.order.delete({ where: { id: qaOrder.id } });
    }
  });
  await deleteOrphanedAssets(assetIds);
}

function editInput(project: NonNullable<Awaited<ReturnType<typeof service.getAdminCatalogProject>>>, overrides: Record<string, unknown> = {}) {
  return {
    updatedAt: project.updatedAt.toISOString(), title: project.title, subtitle: project.subtitle ?? "", type: project.type.toLowerCase(),
    status: project.status === "IN_DEVELOPMENT" ? "in-development" : project.status === "ARCHIVED" ? "archive" : project.status.toLowerCase(),
    releaseDate: project.releaseDate?.toISOString().slice(0, 10) ?? "", trackCount: project.trackCount ?? "",
    publicVisible: project.publicVisible, featured: project.featured,
    jukeboxPlacement: project.jukeboxPlacement === "PUBLISHED" ? "published" : project.jukeboxPlacement === "DEVELOPMENT" ? "development" : "none",
    jukeboxPosition: project.jukeboxPosition ?? "", shortDescription: project.shortDescription ?? "", description: project.description ?? "",
    seoTitle: project.seoTitle ?? "", seoDescription: project.seoDescription ?? "", ...overrides,
  };
}

async function createAsset(projectIds: string[], suffix: "exclusive" | "shared" | "order-shared", role: "COVER" | "AUDIO_PREVIEW" = "COVER") {
  const bytes = Buffer.from(`LNX CATALOG LIFECYCLE QA ${suffix}`);
  const isAudio = role === "AUDIO_PREVIEW";
  const storageKey = isAudio ? `catalog/audio-previews/${randomUUID()}.mp3` : `catalog/covers/${randomUUID()}.webp`;
  const stored = isAudio ? await storage.writeCatalogAudioPreview(storageKey, bytes) : await storage.writeCatalogCover(storageKey, bytes);
  const asset = await prisma.asset.create({ data: {
    type: role, storageKey, filename: `${suffix}.${isAudio ? "mp3" : "webp"}`, mimeType: isAudio ? "audio/mpeg" : "image/webp", sizeBytes: BigInt(bytes.length),
    width: isAudio ? null : 1, height: isAudio ? null : 1, durationMs: isAudio ? 60_000 : null,
    storageBackend: stored.storageBackend, storageProvider: stored.storageProvider, visibility: stored.visibility,
    checksumSha256: stored.checksumSha256, rightsStatus: "CLEARED", confidence: "CONFIRMED",
    projects: { create: projectIds.map((projectId) => ({ projectId, role, position: suffix === "shared" ? 1 : 0 })) },
  } });
  return { asset, bytes };
}

async function run() {
  await guard();
  await forceRemoveQaData();
  const before = await prisma.project.count();
  assert.equal(before, 25);

  const created = await service.createCatalogProject({ title: "QA Catalogue V06301", slug: "QA Catalogue V06301", type: "project", status: "draft", releaseDate: "", publicVisible: false, jukeboxPlacement: "none", jukeboxPosition: "", catalogPosition: "", shortDescription: "", description: "" });
  assert.equal(created.slug, "qa-catalogue-v06301");
  assert.equal(created.status, "DRAFT");
  assert.equal(created.publicVisible, false);
  assert.equal(created.featured, false);
  assert.equal(created.jukeboxPlacement, null);
  assert.equal(await prisma.project.count(), 26);
  assert.equal((await service.listAdminCatalogProjects("QA Catalogue V06301", "DRAFT")).length, 1);
  assert.equal(await queries.getPublicProjectBySlug(created.slug), null);
  assert.equal((await queries.listSitemapProjects()).some(({ slug }) => slug === created.slug), false);

  await assert.rejects(
    service.createCatalogProject({ title: "Collision QA", slug: "qa-catalogue-v06301", type: "single", status: "draft", publicVisible: false, jukeboxPlacement: "none" }),
    (error: unknown) => error instanceof service.CatalogLifecycleError && error.code === "SLUG_TAKEN",
  );
  const double = await Promise.allSettled([
    service.createCatalogProject({ title: "Double QA", slug: "qa-catalogue-v06301-double", type: "single", status: "draft", publicVisible: false, jukeboxPlacement: "none" }),
    service.createCatalogProject({ title: "Double QA", slug: "qa-catalogue-v06301-double", type: "single", status: "draft", publicVisible: false, jukeboxPlacement: "none" }),
  ]);
  assert.equal(double.filter(({ status }) => status === "fulfilled").length, 1);
  const doubleProject = await prisma.project.findUniqueOrThrow({ where: { slug: "qa-catalogue-v06301-double" } });
  await service.deleteCatalogProject(doubleProject.id, doubleProject.slug);

  let project = await service.getAdminCatalogProject(created.slug);
  assert.ok(project);
  await service.updateCatalogProject(project.id, editInput(project, { title: "QA Catalogue V06301 modifié", description: "Récit QA persisté.", status: "published", publicVisible: true }));
  project = await service.getAdminCatalogProject(created.slug);
  assert.equal(project?.title, "QA Catalogue V06301 modifié");
  assert.ok(await queries.getPublicProjectBySlug(created.slug));
  assert.equal((await queries.listSitemapProjects()).some(({ slug }) => slug === created.slug), true);
  assert.equal((await queries.listDiscographyProjects()).publishedJukeboxProjects.some(({ slug }) => slug === created.slug), false, "A project without cover must not enter the jukebox.");

  await assert.rejects(service.deleteCatalogProject(project!.id, project!.slug), (error: unknown) => error instanceof service.CatalogLifecycleError && error.code === "DELETE_FORBIDDEN");
  const featured = await prisma.project.findFirstOrThrow({ where: { featured: true }, select: { id: true, slug: true } });
  await assert.rejects(service.deleteCatalogProject(featured.id, featured.slug), (error: unknown) => error instanceof service.CatalogLifecycleError && error.code === "DELETE_FORBIDDEN");

  await service.hideCatalogProject(project!.id);
  project = await service.getAdminCatalogProject(created.slug);
  assert.equal(project?.publicVisible, false);
  assert.equal(await queries.getPublicProjectBySlug(created.slug), null);
  await service.updateCatalogProject(project!.id, editInput(project!, { publicVisible: true }));
  assert.ok(await queries.getPublicProjectBySlug(created.slug), "Hiding must be reversible.");
  await service.archiveCatalogProject(project!.id);
  project = await service.getAdminCatalogProject(created.slug);
  assert.equal(project?.status, "ARCHIVED");
  assert.equal(project?.publicVisible, false);
  assert.equal(project?.jukeboxPlacement, null);
  await service.updateCatalogProject(project!.id, editInput(project!, { status: "in-development", publicVisible: true, jukeboxPlacement: "none" }));
  assert.ok(await queries.getPublicProjectBySlug(created.slug), "Archiving must be reversible.");

  await service.addCatalogTrack(project!.id, { title: "Piste QA", durationSeconds: "60", status: "announced" });
  const track = (await service.getAdminCatalogProject(created.slug))!.tracks[0]!;
  await prisma.credit.create({ data: { trackId: track.id, name: "Crédit piste QA", role: "WRITER", position: 1 } });
  await service.addCatalogCredit(project!.id, { name: "Crédit projet QA", role: "producer", note: "Jetable" });
  await service.addCatalogPlatformLink(project!.id, { platform: "other", scope: "release", url: "https://example.invalid/v06301", label: "Lien QA" });
  await prisma.confidenceAnnotation.create({ data: { projectId: project!.id, domain: "EDITORIAL", level: "PARTIAL", source: "QA" } });
  const qaUser = await prisma.user.create({ data: { email: "catalogue-v06301@example.invalid", displayName: "Catalogue QA", status: "ACTIVE", emailVerified: true } });
  await prisma.favorite.create({ data: { userId: qaUser.id, projectId: project!.id } });

  const sharedProject = await service.createCatalogProject({ title: "QA Catalogue Shared", slug: "qa-catalogue-v06301-shared", type: "project", status: "draft", publicVisible: false, jukeboxPlacement: "none" });
  const exclusive = await createAsset([project!.id], "exclusive");
  const exclusiveAudio = await createAsset([project!.id], "exclusive", "AUDIO_PREVIEW");
  const shared = await createAsset([project!.id, sharedProject.id], "shared");
  const orderShared = await createAsset([project!.id], "order-shared");
  const qaOrder = await prisma.order.create({ data: {
    orderNumber: QA_ORDER_NUMBER, customerEmail: "catalogue-v06301-order@example.invalid", brief: "Commande QA jetable pour vérifier un asset partagé.",
    assets: { create: { assetId: orderShared.asset.id, role: "REFERENCE", position: 0 } },
  } });
  await assert.rejects(service.deleteCatalogProject(project!.id, "mauvaise-confirmation"), (error: unknown) => error instanceof service.CatalogLifecycleError && error.code === "CONFIRMATION_INVALID");
  await service.archiveCatalogProject(project!.id);
  const deletion = await service.deleteCatalogProject(project!.id, project!.slug);
  assert.equal(deletion.cleanupFailed, false);
  assert.equal(await prisma.project.count({ where: { id: project!.id } }), 0);
  assert.equal(await prisma.track.count({ where: { projectId: project!.id } }), 0);
  assert.equal(await prisma.credit.count({ where: { OR: [{ projectId: project!.id }, { trackId: track.id }] } }), 0);
  assert.equal(await prisma.platformLink.count({ where: { projectId: project!.id } }), 0);
  assert.equal(await prisma.confidenceAnnotation.count({ where: { projectId: project!.id } }), 0);
  assert.equal(await prisma.favorite.count({ where: { projectId: project!.id } }), 0);
  assert.equal(await prisma.asset.count({ where: { id: exclusive.asset.id } }), 0);
  await assert.rejects(storage.readCatalogCover(exclusive.asset.storageKey));
  assert.equal(await prisma.asset.count({ where: { id: exclusiveAudio.asset.id } }), 0);
  await assert.rejects(storage.readCatalogAudioPreview(exclusiveAudio.asset.storageKey));
  assert.equal(await prisma.asset.count({ where: { id: shared.asset.id } }), 1);
  assert.deepEqual(await storage.readCatalogCover(shared.asset.storageKey), shared.bytes);
  assert.equal(await prisma.asset.count({ where: { id: orderShared.asset.id } }), 1, "An Asset shared with an Order must survive project deletion.");
  assert.deepEqual(await storage.readCatalogCover(orderShared.asset.storageKey), orderShared.bytes);

  await service.deleteCatalogProject(sharedProject.id, sharedProject.slug);
  assert.equal(await prisma.asset.count({ where: { id: shared.asset.id } }), 0);
  await assert.rejects(storage.readCatalogCover(shared.asset.storageKey));
  await prisma.orderAsset.deleteMany({ where: { orderId: qaOrder.id } });
  await prisma.order.delete({ where: { id: qaOrder.id } });
  await deleteOrphanedAssets([orderShared.asset.id]);
  assert.equal(await prisma.asset.count({ where: { id: orderShared.asset.id } }), 0);
  await assert.rejects(storage.readCatalogCover(orderShared.asset.storageKey));
  await prisma.user.delete({ where: { id: qaUser.id } });
  assert.equal(await prisma.project.count(), 25);
  assert.equal(await prisma.project.count({ where: { slug: { in: [...QA_SLUGS] } } }), 0);
  console.info("Catalogue lifecycle runtime passed: 25→26→25, private defaults, collision, publication, reversible hide/archive, guarded deletion, relations and media cleanup.");
}

run().finally(async () => {
  await forceRemoveQaData();
  await prisma.user.deleteMany({ where: { email: "catalogue-v06301@example.invalid" } });
  await prisma.$disconnect();
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Catalogue lifecycle runtime failed.");
  process.exitCode = 1;
});
