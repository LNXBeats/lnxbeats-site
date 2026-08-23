import "server-only";

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertMediaStorageKey, mediaScopeForVisibility } from "@/lib/media/storage/policy";
import {
  MEDIA_PRODUCTION_CONFIRMATION,
  ProductionBootstrapError,
  assertProductionApply,
  assertProductionMediaEnvironment,
} from "@/lib/production/bootstrap-environment";

export const PRODUCTION_MEDIA_MANIFEST_FORMAT = "lnx-studio-production-media-v1";
const MAXIMUM_SOURCE_BYTES = 64 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9._'() -]+(?:\/[a-zA-Z0-9._'() -]+)*$/;

type Environment = Record<string, string | undefined>;
type Visibility = "PUBLIC" | "PRIVATE";
type ProjectRole = "COVER" | "AUDIO_PREVIEW";
type AssetType = "COVER" | "AUDIO_PREVIEW" | "IMAGE" | "AUDIO" | "DOCUMENT" | "VIDEO" | "OTHER";

export type ProductionMediaManifestEntry = {
  logicalId: string;
  assetId: string;
  sourcePath: string;
  targetKey: string;
  visibility: Visibility;
  type: AssetType;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  alt?: string | null;
  project?: { slug: string; role: ProjectRole; position: number } | null;
};

export type ProductionMediaManifest = {
  format: typeof PRODUCTION_MEDIA_MANIFEST_FORMAT;
  source: string;
  entries: ProductionMediaManifestEntry[];
};

type PreparedEntry = ProductionMediaManifestEntry & { bytes: Buffer };

export type ProductionMediaProvider = {
  inspect(entry: PreparedEntry): Promise<"absent" | "identical" | "conflict">;
  putIfAbsent(entry: PreparedEntry): Promise<void>;
};

function assertPositiveOptionalInteger(value: unknown, label: string) {
  if (value === undefined || value === null) return;
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new ProductionBootstrapError(`${label} is invalid.`);
}

function validateEntry(entry: ProductionMediaManifestEntry) {
  if (!/^[a-z0-9][a-z0-9._-]{2,119}$/.test(entry.logicalId)) throw new ProductionBootstrapError("Media logicalId is invalid.");
  if (!UUID.test(entry.assetId)) throw new ProductionBootstrapError(`Media assetId is invalid for ${entry.logicalId}.`);
  if (!SAFE_RELATIVE_PATH.test(entry.sourcePath)) throw new ProductionBootstrapError(`Media sourcePath is invalid for ${entry.logicalId}.`);
  if (!SHA256.test(entry.checksumSha256)) throw new ProductionBootstrapError(`Media checksum is invalid for ${entry.logicalId}.`);
  if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes <= 0 || entry.sizeBytes > MAXIMUM_SOURCE_BYTES) {
    throw new ProductionBootstrapError(`Media size is invalid for ${entry.logicalId}.`);
  }
  if (!entry.filename || entry.filename.length > 255 || /[\r\n]/.test(entry.filename)) throw new ProductionBootstrapError(`Media filename is invalid for ${entry.logicalId}.`);
  if (!/^(?:image\/webp|audio\/mpeg|application\/pdf)$/.test(entry.mimeType)) {
    throw new ProductionBootstrapError(`Media MIME is not allowlisted for ${entry.logicalId}.`);
  }
  const expectedMimeByType: Partial<Record<AssetType, string>> = {
    COVER: "image/webp",
    AUDIO_PREVIEW: "audio/mpeg",
    DOCUMENT: "application/pdf",
  };
  if (expectedMimeByType[entry.type] !== entry.mimeType) {
    throw new ProductionBootstrapError(`Media type/MIME mismatch for ${entry.logicalId}.`);
  }
  const scope = mediaScopeForVisibility(entry.visibility);
  assertMediaStorageKey(scope, entry.targetKey);
  assertPositiveOptionalInteger(entry.width, `${entry.logicalId}.width`);
  assertPositiveOptionalInteger(entry.height, `${entry.logicalId}.height`);
  assertPositiveOptionalInteger(entry.durationMs, `${entry.logicalId}.durationMs`);
  if (entry.project) {
    if (entry.visibility !== "PUBLIC") throw new ProductionBootstrapError("Catalogue project media must be PUBLIC.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.project.slug) || entry.project.position !== 0) {
      throw new ProductionBootstrapError(`Media project relation is invalid for ${entry.logicalId}.`);
    }
    if (entry.project.role !== entry.type) throw new ProductionBootstrapError(`Media type/role mismatch for ${entry.logicalId}.`);
  }
}

