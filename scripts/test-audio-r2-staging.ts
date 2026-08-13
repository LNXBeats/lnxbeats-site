import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { access, lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { CATALOG_AUDIO_SOURCE_MAXIMUM_BYTES } from "@/lib/catalog/audio-request";
import { activeMediaStorage } from "@/lib/media/storage/config";
import { MediaStorageError, type MediaStorage, type MediaStorageReference } from "@/lib/media/storage/types";
import { assertR2StagingRuntimeEnvironment } from "@/lib/media/r2-staging-runtime-guard";
import { prisma } from "@/lib/prisma";
import { createAudioFixture } from "@/tests/audio/fixture";

const AUDIO_R2_STAGING_CONFIRMATION = "run-r2-near-80mib-wav-http-qa";
const ADMIN_EMAIL = "lnx-r2-audio-admin@example.invalid";
const QA_SLUG = "qa-r2-audio-near-80mib";
const WAV_SECONDS = 316;
const PUBLIC_AUDIO_PREFIX = "catalog/audio-previews/";
const AUDIO_TEMP_OWNER_MARKER = ".lnx-r2-audio-qa-owner";
const CLOUD_OPERATION_TIMEOUT_MS = 180_000;

type PublicReference = Pick<MediaStorageReference, "storageKey" | "storageBackend" | "storageProvider" | "visibility">;

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
  const raw = values.find((value) => /^(?:__Secure-)?lnx-studio\.session_token=/.test(value));
  assert.ok(raw, "The isolated QA sign-in endpoint must issue a session cookie.");
  return raw.split(";", 1)[0];
}

async function assertRuntimeProof(target: string, databaseUrl: string, proofPath: string) {
  let proof: { name?: string; pid?: number; exports?: { database?: { connectionString?: string } } };
  try {
    proof = JSON.parse(await readFile(proofPath, "utf8")) as typeof proof;
  } catch {
    throw new Error("The isolated PostgreSQL runtime proof is unreadable.");
  }
  if (proof.name !== target || proof.exports?.database?.connectionString !== databaseUrl) {
    throw new Error("The isolated PostgreSQL runtime proof does not match the selected *-test database.");
  }
  if (!proof.pid || proof.pid <= 0) throw new Error("The isolated PostgreSQL runtime proof has no process identifier.");
  try { process.kill(proof.pid, 0); }
  catch { throw new Error("The isolated PostgreSQL runtime process is not active."); }
}

function configuredAudioTemporaryRoot() {
  const configured = process.env.AUDIO_TEMP_ROOT?.trim();
  if (!configured) throw new Error("AUDIO_TEMP_ROOT is required for the R2 large-WAV QA.");
  const resolved = path.resolve(configured);
  if (
    path.dirname(resolved) !== "/private/tmp"
    || !/^lnx-studio-r2-audio-qa-[a-z0-9][a-z0-9._-]{5,80}$/i.test(path.basename(resolved))
  ) {
    throw new Error("AUDIO_TEMP_ROOT must be a dedicated /private/tmp/lnx-studio-r2-audio-qa-* directory.");
  }
  return resolved;
}

async function createOwnedAudioTemporaryRoot() {
  const root = configuredAudioTemporaryRoot();
  const existing = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing) throw new Error("AUDIO_TEMP_ROOT must not exist before the R2 large-WAV QA starts.");

  const owner = randomUUID();
  let created = false;
  try {
    await mkdir(root, { mode: 0o700 });
    created = true;
    await writeFile(path.join(root, AUDIO_TEMP_OWNER_MARKER), owner, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return { root, owner } as const;
  } catch (error) {
    if (created) await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function removeOwnedAudioTemporaryRoot(owned: { root: string; owner: string }) {
  const markerPath = path.join(owned.root, AUDIO_TEMP_OWNER_MARKER);
  const marker = await readFile(markerPath, "utf8").catch(() => null);
  if (marker !== owned.owner) {
    throw new Error("Refusing to remove an AUDIO_TEMP_ROOT not owned by this QA execution.");
  }
  await rm(owned.root, { recursive: true, force: false });
}

async function assertEmptyAudioTemporaryRoot(root: string) {
  const sourceRoot = path.join(root, "lnx-studio", "catalog", "audio-sources-temp");
  const entries = await readdir(sourceRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  assert.deepEqual(entries, [], "The complete WAV and generated FFmpeg temporary file must both be removed.");
}

async function login(baseUrl: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email: ADMIN_EMAIL, password, rememberMe: true }),
    signal: AbortSignal.timeout(CLOUD_OPERATION_TIMEOUT_MS),
  });
  assert.equal(response.status, 200, "The isolated QA Admin must be able to sign in.");
  return sessionCookie(response);
}

