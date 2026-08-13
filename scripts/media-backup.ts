import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

import {
  MEDIA_BACKUP_FORMAT,
  assertDatabaseChecksum,
  databaseTargetIdentity,
  mediaAssetSetSha256,
  mediaMigrationEnvironmentIdentity,
  assertStagingObjectMigrationConfiguration,
} from "@/lib/media/migration-safety";
import {
  assertApprovedMediaMigrationDatabase,
  assertPrismaRuntimeProcessAlive,
  loadMediaMigrationDatabaseProof,
  withMediaMigrationLock,
} from "@/lib/media/migration-database-guard";
import { getMediaObject, mediaReference } from "@/lib/media/storage";
import { validateMediaStorageConfiguration } from "@/lib/media/storage/config";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

function backupRoot() {
  const requested = process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length);
  const suffix = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const root = path.resolve(requested || `/private/tmp/lnx-studio-v063-media-backup-${suffix}`);
  assert.ok(root.startsWith("/private/tmp/lnx-studio-v063-media-backup-"), "The media backup must stay in its dedicated /private/tmp namespace.");
  return root;
}

async function digestFileStream(stream: ReadableStream<Uint8Array>, output: string) {
  const hash = createHash("sha256");
  const source = Readable.fromWeb(stream as never);
  source.on("data", (chunk: Buffer) => hash.update(chunk));
  await pipeline(source, createWriteStream(output, { flags: "wx", mode: 0o600 }));
  return hash.digest("hex");
}

function backupFailureForReport(error: unknown) {
  if (!error || typeof error !== "object") return { name: "Error", message: "Media backup failed." };
  const value = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof value.name === "string" && value.name ? value.name : "Error";
  const code = typeof value.code === "string" && value.code ? value.code : undefined;
  const message = name === "AssertionError" || name === "MediaStorageError"
    ? typeof value.message === "string" ? value.message : "Media backup validation failed."
    : "Unexpected media backup failure.";
  return { name, ...(code ? { code } : {}), message };
}

