import "dotenv/config";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import {
  type MediaAssetIdentity,
  type MediaBackupManifest,
  assertDatabaseChecksum,
  assertMediaBackupManifestMatches,
  assertMediaMigrationMaintenanceApproval,
  assertStagingObjectMigrationConfiguration,
  databaseTargetIdentity,
  mediaAssetSetSha256,
  mediaMigrationEnvironmentIdentity,
} from "@/lib/media/migration-safety";
import {
  assertApprovedMediaMigrationDatabase,
  assertPrismaRuntimeProcessAlive,
  loadMediaMigrationDatabaseProof,
  withMediaMigrationLock,
} from "@/lib/media/migration-database-guard";
import {
  type MigrationArtifacts,
  appendPrimaryEvent,
  appendRecoveryEvent,
  createMigrationArtifacts,
  migrationCounters,
  persistMigrationReport,
} from "@/lib/media/migration-orchestration";
import { activeMediaStorage, mediaStorageForReference } from "@/lib/media/storage/config";
import { mediaScopeForVisibility } from "@/lib/media/storage/policy";
import { MediaStorageError, type MediaScope, type MediaStorage } from "@/lib/media/storage/types";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

const dryRun = process.argv.includes("--dry-run");
const backfillLocal = process.argv.includes("--backfill-local");
const objectMigration = process.argv.includes("--execute");
const execute = objectMigration || backfillLocal;

type AssetRow = {
  id: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: bigint;
  storageBackend: "LOCAL" | "OBJECT";
  storageProvider: string;
  visibility: "PUBLIC" | "PRIVATE";
  checksumSha256: string | null;
  updatedAt: Date;
  projects: Array<{ role: string }>;
  orders: Array<{ role: string }>;
};

type PreparedAsset = {
  asset: AssetRow;
  visibility: "PUBLIC" | "PRIVATE";
  scope: MediaScope;
  sourceLength: number;
  checksumSha256: string;
};

type RollbackOutcome = {
  action: string;
  recoveryJournalWritten: boolean;
  primaryJournalWritten: boolean;
};

class PartialMigrationError extends Error {
  constructor(
    readonly summary: Record<string, unknown>,
    options: { cause: unknown },
  ) {
    super("Media migration stopped with a partial failure report.", options);
    this.name = "PartialMigrationError";
  }
}

class DryRunMigrationError extends Error {
  constructor(readonly summary: Record<string, unknown>) {
    super("Media migration dry-run is blocked.");
    this.name = "DryRunMigrationError";
  }
}