function assertMediaSignature(entry: ProductionMediaManifestEntry, bytes: Buffer) {
  const webp = bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const mp3 = bytes.length >= 3 && (
    bytes.subarray(0, 3).toString("ascii") === "ID3"
    || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)
  );
  const pdf = bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (
    (entry.mimeType === "image/webp" && !webp)
    || (entry.mimeType === "audio/mpeg" && !mp3)
    || (entry.mimeType === "application/pdf" && !pdf)
  ) throw new ProductionBootstrapError(`Media content signature mismatch for ${entry.logicalId}.`);
}

export async function loadProductionMediaManifest(manifestPath: string, sourceRoot: string) {
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as ProductionMediaManifest;
  if (raw.format !== PRODUCTION_MEDIA_MANIFEST_FORMAT || !Array.isArray(raw.entries) || !raw.entries.length) {
    throw new ProductionBootstrapError("The production media manifest format is invalid or empty.");
  }
  if (/(?:example\.invalid|localhost|127\.0\.0\.1|\bstaging\b|\bqa[-_:])/i.test(JSON.stringify(raw))) {
    throw new ProductionBootstrapError("The production media manifest contains a staging, QA or local marker.");
  }
  const identities = new Set<string>();
  const assetIds = new Set<string>();
  const targetKeys = new Set<string>();
  const projectRoles = new Set<string>();
  const canonicalRoot = await realpath(sourceRoot);
  const prepared: PreparedEntry[] = [];
  for (const entry of raw.entries) {
    validateEntry(entry);
    if (identities.has(entry.logicalId) || assetIds.has(entry.assetId) || targetKeys.has(entry.targetKey)) {
      throw new ProductionBootstrapError("The production media manifest contains a duplicate identity, assetId or target key.");
    }
    identities.add(entry.logicalId); assetIds.add(entry.assetId); targetKeys.add(entry.targetKey);
    if (entry.project) {
      const relation = `${entry.project.slug}:${entry.project.role}`;
      if (projectRoles.has(relation)) throw new ProductionBootstrapError("The production media manifest contains a duplicate project role.");
      projectRoles.add(relation);
    }
    const candidate = path.resolve(canonicalRoot, entry.sourcePath);
    const canonicalSource = await realpath(candidate);
    if (canonicalSource !== canonicalRoot && !canonicalSource.startsWith(`${canonicalRoot}${path.sep}`)) {
      throw new ProductionBootstrapError("A media source escapes the approved source root.");
    }
    const metadata = await stat(canonicalSource);
    if (!metadata.isFile() || metadata.size !== entry.sizeBytes) throw new ProductionBootstrapError(`Media source size mismatch for ${entry.logicalId}.`);
    const bytes = await readFile(canonicalSource);
    assertMediaSignature(entry, bytes);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== entry.checksumSha256) throw new ProductionBootstrapError(`Media source checksum mismatch for ${entry.logicalId}.`);
    prepared.push({ ...entry, bytes });
  }
  return { manifest: raw, prepared, totalBytes: prepared.reduce((sum, entry) => sum + entry.sizeBytes, 0) };
}

