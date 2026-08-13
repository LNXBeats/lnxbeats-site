import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

import { getMediaObject, mediaReference } from "@/lib/media/storage";
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

async function run() {
  assertDatabaseConfigured();
  const root = backupRoot();
  await mkdir(root, { recursive: false, mode: 0o700 });
  type AssetRow = {
    id: string; type: string; storageKey: string; filename: string; mimeType: string; sizeBytes: bigint;
    width: number | null; height: number | null; durationMs: number | null; alt: string | null;
    rightsStatus: string; rightsNote: string | null; confidence: string; createdAt: Date; updatedAt: Date;
    storageBackend?: "LOCAL" | "OBJECT"; storageProvider?: string; visibility?: "PUBLIC" | "PRIVATE"; checksumSha256?: string | null;
  };
  type ProjectRelation = { assetId: string; projectId: string; role: string; position: number };
  type OrderRelation = { assetId: string; orderId: string; role: string; position: number };
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
      projects,
      orders,
    });
  }
  const manifest = {
    format: "lnx-studio-media-backup-v1",
    createdAt: new Date().toISOString(),
    databaseTarget: process.env.LNX_DATABASE_TARGET ?? "configured-database",
    sourceCount: assets.length,
    sourceBytes: assets.reduce((sum, asset) => sum + asset.sizeBytes, 0n).toString(),
    note: "Logical database backup of media metadata and relations plus byte-for-byte source files. No source was deleted.",
    assets: inventory,
  };
  await writeFile(path.join(root, "database-media.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.info(JSON.stringify({ ok: true, backupRoot: root, assetCount: assets.length, bytes: manifest.sourceBytes }));
}

run().finally(() => prisma.$disconnect()).catch((error: unknown) => {
  if (error && typeof error === "object") {
    const safe = error as { name?: string; code?: string; message?: string; meta?: unknown };
    console.error(JSON.stringify({ name: safe.name, code: safe.code, message: safe.message, meta: safe.meta }));
  } else console.error("Media backup failed.");
  process.exitCode = 1;
});