async function sha256(stream: ReadableStream<Uint8Array>) {
  const hash = createHash("sha256");
  for await (const chunk of Readable.fromWeb(stream as never)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function expectedVisibility(asset: { projects: Array<{ role: string }>; orders: Array<{ role: string }> }) {
  const publicRelation = asset.projects.some(({ role }) => role === "COVER" || role === "AUDIO_PREVIEW");
  if (publicRelation && asset.orders.length) throw new Error("An asset cannot be both public catalogue media and private order media.");
  return publicRelation ? "PUBLIC" as const : "PRIVATE" as const;
}

function backupManifestPath() {
  const value = process.argv.find((argument) => argument.startsWith("--backup="))?.slice("--backup=".length);
  assert.ok(value, "Every migration mode requires --backup=/private/tmp/lnx-studio-v063-media-backup-…");
  const root = path.resolve(value);
  assert.equal(path.dirname(root), "/private/tmp", "Unexpected media backup parent directory.");
  assert.match(path.basename(root), /^lnx-studio-v063-media-backup-[a-zA-Z0-9._-]+$/, "Unexpected media backup path.");
  return path.join(root, "database-media.json");
}

async function loadAndAssertBackup(
  currentAssets: MediaAssetIdentity[],
  databaseIdentity: ReturnType<typeof databaseTargetIdentity>,
  environmentIdentity: ReturnType<typeof mediaMigrationEnvironmentIdentity>,
) {
  const manifestPath = backupManifestPath();
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as MediaBackupManifest;
  const checksums = assertMediaBackupManifestMatches(manifest, currentAssets, databaseIdentity, environmentIdentity);
  return { manifestPath, checksums };
}

async function verifyObject(
  target: MediaStorage,
  scope: MediaScope,
  key: string,
  expectedLength: number,
  expectedContentType: string,
  expectedChecksumSha256: string,
  assetId: string,
) {
  const metadata = await target.head({ scope, key });
  assert.equal(metadata.contentLength, expectedLength, `Target size mismatch for ${assetId}.`);
  if (target.backend === "OBJECT") {
    assert.equal(metadata.contentType, expectedContentType, `Target MIME mismatch for ${assetId}.`);
  }
  if (metadata.checksumSha256) {
    assert.equal(metadata.checksumSha256, expectedChecksumSha256, `Target metadata checksum mismatch for ${assetId}.`);
  }
  const downloadedChecksumSha256 = await sha256((await target.get({ scope, key })).body);
  assert.equal(downloadedChecksumSha256, expectedChecksumSha256, `Target object checksum mismatch for ${assetId}.`);
}

async function inspectDryRunTarget(target: MediaStorage, prepared: PreparedAsset) {
  const { asset, scope, sourceLength, checksumSha256 } = prepared;
  try {
    const metadata = await target.head({ scope, key: asset.storageKey });
    if (metadata.contentLength !== sourceLength) {
      return { targetState: "conflict" as const, reason: "size-mismatch" as const };
    }
    if (target.backend === "OBJECT" && metadata.contentType !== asset.mimeType) {
      return { targetState: "conflict" as const, reason: "mime-mismatch" as const };
    }
    if (metadata.checksumSha256 && metadata.checksumSha256 !== checksumSha256) {
      return { targetState: "conflict" as const, reason: "checksum-metadata-mismatch" as const };
    }
    const downloadedChecksumSha256 = await sha256((await target.get({ scope, key: asset.storageKey })).body);
    if (downloadedChecksumSha256 !== checksumSha256) {
      return { targetState: "conflict" as const, reason: "checksum-content-mismatch" as const };
    }
    return { targetState: "identical" as const, reason: null };
  } catch (error) {
    if (error instanceof MediaStorageError && error.code === "NOT_FOUND") {
      return { targetState: "absent" as const, reason: null };
    }
    throw error;
  }
}

async function readAssets() {
  const [hasStorageBackend] = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'assets' AND column_name = 'storageBackend'
    ) AS present
  `);
  const assetRows = hasStorageBackend?.present
    ? await prisma.$queryRawUnsafe<Array<Omit<AssetRow, "projects" | "orders">>>(`
        SELECT "id", "storageKey", "mimeType", "sizeBytes", "storageBackend"::text, "storageProvider", "visibility"::text, "checksumSha256", "updatedAt"
        FROM "assets" ORDER BY "id"
      `)
    : await prisma.$queryRawUnsafe<Array<Pick<AssetRow, "id" | "storageKey" | "mimeType" | "sizeBytes" | "updatedAt">>>(`
        SELECT "id", "storageKey", "mimeType", "sizeBytes", "updatedAt" FROM "assets" ORDER BY "id"
      `);
  const projectRelations = await prisma.$queryRawUnsafe<Array<{ assetId: string; role: string }>>(`
    SELECT "assetId", "role"::text FROM "project_assets" ORDER BY "assetId"
  `);
  const orderRelations = await prisma.$queryRawUnsafe<Array<{ assetId: string; role: string }>>(`
    SELECT "assetId", "role"::text FROM "order_assets" ORDER BY "assetId"
  `);
  return assetRows.map((asset): AssetRow => ({
    ...asset,
    storageBackend: ("storageBackend" in asset ? asset.storageBackend : "LOCAL") as AssetRow["storageBackend"],
    storageProvider: ("storageProvider" in asset ? asset.storageProvider : "local") as string,
    visibility: ("visibility" in asset ? asset.visibility : "PRIVATE") as AssetRow["visibility"],
    checksumSha256: ("checksumSha256" in asset ? asset.checksumSha256 : null) as string | null,
    projects: projectRelations.filter(({ assetId }) => assetId === asset.id).map(({ role }) => ({ role })),
    orders: orderRelations.filter(({ assetId }) => assetId === asset.id).map(({ role }) => ({ role })),
  }));
}

async function prepareAssets(assets: AssetRow[], assertLockActive: () => void) {
  const prepared: PreparedAsset[] = [];
  for (const asset of assets) {
    assertLockActive();
    const visibility = expectedVisibility(asset);
    const scope = mediaScopeForVisibility(visibility);
    const source = mediaStorageForReference(asset);
    const sourceMetadata = await source.head({ scope, key: asset.storageKey });
    assert.equal(BigInt(sourceMetadata.contentLength), asset.sizeBytes, `Source size mismatch for ${asset.id}.`);
    const checksumSha256 = await sha256((await source.get({ scope, key: asset.storageKey })).body);
    assertDatabaseChecksum(asset.id, asset.checksumSha256, checksumSha256);
    prepared.push({ asset, visibility, scope, sourceLength: sourceMetadata.contentLength, checksumSha256 });
    assertLockActive();
  }
  return prepared;
}

function failureForReport(error: unknown) {
  if (!error || typeof error !== "object") return { name: "Error", message: "Media migration failed." };
  const value = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof value.name === "string" && value.name ? value.name : "Error";
  const code = typeof value.code === "string" && value.code ? value.code : undefined;
  const message = name === "AssertionError" || error instanceof MediaStorageError
    ? typeof value.message === "string" ? value.message : "Media migration validation failed."
    : "Unexpected media migration failure.";
  return { name, ...(code ? { code } : {}), message };
}

async function rollbackNewObjectAfterDatabaseFailure(
  target: MediaStorage,
  prepared: PreparedAsset,
  artifacts: MigrationArtifacts,
): Promise<RollbackOutcome> {
  const { asset, scope } = prepared;
  let event: Record<string, unknown>;
  try {
    const current = await prisma.asset.findUnique({
      where: { id: asset.id },
      select: { storageBackend: true, storageProvider: true, storageKey: true },
    });
    if (current?.storageBackend === "OBJECT" && current.storageProvider === target.provider && current.storageKey === asset.storageKey) {
      event = { assetId: asset.id, storageKey: asset.storageKey, action: "rollback-deferred-database-references-object" };
    } else {
      await target.delete({ scope, key: asset.storageKey });
      event = { assetId: asset.id, storageKey: asset.storageKey, action: "new-object-rolled-back" };
    }
  } catch (error) {
    event = {
      assetId: asset.id,
      storageKey: asset.storageKey,
      action: "rollback-deferred-unconfirmed-database-state",
      failure: failureForReport(error),
    };
  }

  let recoveryJournalWritten = false;
  let primaryJournalWritten = false;
  try {
    await appendRecoveryEvent(artifacts, event);
    recoveryJournalWritten = true;
  } catch {
    // The partial report and stderr summary still expose that manual recovery is required.
  }
  try {
    await appendPrimaryEvent(artifacts, event);
    primaryJournalWritten = true;
  } catch {
    // appendPrimaryEvent already attempts the independent recovery journal.
  }
  return { action: String(event.action), recoveryJournalWritten, primaryJournalWritten };
}

async function runUnlocked(assertLockActive: () => void) {
  assertLockActive();
  const databaseIdentity = databaseTargetIdentity();
  const environmentIdentity = mediaMigrationEnvironmentIdentity();

  if (objectMigration || process.env.MEDIA_STORAGE_DRIVER === "s3") {
    assertStagingObjectMigrationConfiguration();
  }
  if (execute) assertMediaMigrationMaintenanceApproval(process.argv);

  const target = activeMediaStorage();
  if (backfillLocal) {
    assert.equal(target.backend, "LOCAL", "Local metadata backfill refuses an object target.");
    assert.equal(process.env.MEDIA_MIGRATION_CONFIRM, "backfill-local-media-metadata", "Local metadata backfill requires explicit confirmation.");
  } else if (objectMigration) {
    assert.equal(target.backend, "OBJECT", "Object migration requires the s3 media driver.");
    assert.equal(process.env.MEDIA_MIGRATION_CONFIRM, "migrate-local-media-to-object", "Object migration requires explicit confirmation.");
  }

  const assets = await readAssets();
  const prepared = await prepareAssets(assets, assertLockActive);
  const currentIdentities = prepared.map(({ asset, checksumSha256 }) => ({
    id: asset.id,
    storageKey: asset.storageKey,
    checksumSha256,
    sizeBytes: asset.sizeBytes.toString(),
  }));
  const { manifestPath, checksums: backupChecksums } = await loadAndAssertBackup(currentIdentities, databaseIdentity, environmentIdentity);
  for (const identity of currentIdentities) {
    assert.equal(backupChecksums.get(`${identity.id}:${identity.storageKey}`), identity.checksumSha256, `Source media changed after backup for ${identity.id}.`);
  }

  if (dryRun) {
    const report = [];
    let activeAssetId: string | null = null;
    try {
      for (const preparedAsset of prepared) {
        assertLockActive();
        const { asset, visibility, scope, sourceLength, checksumSha256 } = preparedAsset;
        activeAssetId = asset.id;
        const targetInspection = await inspectDryRunTarget(target, preparedAsset);
        report.push({
          id: asset.id,
          key: asset.storageKey,
          from: asset.storageBackend,
          to: target.backend,
          scope,
          visibility,
          bytes: sourceLength,
          checksumSha256,
          ...targetInspection,
          action: targetInspection.targetState === "absent" ? "migrate" : targetInspection.targetState === "identical" ? "verify-existing" : "stop",
        });
        activeAssetId = null;
        assertLockActive();
      }
    } catch (error) {
      const failure = failureForReport(error);
      const sourceBytes = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0n).toString();
      const conflictCount = /mismatch|inconsistent/.test(failure.message) ? 1 : 0;
      throw new DryRunMigrationError({
        status: "blocked",
        ok: false,
        dryRun: true,
        mode: "inventory",
        sourceCount: assets.length,
        sourceBytes,
        sourceSetSha256: mediaAssetSetSha256(currentIdentities),
        sourceDeletion: false,
        failedAssetId: activeAssetId,
        failure,
        ...migrationCounters({
          scanned: report.length + (activeAssetId ? 1 : 0),
          bytes: sourceBytes,
          report: report.map(({ action }) => ({ action })),
          conflicts: conflictCount,
          failures: 1,
        }),
        report,
      });
    }
    const conflicts = report.filter(({ targetState }) => targetState === "conflict").length;
    const sourceBytes = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0n).toString();
    const counters = migrationCounters({ scanned: assets.length, bytes: sourceBytes, report: report.map(({ action }) => ({ action })), conflicts });
    assertLockActive();
    const summary = {
      status: conflicts === 0 ? "ready" : "blocked",
      ok: conflicts === 0,
      dryRun: true,
      mode: "inventory",
      sourceCount: assets.length,
      sourceBytes,
      sourceSetSha256: mediaAssetSetSha256(currentIdentities),
      sourceDeletion: false,
      destination: { backend: target.backend, provider: target.provider },
      targetAbsent: report.filter(({ targetState }) => targetState === "absent").length,
      targetIdentical: report.filter(({ targetState }) => targetState === "identical").length,
      conflicts,
      scanned: counters.scanned,
      wouldUpload: counters.wouldUpload,
      uploaded: counters.uploaded,
      skipped: counters.skipped,
      failures: counters.failures,
      bytes: counters.bytes,
      report,
    };
    if (conflicts) throw new DryRunMigrationError(summary);
    console.info(JSON.stringify(summary));
    return;
  }

  const mode = backfillLocal ? "backfill-local" as const : "object-migration" as const;
  const sourceSetSha256 = mediaAssetSetSha256(currentIdentities);
  const artifacts = await createMigrationArtifacts(path.dirname(manifestPath), {
    mode,
    ...databaseIdentity,
    ...environmentIdentity,
    sourceSetSha256,
  });
  const report: Array<{ id: string; key: string; action: string; checksumSha256: string }> = [];
  let activeAssetId: string | null = null;
  let rollback: RollbackOutcome | null = null;

  try {
    for (const preparedAsset of prepared) {
      assertLockActive();
      const { asset, visibility, scope, sourceLength, checksumSha256 } = preparedAsset;
      activeAssetId = asset.id;
      rollback = null;
      if (backfillLocal) {
        await verifyObject(target, scope, asset.storageKey, sourceLength, asset.mimeType, checksumSha256, asset.id);
        await appendPrimaryEvent(artifacts, { assetId: asset.id, storageKey: asset.storageKey, action: "metadata-backfill-started", checksumSha256 });
        const result = await prisma.asset.updateMany({
          where: { id: asset.id, storageKey: asset.storageKey, storageBackend: asset.storageBackend, updatedAt: asset.updatedAt },
          data: { storageBackend: "LOCAL", storageProvider: "local", visibility, checksumSha256 },
        });
        assert.equal(result.count, 1, `Concurrent database change detected for ${asset.id}.`);
        // Record the durable DB outcome before any best-effort audit write can
        // fail, so a partial report never undercounts a committed mutation.
        report.push({ id: asset.id, key: asset.storageKey, action: "metadata-backfilled", checksumSha256 });
        await appendPrimaryEvent(artifacts, { assetId: asset.id, storageKey: asset.storageKey, action: "metadata-backfilled", checksumSha256 });
        activeAssetId = null;
        assertLockActive();
        continue;
      }

      if (asset.storageBackend === "OBJECT") {
        assert.equal(asset.storageProvider, target.provider, `Object provider mismatch for ${asset.id}.`);
        assert.equal(asset.visibility, visibility, `Object visibility mismatch for ${asset.id}.`);
        assert.equal(asset.checksumSha256, checksumSha256, `Object database checksum is missing or inconsistent for ${asset.id}.`);
        await verifyObject(target, scope, asset.storageKey, sourceLength, asset.mimeType, checksumSha256, asset.id);
        await appendPrimaryEvent(artifacts, { assetId: asset.id, storageKey: asset.storageKey, action: "already-object-verified", checksumSha256 });
        report.push({ id: asset.id, key: asset.storageKey, action: "already-object", checksumSha256 });
        activeAssetId = null;
        assertLockActive();
        continue;
      }

      let uploaded = false;
      try {
        await verifyObject(target, scope, asset.storageKey, sourceLength, asset.mimeType, checksumSha256, asset.id);
      } catch (error) {
        if (!(error instanceof MediaStorageError) || error.code !== "NOT_FOUND") throw error;
        const uploadIntent = {
          assetId: asset.id,
          storageKey: asset.storageKey,
          action: "new-object-upload-planned",
          checksumSha256,
        };
        await appendPrimaryEvent(artifacts, uploadIntent);
        await appendRecoveryEvent(artifacts, uploadIntent);
        const source = mediaStorageForReference(asset);
        const object = await source.get({ scope, key: asset.storageKey });
        await target.put({
          scope,
          key: asset.storageKey,
          body: Readable.fromWeb(object.body as never),
          contentLength: sourceLength,
          contentType: asset.mimeType,
          checksumSha256,
        });
        uploaded = true;
        try {
          await appendRecoveryEvent(artifacts, {
            assetId: asset.id,
            storageKey: asset.storageKey,
            action: "new-object-created-pending-database",
            checksumSha256,
          });
          await verifyObject(target, scope, asset.storageKey, sourceLength, asset.mimeType, checksumSha256, asset.id);
        } catch (verificationError) {
          rollback = await rollbackNewObjectAfterDatabaseFailure(target, preparedAsset, artifacts);
          throw verificationError;
        }
      }

      try {
        await appendPrimaryEvent(artifacts, {
          assetId: asset.id,
          storageKey: asset.storageKey,
          action: uploaded ? "new-object-verified" : "existing-object-verified",
          checksumSha256,
        });
      } catch (error) {
        if (uploaded) rollback = await rollbackNewObjectAfterDatabaseFailure(target, preparedAsset, artifacts);
        throw error;
      }

      try {
        const result = await prisma.asset.updateMany({
          where: { id: asset.id, storageKey: asset.storageKey, storageBackend: "LOCAL", updatedAt: asset.updatedAt },
          data: { storageBackend: "OBJECT", storageProvider: target.provider, visibility, checksumSha256 },
        });
        assert.equal(result.count, 1, `Concurrent database change detected for ${asset.id}.`);
      } catch (error) {
        if (uploaded) rollback = await rollbackNewObjectAfterDatabaseFailure(target, preparedAsset, artifacts);
        throw error;
      }
      // From this point PostgreSQL durably references the object. Count that
      // outcome immediately, even if the subsequent journal append fails.
      report.push({ id: asset.id, key: asset.storageKey, action: uploaded ? "uploaded" : "verified-existing", checksumSha256 });
      await appendPrimaryEvent(artifacts, {
        assetId: asset.id,
        storageKey: asset.storageKey,
        action: "database-committed",
        checksumSha256,
      });
      await appendRecoveryEvent(artifacts, {
        assetId: asset.id,
        storageKey: asset.storageKey,
        action: "database-committed-object-retained",
        checksumSha256,
      });
      activeAssetId = null;
      assertLockActive();
    }

    const sourceBytes = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0n).toString();
    assertLockActive();
    const summary = {
      status: "completed",
      ok: true,
      dryRun: false,
      mode,
      sourceCount: assets.length,
      sourceBytes,
      sourceSetSha256,
      sourceDeletion: false,
      completedCount: report.length,
      ...migrationCounters({ scanned: assets.length, bytes: sourceBytes, report }),
      report,
    };
    await persistMigrationReport(artifacts, summary);
    assertLockActive();
    await appendPrimaryEvent(artifacts, { action: "migration-completed", completedCount: report.length });
    console.info(JSON.stringify({
      ...summary,
      report: undefined,
      reportFile: artifacts.reportPath,
      journalFile: artifacts.primaryJournalPath,
      recoveryJournalFile: artifacts.recoveryJournalPath,
    }));
  } catch (error) {
    const failure = failureForReport(error);
    const sourceBytes = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0n).toString();
    const conflictCount = /Concurrent database change|mismatch|inconsistent/.test(failure.message) ? 1 : 0;
    const failureStatus = report.length > 0 ? "partial" : "blocked";
    const counters = migrationCounters({
      scanned: assets.length,
      bytes: sourceBytes,
      report,
      conflicts: conflictCount,
      failures: 1,
    });
    const partial = {
      status: failureStatus,
      ok: false,
      dryRun: false,
      mode,
      sourceCount: assets.length,
      sourceBytes,
      sourceSetSha256,
      sourceDeletion: false,
      completedCount: report.length,
      failedAssetId: activeAssetId,
      failure,
      rollback,
      ...counters,
      report,
    };
    let partialReportWritten = false;
    let recoveryFailureRecorded = false;
    try {
      await persistMigrationReport(artifacts, partial);
      partialReportWritten = true;
    } catch {
      // persistMigrationReport already attempts an independent recovery-journal record.
    }
    try {
      await appendRecoveryEvent(artifacts, {
        action: "migration-failed",
        completedCount: report.length,
        failedAssetId: activeAssetId,
        failure,
        rollback,
        partialReportWritten,
      });
      recoveryFailureRecorded = true;
    } catch {
      // The structured stderr summary below is the final fail-closed recovery channel.
    }
    throw new PartialMigrationError({
      ok: false,
      status: failureStatus,
      mode,
      completedCount: report.length,
      failedAssetId: activeAssetId,
      failure,
      rollback,
      ...counters,
      partialReportWritten,
      recoveryFailureRecorded,
      reportFile: artifacts.reportPath,
      journalFile: artifacts.primaryJournalPath,
      recoveryJournalFile: artifacts.recoveryJournalPath,
    }, { cause: error });
  }
}

async function run() {
  assertDatabaseConfigured();
  assert.ok(dryRun || execute, "Use --dry-run, --backfill-local or --execute.");
  assert.ok(Number(dryRun) + Number(backfillLocal) + Number(objectMigration) === 1, "Choose exactly one migration mode.");
  const operation = dryRun ? "dry-run" : backfillLocal ? "backfill-local" : "object-migration";
  const { proof } = await loadMediaMigrationDatabaseProof();
  assertApprovedMediaMigrationDatabase(operation, proof);
  assertPrismaRuntimeProcessAlive(proof);
  return withMediaMigrationLock(async (lease) => runUnlocked(() => lease.assertActive()));
}

run().finally(() => prisma.$disconnect()).catch((error: unknown) => {
  if (error instanceof DryRunMigrationError) {
    console.error(JSON.stringify(error.summary));
    process.exitCode = 1;
    return;
  }
  if (error instanceof PartialMigrationError) {
    console.error(JSON.stringify(error.summary));
    process.exitCode = 1;
    return;
  }
  const named = error && typeof error === "object" ? error as { name?: string; code?: string; message?: string } : null;
  const message = named?.name === "AssertionError" || error instanceof MediaStorageError
    ? named?.message
    : "Media migration failed.";
  console.error(JSON.stringify({ name: named?.name ?? "Error", code: named?.code, message }));
  process.exitCode = 1;
});
