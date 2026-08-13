import "dotenv/config";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { activeMediaStorage, mediaStorageForReference } from "@/lib/media/storage/config";
import { mediaScopeForVisibility } from "@/lib/media/storage/policy";
import { MediaStorageError } from "@/lib/media/storage/types";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

const dryRun = process.argv.includes("--dry-run");
const backfillLocal = process.argv.includes("--backfill-local");
const execute = process.argv.includes("--execute") || backfillLocal;

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
  return value ? path.resolve(value, "database-media.json") : null;
}

async function assertBackup(assetCount: number) {
  const manifestPath = backupManifestPath();
  assert.ok(manifestPath, "Execute mode requires --backup=/private/tmp/lnx-studio-v063-media-backup-…");
  assert.ok(manifestPath.startsWith("/private/tmp/lnx-studio-v063-media-backup-"), "Unexpected media backup path.");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    format?: string;
    sourceCount?: number;
    assets?: Array<{ id?: string; storageKey?: string; checksumSha256?: string }>;
  };
  assert.equal(manifest.format, "lnx-studio-media-backup-v1");
  assert.equal(manifest.sourceCount, assetCount, "The backup inventory no longer matches the database.");
  assert.equal(manifest.assets?.length, assetCount, "The backup asset mapping is incomplete.");
  return new Map(manifest.assets?.map((asset) => [`${asset.id}:${asset.storageKey}`, asset.checksumSha256]) ?? []);
}

