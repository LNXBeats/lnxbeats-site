import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  PRODUCTION_MEDIA_MANIFEST_FORMAT,
  applyProductionMediaImport,
  createProductionR2MediaProvider,
  loadProductionMediaManifest,
  planProductionMediaImport,
  type ProductionMediaProvider,
} from "@/lib/production/media-import";
import { MEDIA_PRODUCTION_CONFIRMATION, ProductionBootstrapError } from "@/lib/production/bootstrap-environment";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production", LNX_DATABASE_TARGET: "lnx-studio-production",
    AUTH_URL: "https://www.lnxbeats.fr", APP_CANONICAL_URL: "https://www.lnxbeats.fr",
    DATABASE_URL: "postgresql://app:secret@production.internal:5432/lnx_production",
    MEDIA_DEPLOYMENT_ENV: "production", MEDIA_STORAGE_DRIVER: "s3", MEDIA_STORAGE_PROVIDER: "r2",
    MEDIA_S3_REGION: "auto", MEDIA_S3_FORCE_PATH_STYLE: "false",
    MEDIA_PUBLIC_BUCKET: "lnx-studio-production-public", MEDIA_PRIVATE_BUCKET: "lnx-studio-production-private",
    MEDIA_PRODUCTION_CONFIRM: MEDIA_PRODUCTION_CONFIRMATION,
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-production-media-"));
  const bytes = Buffer.from("%PDF-canonical");
  await writeFile(path.join(root, "document.pdf"), bytes);
  const entry = {
    logicalId: "private-canonical-document",
    assetId: "00000000-0000-4000-8000-000000000201",
    sourcePath: "document.pdf",
    targetKey: "orders/00000000-0000-4000-8000-000000000202/documents/00000000-0000-4000-8000-000000000203.pdf",
    visibility: "PRIVATE" as const,
    type: "DOCUMENT" as const,
    filename: "canonical-document.pdf", mimeType: "application/pdf", sizeBytes: bytes.length,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"), project: null,
  };
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({ format: PRODUCTION_MEDIA_MANIFEST_FORMAT, source: "canonical-private-source", entries: [entry] }));
  return { root, manifestPath, entry };
}