async function runUnlocked(assertLockActive: () => void) {
  assertLockActive();
  const activeStorage = validateMediaStorageConfiguration();
  if (activeStorage.backend === "OBJECT") assertStagingObjectMigrationConfiguration();
  const databaseIdentity = databaseTargetIdentity();
  const environmentIdentity = mediaMigrationEnvironmentIdentity();
  const root = backupRoot();
  await mkdir(root, { recursive: false, mode: 0o700 });
  const statusPath = path.join(root, "backup-status.json");
  const startedAt = new Date().toISOString();
  await writeFile(statusPath, `${JSON.stringify({
    format: "lnx-studio-media-backup-status-v1",
    status: "running",
    startedAt,
    ...databaseIdentity,
    ...environmentIdentity,
    completedAssets: 0,
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  let completedAssets = 0;
  let completedBytes = 0n;
  let activeAssetId: string | null = null;
  type AssetRow = {
    id: string; type: string; storageKey: string; filename: string; mimeType: string; sizeBytes: bigint;
    width: number | null; height: number | null; durationMs: number | null; alt: string | null;
    rightsStatus: string; rightsNote: string | null; confidence: string; createdAt: Date; updatedAt: Date;
    storageBackend?: "LOCAL" | "OBJECT"; storageProvider?: string; visibility?: "PUBLIC" | "PRIVATE"; checksumSha256?: string | null;
  };
  type ProjectRelation = { assetId: string; projectId: string; role: string; position: number };
  type OrderRelation = { assetId: string; orderId: string; role: string; position: number };
  try {
    const [hasStorageBackend] = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'assets' AND column_name = 'storageBackend'
      ) AS present
    `);
    const assets = hasStorageBackend?.present
      ? await prisma.$queryRawUnsafe<AssetRow[]>(`
          SELECT "id", "type"::text, "storageKey", "filename", "mimeType", "sizeBytes", "width", "height", "duration_ms" AS "durationMs",
            "alt", "rightsStatus"::text, "rightsNote", "confidence"::text, "createdAt", "updatedAt",
            "storageBackend"::text, "storageProvider", "visibility"::text, "checksumSha256"
          FROM "assets" ORDER BY "id"
        `)
      : await prisma.$queryRawUnsafe<AssetRow[]>(`
          SELECT "id", "type"::text, "storageKey", "filename", "mimeType", "sizeBytes", "width", "height", "duration_ms" AS "durationMs",
            "alt", "rightsStatus"::text, "rightsNote", "confidence"::text, "createdAt", "updatedAt"
          FROM "assets" ORDER BY "id"
        `);
    const projectRelations = await prisma.$queryRawUnsafe<ProjectRelation[]>(`
      SELECT "assetId", "projectId", "role"::text, "position" FROM "project_assets" ORDER BY "assetId", "position"
    `);
    const orderRelations = await prisma.$queryRawUnsafe<OrderRelation[]>(`
      SELECT "assetId", "orderId", "role"::text, "position" FROM "order_assets" ORDER BY "assetId", "position"
    `);
    const inventory = [];
    for (const asset of assets) {
      assertLockActive();
      activeAssetId = asset.id;
      const projects = projectRelations.filter(({ assetId }) => assetId === asset.id);
      const orders = orderRelations.filter(({ assetId }) => assetId === asset.id);
      const visibility = asset.visibility ?? (projects.some(({ role }) => role === "COVER" || role === "AUDIO_PREVIEW") ? "PUBLIC" : "PRIVATE");
      const reference = mediaReference({
        storageKey: asset.storageKey,
        storageBackend: asset.storageBackend ?? "LOCAL",
        storageProvider: asset.storageProvider ?? "local",
        visibility,
      });
      const object = await getMediaObject(reference);
      assert.equal(BigInt(object.contentLength), asset.sizeBytes, `Size mismatch for ${asset.id}.`);
      const destination = path.join(root, "files", visibility.toLowerCase(), asset.storageKey);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const checksumSha256 = await digestFileStream(object.body, destination);
      assertDatabaseChecksum(asset.id, asset.checksumSha256, checksumSha256);
      inventory.push({
        id: asset.id,
        type: asset.type,
        storageKey: asset.storageKey,
        storageBackend: reference.storageBackend,
        storageProvider: reference.storageProvider,
        visibility,
        checksumSha256,
        databaseChecksumSha256: asset.checksumSha256,
        filename: asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes.toString(),
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
        alt: asset.alt,
        rightsStatus: asset.rightsStatus,
        rightsNote: asset.rightsNote,
        confidence: asset.confidence,
        createdAt: asset.createdAt.toISOString(),
        updatedAt: asset.updatedAt.toISOString(),
        projects,
        orders,
      });
      completedAssets += 1;
      completedBytes += asset.sizeBytes;
      activeAssetId = null;
      assertLockActive();
    }
    assertLockActive();
    const manifest = {
      format: MEDIA_BACKUP_FORMAT,
      createdAt: new Date().toISOString(),
      ...databaseIdentity,
      ...environmentIdentity,
      sourceCount: assets.length,
      sourceBytes: assets.reduce((sum, asset) => sum + asset.sizeBytes, 0n).toString(),
      sourceSetSha256: mediaAssetSetSha256(inventory),
      note: "Logical database backup of media metadata and relations plus byte-for-byte source files. No source was deleted.",
      assets: inventory,
    };
    await writeFile(path.join(root, "database-media.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    assertLockActive();
    await writeFile(statusPath, `${JSON.stringify({
      format: "lnx-studio-media-backup-status-v1",
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
      ...databaseIdentity,
      ...environmentIdentity,
      completedAssets,
      completedBytes: completedBytes.toString(),
      manifestPath: path.join(root, "database-media.json"),
    }, null, 2)}\n`, { flag: "w", mode: 0o600 });
    console.info(JSON.stringify({ ok: true, backupRoot: root, assetCount: assets.length, bytes: manifest.sourceBytes }));
  } catch (error) {
    const partial = {
      format: "lnx-studio-media-backup-status-v1",
      status: "failed",
      startedAt,
      failedAt: new Date().toISOString(),
      ...databaseIdentity,
      ...environmentIdentity,
      completedAssets,
      completedBytes: completedBytes.toString(),
      failedAssetId: activeAssetId,
      failure: backupFailureForReport(error),
      partialFilesRetained: true,
    };
    try {
      await writeFile(statusPath, `${JSON.stringify(partial, null, 2)}\n`, { flag: "w", mode: 0o600 });
    } catch {
      console.error(JSON.stringify({ ...partial, statusFileWritten: false, backupRoot: root }));
    }
    throw error;
  }
}

async function run() {
  assertDatabaseConfigured();
  const { proof } = await loadMediaMigrationDatabaseProof();
  assertApprovedMediaMigrationDatabase("backup", proof);
  assertPrismaRuntimeProcessAlive(proof);
  return withMediaMigrationLock(async (lease) => runUnlocked(() => lease.assertActive()));
}

run().finally(() => prisma.$disconnect()).catch((error: unknown) => {
  if (error && typeof error === "object") {
    const safe = error as { name?: string; code?: string; message?: string };
    const message = safe.name === "AssertionError" || safe.name === "MediaStorageError"
      ? safe.message
      : "Media backup failed.";
    console.error(JSON.stringify({ name: safe.name, code: safe.code, message }));
  } else console.error("Media backup failed.");
  process.exitCode = 1;
});