async function run() {
  assertDatabaseConfigured();
  assert.ok(dryRun || execute, "Use --dry-run, --backfill-local or --execute.");
  assert.ok(!(dryRun && execute), "Dry-run and execute modes are mutually exclusive.");
  type AssetRow = {
    id: string; storageKey: string; mimeType: string; sizeBytes: bigint;
    storageBackend: "LOCAL" | "OBJECT"; storageProvider: string; visibility: "PUBLIC" | "PRIVATE"; checksumSha256: string | null;
    projects: Array<{ role: string }>; orders: Array<{ role: string }>;
  };
  const [hasStorageBackend] = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'assets' AND column_name = 'storageBackend'
    ) AS present
  `);
  const assetRows = hasStorageBackend?.present
    ? await prisma.$queryRawUnsafe<Array<Omit<AssetRow, "projects" | "orders">>>(`
        SELECT "id", "storageKey", "mimeType", "sizeBytes", "storageBackend"::text, "storageProvider", "visibility"::text, "checksumSha256"
        FROM "assets" ORDER BY "id"
      `)
    : await prisma.$queryRawUnsafe<Array<Pick<AssetRow, "id" | "storageKey" | "mimeType" | "sizeBytes">>>(`
        SELECT "id", "storageKey", "mimeType", "sizeBytes" FROM "assets" ORDER BY "id"
      `);
  const projectRelations = await prisma.$queryRawUnsafe<Array<{ assetId: string; role: string }>>(`
    SELECT "assetId", "role"::text FROM "project_assets" ORDER BY "assetId"
  `);
  const orderRelations = await prisma.$queryRawUnsafe<Array<{ assetId: string; role: string }>>(`
    SELECT "assetId", "role"::text FROM "order_assets" ORDER BY "assetId"
  `);
  const assets: AssetRow[] = assetRows.map((asset) => ({
    ...asset,
    storageBackend: ("storageBackend" in asset ? asset.storageBackend : "LOCAL") as AssetRow["storageBackend"],
    storageProvider: ("storageProvider" in asset ? asset.storageProvider : "local") as string,
    visibility: ("visibility" in asset ? asset.visibility : "PRIVATE") as AssetRow["visibility"],
    checksumSha256: ("checksumSha256" in asset ? asset.checksumSha256 : null) as string | null,
    projects: projectRelations.filter(({ assetId }) => assetId === asset.id).map(({ role }) => ({ role })),
    orders: orderRelations.filter(({ assetId }) => assetId === asset.id).map(({ role }) => ({ role })),
  }));
  const backupChecksums = execute ? await assertBackup(assets.length) : null;
  const target = activeMediaStorage();
  if (backfillLocal) {
    assert.equal(target.backend, "LOCAL", "Local metadata backfill refuses an object target.");
    assert.equal(process.env.MEDIA_MIGRATION_CONFIRM, "backfill-local-media-metadata");
  } else if (execute) {
    assert.equal(target.backend, "OBJECT", "Object migration requires MEDIA_STORAGE_DRIVER=s3.");
    assert.equal(process.env.MEDIA_MIGRATION_CONFIRM, "migrate-local-media-to-object");
  }

  const report = [];
  for (const asset of assets) {
    const visibility = expectedVisibility(asset);
    const scope = mediaScopeForVisibility(visibility);
    const source = mediaStorageForReference(asset);
    const sourceMetadata = await source.head({ scope, key: asset.storageKey });
    assert.equal(BigInt(sourceMetadata.contentLength), asset.sizeBytes, `Source size mismatch for ${asset.id}.`);
    const checksumSha256 = await sha256((await source.get({ scope, key: asset.storageKey })).body);
    if (backupChecksums) {
      assert.equal(
        backupChecksums.get(`${asset.id}:${asset.storageKey}`),
        checksumSha256,
        `Source media changed after backup for ${asset.id}.`,
      );
    }

    if (dryRun) {
      report.push({ id: asset.id, key: asset.storageKey, from: asset.storageBackend, to: target.backend, visibility, bytes: sourceMetadata.contentLength, checksumSha256, action: asset.storageBackend === target.backend ? "verify" : "migrate" });
      continue;
    }

    if (backfillLocal) {
      await prisma.asset.update({
        where: { id: asset.id },
        data: { storageBackend: "LOCAL", storageProvider: "local", visibility, checksumSha256 },
      });
      report.push({ id: asset.id, key: asset.storageKey, action: "metadata-backfilled", checksumSha256 });
      continue;
    }

    if (asset.storageBackend === "OBJECT") {
      const current = await target.head({ scope, key: asset.storageKey });
      assert.equal(current.contentLength, sourceMetadata.contentLength);
      report.push({ id: asset.id, key: asset.storageKey, action: "already-object", checksumSha256 });
      continue;
    }

    let upload = true;
    try {
      const current = await target.head({ scope, key: asset.storageKey });
      upload = current.contentLength !== sourceMetadata.contentLength || current.checksumSha256 !== checksumSha256;
    } catch (error) {
      if (!(error instanceof MediaStorageError) || error.code !== "NOT_FOUND") throw error;
    }
    if (upload) {
      const object = await source.get({ scope, key: asset.storageKey });
      await target.put({
        scope,
        key: asset.storageKey,
        body: Readable.fromWeb(object.body as never),
        contentLength: sourceMetadata.contentLength,
        contentType: asset.mimeType,
        checksumSha256,
      });
    }
    const verified = await target.head({ scope, key: asset.storageKey });
    assert.equal(verified.contentLength, sourceMetadata.contentLength);
    if (verified.checksumSha256) assert.equal(verified.checksumSha256, checksumSha256);
    const uploadedChecksumSha256 = await sha256((await target.get({ scope, key: asset.storageKey })).body);
    assert.equal(uploadedChecksumSha256, checksumSha256, `Target checksum mismatch for ${asset.id}.`);
    await prisma.asset.update({
      where: { id: asset.id },
      data: { storageBackend: "OBJECT", storageProvider: target.provider, visibility, checksumSha256 },
    });
    report.push({ id: asset.id, key: asset.storageKey, action: upload ? "uploaded" : "verified-existing", checksumSha256 });
  }

  const summary = {
    ok: true,
    dryRun,
    mode: backfillLocal ? "backfill-local" : target.backend === "OBJECT" ? "object-migration" : "inventory",
    sourceCount: assets.length,
    sourceBytes: assets.reduce((sum, asset) => sum + asset.sizeBytes, 0n).toString(),
    sourceDeletion: false,
    report,
  };
  const output = backupManifestPath() ? path.join(path.dirname(backupManifestPath()!), `migration-${Date.now()}.json`) : null;
  if (output) await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.info(JSON.stringify({ ...summary, report: undefined, reportFile: output }));
}

run().finally(() => prisma.$disconnect()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Media migration failed.");
  process.exitCode = 1;
});