function uploadForm(project: { id: string; slug: string }, file: File) {
  const body = new FormData();
  body.set("projectId", project.id);
  body.set("slug", project.slug);
  body.set("expectedAudioAssetId", "");
  body.set("rightsConfirmed", "on");
  body.set("offsetMs", "0");
  body.set("requestedDurationMs", "60000");
  body.set("audio", file, file.name);
  return body;
}

async function upload(baseUrl: string, project: { id: string; slug: string }, file: File, cookie: string) {
  return fetch(`${baseUrl}/api/admin/catalogue/audio`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: baseUrl,
      referer: `${baseUrl}/admin/catalogue/${project.slug}`,
      accept: "application/json",
      "x-lnx-audio-upload": "browser",
      cookie,
    },
    body: uploadForm(project, file),
    signal: AbortSignal.timeout(CLOUD_OPERATION_TIMEOUT_MS),
  });
}

async function remove(baseUrl: string, project: { id: string; slug: string }, assetId: string, cookie: string) {
  return fetch(`${baseUrl}/api/admin/catalogue/audio`, {
    method: "DELETE",
    redirect: "manual",
    headers: { origin: baseUrl, cookie, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, slug: project.slug, expectedAudioAssetId: assetId }),
    signal: AbortSignal.timeout(CLOUD_OPERATION_TIMEOUT_MS),
  });
}

async function listPublicAudioKeys(client: S3Client, bucket: string) {
  const keys = new Set<string>();
  let continuationToken: string | undefined;
  try {
    do {
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: PUBLIC_AUDIO_PREFIX,
          ContinuationToken: continuationToken,
        }),
        { abortSignal: AbortSignal.timeout(CLOUD_OPERATION_TIMEOUT_MS) },
      );
      for (const object of result.Contents ?? []) if (object.Key) keys.add(object.Key);
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
  } catch {
    throw new Error("The R2 staging public-bucket inventory failed.");
  }
  return keys;
}

async function createQaProject() {
  const maximum = await prisma.project.aggregate({ _max: { catalogPosition: true } });
  return prisma.project.create({
    data: {
      slug: QA_SLUG,
      title: "QA R2 Audio Near 80 MiB",
      type: "PROJECT",
      status: "IN_DEVELOPMENT",
      publicVisible: true,
      catalogPosition: (maximum._max.catalogPosition ?? 0) + 1,
      featured: false,
      highlighted: false,
      shortDescription: "Fixture staging temporaire.",
      confidence: "UNKNOWN",
      legacySourceVersion: null,
    },
  });
}

async function cleanupQaData(storage: MediaStorage, learnedQaKeys: Set<string>) {
  const project = await prisma.project.findUnique({
    where: { slug: QA_SLUG },
    include: { assets: { include: { asset: true } } },
  });
  const references: PublicReference[] = project?.assets.map(({ asset }) => ({
    storageKey: asset.storageKey,
    storageBackend: asset.storageBackend,
    storageProvider: asset.storageProvider,
    visibility: asset.visibility,
  })) ?? [];
  for (const { storageKey } of references) learnedQaKeys.add(storageKey);

  await prisma.$transaction(async (transaction) => {
    if (project) {
      const assetIds = project.assets.map(({ assetId }) => assetId);
      await transaction.projectAsset.deleteMany({ where: { projectId: project.id } });
      if (assetIds.length) {
        await transaction.asset.deleteMany({
          where: { id: { in: assetIds }, projects: { none: {} }, orders: { none: {} } },
        });
      }
      await transaction.project.deleteMany({ where: { id: project.id } });
    }
    await transaction.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  });

  for (const key of [...learnedQaKeys]) {
    const stillReferenced = await prisma.asset.findFirst({ where: { storageKey: key }, select: { id: true } });
    if (stillReferenced) continue;
    await storage.delete({ scope: "public", key });
    await expectObjectMissing(storage, key);
    learnedQaKeys.delete(key);
  }
}

async function expectObjectMissing(storage: MediaStorage, key: string) {
  await assert.rejects(
    storage.head({ scope: "public", key }),
    (error: unknown) => error instanceof MediaStorageError && error.code === "NOT_FOUND",
  );
}

