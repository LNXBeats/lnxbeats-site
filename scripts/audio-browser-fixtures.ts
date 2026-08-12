import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { generateAndReplaceCatalogAudioPreview } from "@/lib/catalog/audio";
import { removeCatalogAudioPreview } from "@/lib/catalog/media-storage";
import { prisma } from "@/lib/prisma";
import { createAudioFixture } from "@/tests/audio/fixture";

const QA_TARGET = "lnx-studio-v0604-test";
const QA_EMAIL = "lnx-v0604-browser-admin@example.invalid";
const QA_FIXTURE_PATH = "/private/tmp/lnx-studio-v0604-browser-fixture.mp3";
const PROJECT_SLUG = "laboratoire-narratif";

function validateEnvironment() {
  assert.equal(process.env.LNX_DATABASE_TARGET, QA_TARGET);
  assert.ok(process.env.DATABASE_URL);
  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname));
  assert.ok(databaseUrl.port && databaseUrl.port !== "5432");
  assert.ok(process.env.MEDIA_STORAGE_ROOT?.startsWith("/private/tmp/lnx-studio-v0604-audio-qa-"));
  assert.ok(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12);
}

async function removeQaAudio(projectId: string) {
  const relations = await prisma.projectAsset.findMany({
    where: { projectId, role: "AUDIO_PREVIEW" },
    include: { asset: true },
  });
  await prisma.$transaction(async (transaction) => {
    await transaction.projectAsset.deleteMany({ where: { projectId, role: "AUDIO_PREVIEW" } });
    for (const relation of relations) await transaction.asset.deleteMany({ where: { id: relation.assetId } });
  });
  for (const relation of relations) await removeCatalogAudioPreview(relation.asset.storageKey);
}

async function removeQaUser() {
  await prisma.$transaction(async (transaction) => {
    await transaction.session.deleteMany({ where: { user: { email: QA_EMAIL } } });
    await transaction.account.deleteMany({ where: { user: { email: QA_EMAIL } } });
    await transaction.user.deleteMany({ where: { email: QA_EMAIL } });
  });
}

async function removeFixtureFile() {
  await unlink(QA_FIXTURE_PATH).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  });
}

async function replaceForConflict() {
  const project = await prisma.project.findUniqueOrThrow({
    where: { slug: PROJECT_SLUG },
    include: { assets: { where: { role: "AUDIO_PREVIEW" }, include: { asset: true } } },
  });
  assert.equal(project.assets.length, 1, "Prepare one browser audio preview before simulating a conflict.");
  const fixture = await createAudioFixture({ seconds: 65, format: "wav" });
  try {
    const replacement = await generateAndReplaceCatalogAudioPreview({
      projectId: project.id,
      rawExpectedAudioAssetId: project.assets[0].assetId,
      sourcePath: fixture.path,
      rawOffsetMs: "0",
      rawRequestedDurationMs: "60000",
    });
    console.info(`Concurrent QA replacement ready: ${replacement.asset.id}`);
  } finally {
    await fixture.cleanup();
  }
}

async function prepare() {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug: PROJECT_SLUG } });
  await removeQaAudio(project.id);
  await removeQaUser();
  await removeFixtureFile();
  await createInternalAuthUser({
    email: QA_EMAIL,
    password: process.env.LNX_AUTH_QA_PASSWORD!,
    displayName: "Audio Browser QA",
    role: "ADMIN",
  });
  await createAudioFixture({ seconds: 150, format: "mp3", outputPath: QA_FIXTURE_PATH });
  console.info(`Audio browser fixture ready: ${PROJECT_SLUG} / ${QA_FIXTURE_PATH}`);
}

async function cleanup() {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug: PROJECT_SLUG } });
  await removeQaAudio(project.id);
  await removeQaUser();
  await removeFixtureFile();
  console.info("Audio browser fixtures removed.");
}

async function run() {
  validateEnvironment();
  if (process.argv.includes("--replace-for-conflict")) await replaceForConflict();
  else if (process.argv.includes("--cleanup")) await cleanup();
  else await prepare();
}

run().finally(() => prisma.$disconnect()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Audio browser fixture setup failed.");
  process.exitCode = 1;
});
