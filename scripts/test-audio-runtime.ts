import assert from "node:assert/strict";
import { access } from "node:fs/promises";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true, override: false });

const [{ assertApprovedCatalogDatabase }, audio, storage, { prisma }, { createAudioFixture }] = await Promise.all([
  import("@/scripts/catalog-guard"),
  import("@/lib/catalog/audio"),
  import("@/lib/catalog/media-storage"),
  import("@/lib/prisma"),
  import("@/tests/audio/fixture"),
]);

let qaAuthorized = false;
let projectId: string | null = null;

async function cleanupAudio() {
  if (!qaAuthorized || !projectId) return;
  const relations = await prisma.projectAsset.findMany({
    where: { projectId, role: "AUDIO_PREVIEW" },
    include: { asset: true },
  });
  await prisma.$transaction(async (transaction) => {
    await transaction.projectAsset.deleteMany({ where: { projectId: projectId!, role: "AUDIO_PREVIEW" } });
    for (const relation of relations) await transaction.asset.deleteMany({ where: { id: relation.assetId } });
  });
  for (const relation of relations) await storage.removeCatalogAudioPreview(relation.asset.storageKey);
}

async function generate({
  expectedAudioAssetId,
  seconds = 150,
  format = "mp3",
  offsetMs = 0,
}: {
  expectedAudioAssetId: string | null;
  seconds?: number;
  format?: "mp3" | "wav";
  offsetMs?: number;
}) {
  assert.ok(projectId);
  const fixture = await createAudioFixture({ seconds, format });
  try {
    return await audio.generateAndReplaceCatalogAudioPreview({
      projectId,
      rawExpectedAudioAssetId: expectedAudioAssetId,
      sourcePath: fixture.path,
      rawOffsetMs: String(offsetMs),
      rawRequestedDurationMs: "60000",
    });
  } finally {
    await fixture.cleanup();
  }
}

async function currentAudio() {
  assert.ok(projectId);
  return prisma.asset.findFirst({
    where: { projects: { some: { projectId, role: "AUDIO_PREVIEW" } } },
  });
}

async function run() {
  const { target } = await assertApprovedCatalogDatabase();
  assert.equal(target, "lnx-studio-v0604-test", "Audio runtime mutations are allowed only on the disposable V0.6.0.4 database.");
  assert.ok(process.env.MEDIA_STORAGE_ROOT?.startsWith("/private/tmp/lnx-studio-v0604-audio-qa-"));
  qaAuthorized = true;
  const project = await prisma.project.findUniqueOrThrow({ where: { slug: "laboratoire-narratif" } });
  projectId = project.id;
  await cleanupAudio();
  assert.equal(await prisma.project.count(), 25);

  const trackDurationsBefore = await prisma.track.findMany({ orderBy: { id: "asc" }, select: { id: true, durationSeconds: true } });
  const firstResult = await generate({ expectedAudioAssetId: null, seconds: 150, offsetMs: 45_000 });
  const first = firstResult.asset;
  assert.equal(first.type, "AUDIO_PREVIEW");
  assert.equal(first.mimeType, "audio/mpeg");
  assert.equal(first.rightsStatus, "CLEARED");
  assert.ok(first.durationMs && first.durationMs >= 59_000 && first.durationMs <= 61_000);
  assert.ok(firstResult.sourceDurationMs >= 149_000);
  assert.equal(firstResult.offsetMs, 45_000);
  const firstBytes = await storage.readCatalogAudioPreview(first.storageKey);
  assert.notEqual(firstBytes.subarray(0, 3).toString("ascii"), "ID3");

  await prisma.project.update({ where: { id: project.id }, data: { legacySourceVersion: null } });
  const secondResult = await generate({ expectedAudioAssetId: first.id, seconds: 65, format: "wav" });
  const second = secondResult.asset;
  await assert.rejects(access(process.env.MEDIA_STORAGE_ROOT + "/" + first.storageKey));
  assert.notEqual(second.id, first.id, "Replacement must create a cache-busting asset identity.");

  await assert.rejects(
    generate({ expectedAudioAssetId: first.id }),
    (error: unknown) => error instanceof audio.CatalogAudioConflictError && error.currentAudioAssetId === second.id,
  );
  assert.equal((await currentAudio())?.id, second.id);
  await assert.rejects(
    audio.deleteCatalogAudioPreview(project.id, first.id),
    (error: unknown) => error instanceof audio.CatalogAudioConflictError && error.currentAudioAssetId === second.id,
  );
  assert.equal((await currentAudio())?.id, second.id, "A stale delete must not remove the newer preview.");

  await audio.deleteCatalogAudioPreview(project.id, second.id);
  assert.equal(await currentAudio(), null);
  await assert.rejects(access(process.env.MEDIA_STORAGE_ROOT + "/" + second.storageKey));

  const firstRace = await Promise.allSettled([
    generate({ expectedAudioAssetId: null, seconds: 20 }),
    generate({ expectedAudioAssetId: null, seconds: 20, format: "wav" }),
  ]);
  assert.equal(firstRace.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(firstRace.filter(({ status }) => status === "rejected").length, 1);
  const rejection = firstRace.find(({ status }) => status === "rejected") as PromiseRejectedResult | undefined;
  assert.ok(rejection?.reason instanceof audio.CatalogAudioConflictError);
  const winning = await currentAudio();
  assert.ok(winning);
  await audio.deleteCatalogAudioPreview(project.id, winning.id);

  const trackDurationsAfter = await prisma.track.findMany({ orderBy: { id: "asc" }, select: { id: true, durationSeconds: true } });
  assert.deepEqual(trackDurationsAfter, trackDurationsBefore, "Audio preview mutations must never change Track.durationSeconds.");
  assert.equal(await prisma.asset.count({ where: { type: "AUDIO_PREVIEW" } }), 0);
  console.info(`Audio runtime passed: MP3 ${firstResult.generationElapsedMs} ms; WAV ${secondResult.generationElapsedMs} ms; generated sizes ${first.sizeBytes}/${second.sizeBytes} bytes.`);
}

run().finally(async () => {
  await cleanupAudio();
  await prisma.$disconnect();
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Audio runtime QA failed.");
  process.exitCode = 1;
});
