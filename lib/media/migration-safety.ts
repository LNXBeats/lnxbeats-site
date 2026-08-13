import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";

export const MEDIA_BACKUP_FORMAT = "lnx-studio-media-backup-v2";
export const STAGING_PUBLIC_BUCKET = "lnx-studio-staging-public";
export const STAGING_PRIVATE_BUCKET = "lnx-studio-staging-private";
export const MEDIA_MIGRATION_MAINTENANCE_CONFIRMATION = "staging-media-migration-maintenance-approved";

export type MediaAssetIdentity = {
  id: string;
  storageKey: string;
  checksumSha256: string;
  sizeBytes?: string;
};

export type MediaBackupManifest = {
  format?: string;
  databaseTarget?: string;
  databaseIdentitySha256?: string;
  migrationEnvironment?: string;
  migrationEnvironmentSha256?: string;
  sourceCount?: number;
  sourceBytes?: string;
  sourceSetSha256?: string;
  assets?: MediaAssetIdentity[];
};

type Environment = Record<string, string | undefined>;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredEnvironmentValue(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  assert.ok(value, `${name} must be configured.`);
  return value;
}

export function databaseTargetIdentity(environment: Environment = process.env) {
  const databaseTarget = requiredEnvironmentValue(environment, "LNX_DATABASE_TARGET");
  const databaseUrl = assertSafeLocalPostgresUrl(requiredEnvironmentValue(environment, "DATABASE_URL"));
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
  assert.ok(databaseName, "DATABASE_URL must identify a database.");
  const canonicalTarget = JSON.stringify({
    protocol: "postgresql",
    hostname: databaseUrl.hostname.toLowerCase(),
    port: databaseUrl.port || "5432",
    databaseName,
    schema: databaseUrl.searchParams.get("schema") || "public",
  });
  return { databaseTarget, databaseIdentitySha256: sha256(canonicalTarget) };
}

export function mediaMigrationEnvironmentIdentity(environment: Environment = process.env) {
  const migrationEnvironment = environment.MEDIA_DEPLOYMENT_ENV?.trim() || "unspecified";
  const driver = environment.MEDIA_STORAGE_DRIVER?.trim() || "local";
  const canonicalEnvironment = driver === "s3"
    ? {
        migrationEnvironment,
        driver,
        provider: environment.MEDIA_STORAGE_PROVIDER?.trim() || "r2",
        endpointHostname: new URL(requiredEnvironmentValue(environment, "MEDIA_S3_ENDPOINT")).hostname.toLowerCase(),
        region: environment.MEDIA_S3_REGION?.trim() || "auto",
        publicBucket: requiredEnvironmentValue(environment, "MEDIA_PUBLIC_BUCKET"),
        privateBucket: requiredEnvironmentValue(environment, "MEDIA_PRIVATE_BUCKET"),
        forcePathStyle: environment.MEDIA_S3_FORCE_PATH_STYLE === "true",
      }
    : {
        migrationEnvironment,
        driver,
        publicRoot: environment.MEDIA_LOCAL_PUBLIC_ROOT ?? environment.MEDIA_STORAGE_ROOT ?? "default-local-public-root",
        privateRoot: environment.MEDIA_LOCAL_PRIVATE_ROOT ?? environment.ORDER_UPLOAD_DIR ?? "default-local-private-root",
      };
  return { migrationEnvironment, migrationEnvironmentSha256: sha256(JSON.stringify(canonicalEnvironment)) };
}

function normalizedAssetIdentities(assets: MediaAssetIdentity[]) {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  return assets.map((asset) => {
    assert.ok(asset.id, "A media identity is missing its asset id.");
    assert.ok(asset.storageKey, `A media identity is missing its storage key for ${asset.id}.`);
    assert.match(asset.checksumSha256, /^[a-f0-9]{64}$/, `Invalid SHA-256 for ${asset.id}.`);
    assert.ok(!seenIds.has(asset.id), `Duplicate asset id in media inventory: ${asset.id}.`);
    assert.ok(!seenKeys.has(asset.storageKey), `Duplicate storage key in media inventory for ${asset.id}.`);
    seenIds.add(asset.id);
    seenKeys.add(asset.storageKey);
    return { id: asset.id, storageKey: asset.storageKey, checksumSha256: asset.checksumSha256 };
  }).sort((left, right) => left.id.localeCompare(right.id) || left.storageKey.localeCompare(right.storageKey));
}

export function mediaAssetSetSha256(assets: MediaAssetIdentity[]) {
  return sha256(JSON.stringify(normalizedAssetIdentities(assets)));
}

export function assertDatabaseChecksum(assetId: string, databaseChecksum: string | null | undefined, actualChecksum: string) {
  assert.match(actualChecksum, /^[a-f0-9]{64}$/, `Invalid source SHA-256 for ${assetId}.`);
  if (databaseChecksum) {
    assert.match(databaseChecksum, /^[a-f0-9]{64}$/, `Invalid database SHA-256 for ${assetId}.`);
    assert.equal(databaseChecksum, actualChecksum, `Database checksum mismatch for ${assetId}.`);
  }
}