async function inspectDatabase(client: PrismaClient, entries: PreparedEntry[]) {
  const conflicts: string[] = [];
  const creates: string[] = [];
  const skips: string[] = [];
  for (const entry of entries) {
    const [byId, byKey, project] = await Promise.all([
      client.asset.findUnique({ where: { id: entry.assetId }, include: { projects: { include: { project: { select: { slug: true } } } } } }),
      client.asset.findUnique({ where: { storageKey: entry.targetKey }, select: { id: true } }),
      entry.project ? client.project.findUnique({ where: { slug: entry.project.slug }, select: { id: true } }) : Promise.resolve(null),
    ]);
    if (entry.project && !project) { conflicts.push(entry.logicalId); continue; }
    if (byKey && byKey.id !== entry.assetId) { conflicts.push(entry.logicalId); continue; }
    if (!byId) { creates.push(entry.logicalId); continue; }
    const relation = entry.project
      ? byId.projects.some((item) => item.project.slug === entry.project!.slug && item.role === entry.project!.role && item.position === entry.project!.position)
      : byId.projects.length === 0;
    const identical = byId.storageKey === entry.targetKey
      && byId.storageBackend === "OBJECT"
      && byId.storageProvider === "r2"
      && byId.visibility === entry.visibility
      && byId.type === entry.type
      && byId.filename === entry.filename
      && byId.mimeType === entry.mimeType
      && byId.sizeBytes === BigInt(entry.sizeBytes)
      && byId.checksumSha256 === entry.checksumSha256
      && byId.width === (entry.width ?? null)
      && byId.height === (entry.height ?? null)
      && byId.durationMs === (entry.durationMs ?? null)
      && relation;
    if (identical) skips.push(entry.logicalId); else conflicts.push(entry.logicalId);
  }
  return { creates, skips, conflicts };
}

export async function planProductionMediaImport(
  client: PrismaClient,
  manifestPath: string,
  sourceRoot: string,
  environment: Environment = process.env,
) {
  assertProductionMediaEnvironment(environment);
  const loaded = await loadProductionMediaManifest(manifestPath, sourceRoot);
  const database = await inspectDatabase(client, loaded.prepared);
  if (database.conflicts.length) throw new ProductionBootstrapError(`Media database conflicts: ${database.conflicts.length}.`);
  return {
    ...loaded,
    database,
    publicObjects: loaded.prepared.filter(({ visibility }) => visibility === "PUBLIC").length,
    privateObjects: loaded.prepared.filter(({ visibility }) => visibility === "PRIVATE").length,
  };
}

