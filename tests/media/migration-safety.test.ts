import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_BACKUP_FORMAT,
  MEDIA_MIGRATION_MAINTENANCE_CONFIRMATION,
  STAGING_PRIVATE_BUCKET,
  STAGING_PUBLIC_BUCKET,
  assertDatabaseChecksum,
  assertMediaBackupManifestMatches,
  assertMediaMigrationMaintenanceApproval,
  assertStagingObjectMigrationConfiguration,
  databaseTargetIdentity,
  mediaAssetSetSha256,
  mediaMigrationEnvironmentIdentity,
} from "@/lib/media/migration-safety";

const checksumA = "a".repeat(64);
const checksumB = "b".repeat(64);
const assets = [
  { id: "asset-b", storageKey: "catalog/covers/b.webp", checksumSha256: checksumB, sizeBytes: "12" },
  { id: "asset-a", storageKey: "catalog/covers/a.webp", checksumSha256: checksumA, sizeBytes: "10" },
];

function databaseEnvironment(database = "lnx_staging", password = "secret-one"): Record<string, string> {
  return {
    LNX_DATABASE_TARGET: "lnx-studio-r2-staging",
    DATABASE_URL: `postgresql://lnx:${password}@127.0.0.1:51238/${database}?schema=public`,
  };
}

function stagingEnvironment(): Record<string, string> {
  return {
    MEDIA_STORAGE_DRIVER: "s3",
    MEDIA_DEPLOYMENT_ENV: "staging",
    MEDIA_STORAGE_PROVIDER: "r2",
    MEDIA_S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    MEDIA_S3_REGION: "auto",
    MEDIA_S3_ACCESS_KEY_ID: "access-key",
    MEDIA_S3_SECRET_ACCESS_KEY: "secret-key",
    MEDIA_PUBLIC_BUCKET: STAGING_PUBLIC_BUCKET,
    MEDIA_PRIVATE_BUCKET: STAGING_PRIVATE_BUCKET,
    MEDIA_S3_FORCE_PATH_STYLE: "false",
  };
}

test("database identity excludes credentials while distinguishing the PostgreSQL target", () => {
  const first = databaseTargetIdentity(databaseEnvironment());
  const credentialRotation = databaseTargetIdentity(databaseEnvironment("lnx_staging", "secret-two"));
  const anotherDatabase = databaseTargetIdentity(databaseEnvironment("lnx_other", "secret-one"));
  assert.deepEqual(first, credentialRotation);
  assert.notEqual(first.databaseIdentitySha256, anotherDatabase.databaseIdentitySha256);
  assert.doesNotMatch(JSON.stringify(first), /secret|lnx_staging/);
});

test("backup manifest binds the exact database and asset id/key/checksum set", () => {
  const database = databaseTargetIdentity(databaseEnvironment());
  const environment = mediaMigrationEnvironmentIdentity(stagingEnvironment());
  const manifest = {
    format: MEDIA_BACKUP_FORMAT,
    ...database,
    ...environment,
    sourceCount: 2,
    sourceBytes: "22",
    sourceSetSha256: mediaAssetSetSha256(assets),
    assets,
  };
  assert.equal(assertMediaBackupManifestMatches(manifest, [...assets].reverse(), database, environment).size, 2);
  assert.throws(
    () => assertMediaBackupManifestMatches(manifest, assets, databaseTargetIdentity(databaseEnvironment("another")), environment),
    /another PostgreSQL database/,
  );
  assert.throws(
    () => assertMediaBackupManifestMatches(manifest, [{ ...assets[0], checksumSha256: checksumA }, assets[1]], database, environment),
    /no longer matches/,
  );
  assert.throws(
    () => assertMediaBackupManifestMatches({ ...manifest, sourceSetSha256: checksumA }, assets, database, environment),
    /internally inconsistent/,
  );
  assert.throws(
    () => assertMediaBackupManifestMatches(manifest, assets, database, mediaMigrationEnvironmentIdentity({ ...stagingEnvironment(), MEDIA_PRIVATE_BUCKET: "another-private" })),
    /another media storage environment/,
  );
});

test("database checksums fail closed when present", () => {
  assert.doesNotThrow(() => assertDatabaseChecksum("asset", null, checksumA));
  assert.doesNotThrow(() => assertDatabaseChecksum("asset", checksumA, checksumA));
  assert.throws(() => assertDatabaseChecksum("asset", checksumB, checksumA), /Database checksum mismatch/);
});

test("object migration accepts only the approved R2 staging target", () => {
  const valid = stagingEnvironment();
  assert.doesNotThrow(() => assertStagingObjectMigrationConfiguration(valid));
  assert.throws(
    () => assertStagingObjectMigrationConfiguration({ ...valid, MEDIA_PUBLIC_BUCKET: "production-public" }),
    /approved staging bucket/,
  );
  assert.throws(
    () => assertStagingObjectMigrationConfiguration({ ...valid, MEDIA_DEPLOYMENT_ENV: "production" }),
    /restricted to staging/,
  );
  assert.throws(
    () => assertStagingObjectMigrationConfiguration({ ...valid, MEDIA_S3_ENDPOINT: "https://s3.example.invalid" }),
    /not a Cloudflare R2 account endpoint/,
  );
});

test("write modes require both a maintenance flag and an environment confirmation", () => {
  const environment = { MEDIA_MIGRATION_MAINTENANCE_CONFIRM: MEDIA_MIGRATION_MAINTENANCE_CONFIRMATION };
  assert.doesNotThrow(() => assertMediaMigrationMaintenanceApproval(["node", "script", "--maintenance-window"], environment));
  assert.throws(() => assertMediaMigrationMaintenanceApproval(["node", "script"], environment), /maintenance-window flag/);
  assert.throws(
    () => assertMediaMigrationMaintenanceApproval(["node", "script", "--maintenance-window"], {}),
    /maintenance-window confirmation/,
  );
});