async function run() {
  if (process.env.MEDIA_R2_AUDIO_WAV_CONFIRM !== AUDIO_R2_STAGING_CONFIRMATION) {
    throw new Error(`Set MEDIA_R2_AUDIO_WAV_CONFIRM=${AUDIO_R2_STAGING_CONFIRMATION} to run the near-80 MiB WAV staging QA.`);
  }
  const configuration = assertR2StagingRuntimeEnvironment(process.env);
  await assertRuntimeProof(configuration.databaseTarget, process.env.DATABASE_URL!, configuration.proofPath);
  const ownedTempRoot = await createOwnedAudioTemporaryRoot();
  const tempRoot = ownedTempRoot.root;
  let fixtureDirectory: string | null = null;
  let fixturePath: string | null = null;
  let storage: MediaStorage | null = null;
  let inventoryClient: S3Client | null = null;
  const learnedQaKeys = new Set<string>();

  try {
    storage = activeMediaStorage();
    assert.equal(storage.backend, "OBJECT");
    assert.equal(storage.provider, "r2");
    inventoryClient = new S3Client({
      region: "auto",
      endpoint: configuration.endpoint,
      forcePathStyle: false,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey },
    });

    await cleanupQaData(storage, learnedQaKeys);
    const baselineKeys = await listPublicAudioKeys(inventoryClient, configuration.publicBucket);
    const health = await fetch(`${configuration.baseUrl}/api/health`, {
      redirect: "manual",
      signal: AbortSignal.timeout(CLOUD_OPERATION_TIMEOUT_MS),
    });
    assert.equal(health.status, 200, "The isolated QA server health route must answer before the large upload.");
    const healthPayload = await health.json() as { ok?: boolean; mediaStorage?: { backend?: string; provider?: string } };
    assert.equal(healthPayload.ok, true);
    assert.deepEqual(healthPayload.mediaStorage, { backend: "OBJECT", provider: "r2" }, "The QA HTTP server must itself use R2.");

    await createInternalAuthUser({
      email: ADMIN_EMAIL,
      password: configuration.password,
      displayName: "R2 Large WAV Admin QA",
      role: "ADMIN",
    });
    const cookie = await login(configuration.baseUrl, configuration.password);
    const project = await createQaProject();

    fixtureDirectory = await mkdtemp("/private/tmp/lnx-studio-r2-large-wav-fixture-");
    fixturePath = path.join(fixtureDirectory, "near-80-mib.wav");
    await createAudioFixture({ seconds: WAV_SECONDS, format: "wav", outputPath: fixturePath });
    const sourceMetadata = await stat(fixturePath);
    assert.ok(sourceMetadata.size > 79 * 1024 * 1024, "The valid WAV fixture must exceed 79 MiB.");
    assert.ok(sourceMetadata.size <= CATALOG_AUDIO_SOURCE_MAXIMUM_BYTES, "The valid WAV fixture must remain at or below 80 MiB.");

    const wavBlob = await openAsBlob(fixturePath, { type: "audio/wav" });
    const response = await upload(
      configuration.baseUrl,
      project,
      new File([wavBlob], "near-80-mib.wav", { type: "audio/wav" }),
      cookie,
    );
    const payload = await response.json() as {
      state?: string;
      currentAudioAssetId?: string;
      sourceDurationMs?: number;
      durationMs?: number;
    };
    assert.equal(response.status, 200, `The near-80 MiB HTTP upload failed with ${payload.state ?? "an unknown state"}.`);
    assert.equal(payload.state, "audio-enregistre");
    assert.ok(payload.currentAudioAssetId);
    assert.ok((payload.sourceDurationMs ?? 0) >= 315_000);
    assert.ok((payload.durationMs ?? 0) >= 59_000 && (payload.durationMs ?? 0) <= 61_000);

    await rm(fixtureDirectory, { recursive: true, force: true });
    fixtureDirectory = null;
    await assert.rejects(access(fixturePath));
    fixturePath = null;
    await assertEmptyAudioTemporaryRoot(tempRoot);

    const asset = await prisma.asset.findUniqueOrThrow({
      where: { id: payload.currentAudioAssetId },
      include: { projects: true },
    });
    assert.equal(asset.projects.length, 1);
    assert.equal(asset.projects[0]?.projectId, project.id);
    assert.equal(asset.projects[0]?.role, "AUDIO_PREVIEW");
    assert.equal(asset.type, "AUDIO_PREVIEW");
    assert.equal(asset.storageBackend, "OBJECT");
    assert.equal(asset.storageProvider, "r2");
    assert.equal(asset.visibility, "PUBLIC");
    assert.equal(asset.mimeType, "audio/mpeg");
    assert.equal(asset.filename, "audio-preview.mp3");
    assert.match(asset.storageKey, /^catalog\/audio-previews\/[0-9a-f-]{36}\.mp3$/i);
    assert.ok(asset.durationMs && asset.durationMs >= 59_000 && asset.durationMs <= 61_000);
    assert.equal(asset.rightsStatus, "CLEARED");
    assert.match(asset.checksumSha256 ?? "", /^[0-9a-f]{64}$/);
    learnedQaKeys.add(asset.storageKey);

    const projectAssets = await prisma.asset.findMany({ where: { projects: { some: { projectId: project.id } } } });
    assert.equal(projectAssets.length, 1, "Only the generated MP3 preview may be persisted for the QA project.");
    assert.equal(projectAssets.some(({ mimeType, filename, storageKey }) => mimeType.includes("wav") || filename.endsWith(".wav") || storageKey.endsWith(".wav")), false);

    const afterUploadKeys = await listPublicAudioKeys(inventoryClient, configuration.publicBucket);
    const addedKeys = [...afterUploadKeys].filter((key) => !baselineKeys.has(key)).sort();
    const missingBaselineKeys = [...baselineKeys].filter((key) => !afterUploadKeys.has(key)).sort();
    assert.deepEqual(addedKeys, [asset.storageKey], "R2 must receive only the generated MP3 preview, never the complete WAV source.");
    assert.deepEqual(missingBaselineKeys, [], "The QA must never remove an object that predated its run.");

    const objectMetadata = await storage.head({ scope: "public", key: asset.storageKey });
    assert.equal(objectMetadata.contentLength, Number(asset.sizeBytes));
    assert.equal(objectMetadata.contentType, "audio/mpeg");
    assert.equal(objectMetadata.checksumSha256, asset.checksumSha256);

    const publicUrl = `${configuration.baseUrl}/media/catalog/audio/${asset.id}`;
    const head = await fetch(publicUrl, { method: "HEAD", signal: AbortSignal.timeout(CLOUD_OPERATION_TIMEOUT_MS) });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-type"), "audio/mpeg");
    assert.equal(head.headers.get("content-length"), String(asset.sizeBytes));
    assert.match(head.headers.get("cache-control") ?? "", /public/);
    assert.match(head.headers.get("cache-control") ?? "", /immutable/);
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    const full = await fetch(publicUrl, { signal: AbortSignal.timeout(CLOUD_OPERATION_TIMEOUT_MS) });
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    const fullBytes = Buffer.from(await full.arrayBuffer());
    assert.equal(fullBytes.length, Number(asset.sizeBytes));
    assert.equal(sha256(fullBytes), asset.checksumSha256);

    const firstRange = await fetch(publicUrl, { headers: { range: "bytes=0-1023" }, signal: AbortSignal.timeout(CLOUD_OPERATION_TIMEOUT_MS) });
    assert.equal(firstRange.status, 206);
    assert.equal(firstRange.headers.get("content-range"), `bytes 0-1023/${asset.sizeBytes}`);
    assert.equal((await firstRange.arrayBuffer()).byteLength, 1_024);
    const tailRange = await fetch(publicUrl, { headers: { range: "bytes=-512" }, signal: AbortSignal.timeout(CLOUD_OPERATION_TIMEOUT_MS) });
    assert.equal(tailRange.status, 206);
    assert.equal((await tailRange.arrayBuffer()).byteLength, 512);

    const page = await fetch(`${configuration.baseUrl}/album/${project.slug}`, { signal: AbortSignal.timeout(CLOUD_OPERATION_TIMEOUT_MS) });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, new RegExp(`/media/catalog/audio/${asset.id}`));
    assert.doesNotMatch(html, /near-80-mib\.wav/i, "The complete source filename must never appear on the public page.");

    const removed = await remove(configuration.baseUrl, project, asset.id, cookie);
    assert.equal(removed.status, 200, "The real Admin DELETE route must remove the R2 preview.");
    assert.equal(await prisma.asset.findUnique({ where: { id: asset.id } }), null);
    await expectObjectMissing(storage, asset.storageKey);

    const afterCleanupKeys = await listPublicAudioKeys(inventoryClient, configuration.publicBucket);
    assert.deepEqual([...afterCleanupKeys].sort(), [...baselineKeys].sort(), "The R2 public audio prefix must return to its exact pre-test inventory.");
    console.info(`R2 large-WAV HTTP QA passed: valid source ${sourceMetadata.size} bytes, generated preview ${asset.sizeBytes} bytes, 60-second duration, OBJECT metadata and public HEAD/GET/Range.`);
    console.info("The complete WAV source was neither persisted in PostgreSQL nor uploaded to R2; the QA project, object and temporary files were removed.");
  } finally {
    if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
    try {
      if (storage) await cleanupQaData(storage, learnedQaKeys);
      await assertEmptyAudioTemporaryRoot(tempRoot);
    } finally {
      try {
        await removeOwnedAudioTemporaryRoot(ownedTempRoot);
      } finally {
        inventoryClient?.destroy();
      }
    }
  }
}

run()
  .finally(() => prisma.$disconnect())
  .catch(() => {
    console.error("R2 large-WAV HTTP QA failed.");
    process.exitCode = 1;
  });