function fakeDatabase() {
  const assets = new Map<string, Record<string, unknown>>();
  const project = { findUnique: async () => null };
  const asset = {
    findUnique: async ({ where }: { where: { id?: string; storageKey?: string } }) => {
      const found = [...assets.values()].find((item) => item.id === where.id || item.storageKey === where.storageKey);
      return found ? { ...found, projects: [] } : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => { assets.set(String(data.id), data); return data; },
  };
  const transaction = { asset, project, projectAsset: { create: async () => ({}) }, $queryRaw: async () => [{ locked: true }] };
  return {
    client: { asset, project, $transaction: async (operation: (value: typeof transaction) => unknown) => operation(transaction) } as unknown as PrismaClient,
    assets,
  };
}

function fakeProvider() {
  const objects = new Map<string, string>();
  let puts = 0;
  const provider: ProductionMediaProvider = {
    inspect: async (entry) => {
      const current = objects.get(`${entry.visibility}:${entry.targetKey}`);
      return current === undefined ? "absent" : current === entry.checksumSha256 ? "identical" : "conflict";
    },
    putIfAbsent: async (entry) => { puts += 1; objects.set(`${entry.visibility}:${entry.targetKey}`, entry.checksumSha256); },
  };
  return { provider, objects, puts: () => puts };
}

test("media dry-run validates local bytes and performs zero provider mutation", async () => {
  const item = await fixture();
  try {
    const database = fakeDatabase();
    const plan = await planProductionMediaImport(database.client, item.manifestPath, item.root, environment());
    assert.equal(plan.privateObjects, 1); assert.equal(plan.publicObjects, 0); assert.equal(database.assets.size, 0);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("media apply is create-only and the second run skips identical content", async () => {
  const item = await fixture();
  try {
    const database = fakeDatabase(); const storage = fakeProvider();
    const first = await applyProductionMediaImport(database.client, storage.provider, item.manifestPath, item.root, environment());
    assert.deepEqual(first, { uploaded: 1, storageSkipped: 0, databaseCreated: 1, databaseSkipped: 0 });
    const second = await applyProductionMediaImport(database.client, storage.provider, item.manifestPath, item.root, environment());
    assert.equal(second.uploaded, 0); assert.equal(second.storageSkipped, 1); assert.equal(storage.puts(), 1);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("media object checksum conflict stops before PUT", async () => {
  const item = await fixture();
  try {
    const database = fakeDatabase(); const storage = fakeProvider();
    storage.objects.set(`PRIVATE:${item.entry.targetKey}`, "0".repeat(64));
    await assert.rejects(() => applyProductionMediaImport(database.client, storage.provider, item.manifestPath, item.root, environment()), ProductionBootstrapError);
    assert.equal(storage.puts(), 0); assert.equal(database.assets.size, 0);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("media apply refuses staging, wrong buckets and missing confirmation", async () => {
  const item = await fixture();
  try {
    const database = fakeDatabase(); const storage = fakeProvider();
    await assert.rejects(() => planProductionMediaImport(database.client, item.manifestPath, item.root, environment({ MEDIA_DEPLOYMENT_ENV: "staging" })), ProductionBootstrapError);
    await assert.rejects(() => planProductionMediaImport(database.client, item.manifestPath, item.root, environment({ MEDIA_PUBLIC_BUCKET: "lnx-studio-staging-public" })), ProductionBootstrapError);
    await assert.rejects(() => applyProductionMediaImport(database.client, storage.provider, item.manifestPath, item.root, environment({ MEDIA_PRODUCTION_CONFIRM: undefined })), ProductionBootstrapError);
    assert.equal(storage.puts(), 0);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("manifest traversal fails before provider access", async () => {
  const item = await fixture();
  try {
    const raw = JSON.parse(await (await import("node:fs/promises")).readFile(item.manifestPath, "utf8"));
    raw.entries[0].sourcePath = "../outside.pdf";
    await writeFile(item.manifestPath, JSON.stringify(raw));
    await assert.rejects(() => loadProductionMediaManifest(item.manifestPath, item.root), ProductionBootstrapError);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("manifest checksum, signature and unverified MIME fail closed", async () => {
  const item = await fixture();
  try {
    const raw = JSON.parse(await (await import("node:fs/promises")).readFile(item.manifestPath, "utf8"));
    raw.entries[0].checksumSha256 = "0".repeat(64);
    await writeFile(item.manifestPath, JSON.stringify(raw));
    await assert.rejects(() => loadProductionMediaManifest(item.manifestPath, item.root), /checksum mismatch/);

    raw.entries[0].checksumSha256 = item.entry.checksumSha256;
    raw.entries[0].mimeType = "image/avif";
    raw.entries[0].type = "IMAGE";
    await writeFile(item.manifestPath, JSON.stringify(raw));
    await assert.rejects(() => loadProductionMediaManifest(item.manifestPath, item.root), /MIME is not allowlisted/);

    raw.entries[0].mimeType = "application/pdf";
    raw.entries[0].type = "DOCUMENT";
    raw.entries[0].checksumSha256 = createHash("sha256").update("not-a-pdf").digest("hex");
    raw.entries[0].sizeBytes = Buffer.byteLength("not-a-pdf");
    await writeFile(path.join(item.root, "document.pdf"), "not-a-pdf");
    await writeFile(item.manifestPath, JSON.stringify(raw));
    await assert.rejects(() => loadProductionMediaManifest(item.manifestPath, item.root), /signature mismatch/);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("production media provider interface exposes no delete operation", () => {
  const storage = fakeProvider();
  assert.equal("delete" in storage.provider, false);
});

test("production R2 adapter refuses malformed endpoints before constructing a provider", () => {
  assert.throws(
    () => createProductionR2MediaProvider(environment({
      MEDIA_S3_ENDPOINT: "https://staging.example.com/path",
      MEDIA_S3_ACCESS_KEY_ID: "present",
      MEDIA_S3_SECRET_ACCESS_KEY: "present",
    })),
    ProductionBootstrapError,
  );
});