export async function applyProductionMediaImport(
  client: PrismaClient,
  provider: ProductionMediaProvider,
  manifestPath: string,
  sourceRoot: string,
  environment: Environment = process.env,
) {
  assertProductionMediaEnvironment(environment);
  assertProductionApply(true, "MEDIA_PRODUCTION_CONFIRM", MEDIA_PRODUCTION_CONFIRMATION, environment);
  const plan = await planProductionMediaImport(client, manifestPath, sourceRoot, environment);

  const inspections = new Map<string, "absent" | "identical" | "conflict">();
  for (const entry of plan.prepared) inspections.set(entry.logicalId, await provider.inspect(entry));
  const conflicts = [...inspections].filter(([, state]) => state === "conflict").map(([logicalId]) => logicalId);
  if (conflicts.length) throw new ProductionBootstrapError(`Media object conflicts: ${conflicts.length}.`);

  let uploaded = 0;
  let storageSkipped = 0;
  for (const entry of plan.prepared) {
    if (inspections.get(entry.logicalId) === "identical") { storageSkipped += 1; continue; }
    await provider.putIfAbsent(entry);
    if (await provider.inspect(entry) !== "identical") throw new ProductionBootstrapError(`Media verification failed for ${entry.logicalId}.`);
    uploaded += 1;
  }

  await client.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('lnx-production-media-import')) IS NULL AS locked`;
    for (const entry of plan.prepared) {
      if (plan.database.skips.includes(entry.logicalId)) continue;
      const project = entry.project
        ? await transaction.project.findUniqueOrThrow({ where: { slug: entry.project.slug }, select: { id: true } })
        : null;
      await transaction.asset.create({
        data: {
          id: entry.assetId,
          type: entry.type,
          storageKey: entry.targetKey,
          storageBackend: "OBJECT",
          storageProvider: "r2",
          visibility: entry.visibility,
          checksumSha256: entry.checksumSha256,
          filename: entry.filename,
          mimeType: entry.mimeType,
          sizeBytes: BigInt(entry.sizeBytes),
          width: entry.width ?? null,
          height: entry.height ?? null,
          durationMs: entry.durationMs ?? null,
          alt: entry.alt ?? null,
          rightsStatus: entry.project ? "CLEARED" : "RESTRICTED",
          confidence: "CONFIRMED",
        },
      });
      if (entry.project && project) {
        await transaction.projectAsset.create({
          data: { projectId: project.id, assetId: entry.assetId, role: entry.project.role, position: entry.project.position },
        });
      }
    }
  });
  return { uploaded, storageSkipped, databaseCreated: plan.database.creates.length, databaseSkipped: plan.database.skips.length };
}

async function bodySha256(body: unknown) {
  if (!body || typeof body !== "object") throw new ProductionBootstrapError("R2 returned an invalid media body.");
  const hash = createHash("sha256");
  for await (const chunk of Readable.from(body as never)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function isNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return value.name === "NotFound" || value.name === "NoSuchKey" || value.$metadata?.httpStatusCode === 404;
}

export function createProductionR2MediaProvider(environment: Environment = process.env): ProductionMediaProvider {
  const buckets = assertProductionMediaEnvironment(environment);
  const endpoint = environment.MEDIA_S3_ENDPOINT?.trim();
  const accessKeyId = environment.MEDIA_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = environment.MEDIA_S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey) throw new ProductionBootstrapError("Production R2 credentials are incomplete.");
  let endpointUrl: URL;
  try { endpointUrl = new URL(endpoint); }
  catch { throw new ProductionBootstrapError("Production R2 endpoint is invalid."); }
  if (
    endpointUrl.protocol !== "https:"
    || endpointUrl.username || endpointUrl.password || endpointUrl.port
    || endpointUrl.pathname !== "/" || endpointUrl.search || endpointUrl.hash
    || !/^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/i.test(endpointUrl.hostname)
  ) throw new ProductionBootstrapError("Production R2 endpoint is not an account-scoped Cloudflare endpoint.");
  const client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: false,
    expectContinueHeader: false,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const bucketFor = (entry: PreparedEntry) => entry.visibility === "PUBLIC" ? buckets.publicBucket : buckets.privateBucket;
  return {
    async inspect(entry) {
      const Bucket = bucketFor(entry);
      try {
        const metadata = await client.send(new HeadObjectCommand({ Bucket, Key: entry.targetKey }));
        if (
          metadata.ContentLength !== entry.sizeBytes
          || metadata.ContentType !== entry.mimeType
          || metadata.Metadata?.sha256 !== entry.checksumSha256
        ) return "conflict";
        const object = await client.send(new GetObjectCommand({ Bucket, Key: entry.targetKey }));
        return await bodySha256(object.Body) === entry.checksumSha256 ? "identical" : "conflict";
      } catch (error) {
        if (isNotFound(error)) return "absent";
        throw new ProductionBootstrapError("R2 inspection failed without exposing provider details.");
      }
    },
    async putIfAbsent(entry) {
      try {
        await client.send(new PutObjectCommand({
          Bucket: bucketFor(entry),
          Key: entry.targetKey,
          Body: entry.bytes,
          ContentLength: entry.sizeBytes,
          ContentType: entry.mimeType,
          CacheControl: entry.visibility === "PUBLIC" ? "public, max-age=31536000, immutable" : "private, no-store",
          Metadata: { sha256: entry.checksumSha256 },
          IfNoneMatch: "*",
        }));
      } catch {
        throw new ProductionBootstrapError("R2 create-only upload failed; no delete or overwrite was attempted.");
      }
    },
  };
}