export function assertMediaBackupManifestMatches(
  manifest: MediaBackupManifest,
  currentAssets: MediaAssetIdentity[],
  currentDatabase: ReturnType<typeof databaseTargetIdentity>,
  currentEnvironment: ReturnType<typeof mediaMigrationEnvironmentIdentity>,
) {
  assert.equal(manifest.format, MEDIA_BACKUP_FORMAT, "Unsupported media backup manifest format.");
  assert.equal(manifest.databaseTarget, currentDatabase.databaseTarget, "The backup targets another named database.");
  assert.equal(manifest.databaseIdentitySha256, currentDatabase.databaseIdentitySha256, "The backup targets another PostgreSQL database.");
  assert.equal(manifest.migrationEnvironment, currentEnvironment.migrationEnvironment, "The backup targets another deployment environment.");
  assert.equal(manifest.migrationEnvironmentSha256, currentEnvironment.migrationEnvironmentSha256, "The backup targets another media storage environment.");
  assert.equal(manifest.sourceCount, currentAssets.length, "The backup inventory count no longer matches the database.");
  assert.equal(manifest.assets?.length, currentAssets.length, "The backup asset mapping is incomplete.");

  const manifestAssets = manifest.assets ?? [];
  const manifestSetSha256 = mediaAssetSetSha256(manifestAssets);
  assert.equal(manifest.sourceSetSha256, manifestSetSha256, "The backup manifest asset set is internally inconsistent.");
  assert.equal(manifestSetSha256, mediaAssetSetSha256(currentAssets), "The backup asset id/key/checksum set no longer matches the database and source media.");

  const sourceBytes = manifestAssets.reduce((sum, asset) => {
    assert.match(asset.sizeBytes ?? "", /^(0|[1-9][0-9]*)$/, `Invalid source size for ${asset.id}.`);
    return sum + BigInt(asset.sizeBytes!);
  }, 0n).toString();
  assert.equal(manifest.sourceBytes, sourceBytes, "The backup manifest byte total is inconsistent.");
  const currentByIdentity = new Map(currentAssets.map((asset) => [`${asset.id}:${asset.storageKey}`, asset]));
  for (const asset of manifestAssets) {
    assert.equal(
      asset.sizeBytes,
      currentByIdentity.get(`${asset.id}:${asset.storageKey}`)?.sizeBytes,
      `The source size no longer matches the backup for ${asset.id}.`,
    );
  }
  return new Map(manifestAssets.map((asset) => [`${asset.id}:${asset.storageKey}`, asset.checksumSha256]));
}

export function assertStagingObjectMigrationConfiguration(environment: Environment = process.env) {
  assert.equal(environment.MEDIA_STORAGE_DRIVER, "s3", "Object migration requires the s3 media driver.");
  assert.equal(environment.MEDIA_DEPLOYMENT_ENV, "staging", "Object migration is restricted to staging.");
  assert.equal(environment.MEDIA_STORAGE_PROVIDER, "r2", "Object migration requires the R2 provider.");
  assert.equal(environment.MEDIA_S3_REGION, "auto", "R2 staging requires the auto region.");
  assert.equal(environment.MEDIA_S3_FORCE_PATH_STYLE, "false", "R2 staging requires virtual-host compatible addressing.");
  assert.equal(environment.MEDIA_PUBLIC_BUCKET, STAGING_PUBLIC_BUCKET, "The configured public bucket is not the approved staging bucket.");
  assert.equal(environment.MEDIA_PRIVATE_BUCKET, STAGING_PRIVATE_BUCKET, "The configured private bucket is not the approved staging bucket.");
  assert.notEqual(environment.MEDIA_PUBLIC_BUCKET, environment.MEDIA_PRIVATE_BUCKET, "Public and private staging buckets must be distinct.");

  const endpoint = new URL(requiredEnvironmentValue(environment, "MEDIA_S3_ENDPOINT"));
  assert.equal(endpoint.protocol, "https:", "R2 staging requires an HTTPS endpoint.");
  assert.match(endpoint.hostname, /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i, "The configured endpoint is not a Cloudflare R2 account endpoint.");
  assert.equal(endpoint.port, "", "The R2 endpoint must not specify a custom port.");
  assert.ok(!endpoint.username && !endpoint.password, "The R2 endpoint must not embed credentials.");
  assert.ok((endpoint.pathname === "/" || endpoint.pathname === "") && !endpoint.search && !endpoint.hash, "The R2 endpoint must not contain a path, query or fragment.");
  requiredEnvironmentValue(environment, "MEDIA_S3_ACCESS_KEY_ID");
  requiredEnvironmentValue(environment, "MEDIA_S3_SECRET_ACCESS_KEY");
}

export function assertMediaMigrationMaintenanceApproval(argv: string[], environment: Environment = process.env) {
  assert.ok(argv.includes("--maintenance-window"), "Execute mode requires the explicit --maintenance-window flag.");
  assert.equal(
    environment.MEDIA_MIGRATION_MAINTENANCE_CONFIRM,
    MEDIA_MIGRATION_MAINTENANCE_CONFIRMATION,
    "Execute mode requires explicit maintenance-window confirmation.",
  );
}
