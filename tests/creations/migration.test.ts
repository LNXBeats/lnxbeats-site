import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../../prisma/migrations/20260913180000_creations_multimedia_foundation/migration.sql",
  import.meta.url,
);
const correctiveMigrationUrl = new URL(
  "../../prisma/migrations/20260913220000_creation_direct_upload_pipeline/migration.sql",
  import.meta.url,
);

test("V3.3 migration is additive and contains no Rights V4 payload", async () => {
  const [sql, migrationDirectories] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readdir(new URL("../../prisma/migrations", import.meta.url)),
  ]);
  assert.match(sql, /CREATE TYPE "CreationStatus"/);
  assert.match(sql, /CREATE TABLE "creations"/);
  assert.match(sql, /CREATE TABLE "creation_assets"/);
  assert.match(sql, /CREATE TABLE "creation_external_links"/);
  assert.match(sql, /REFERENCES "assets"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /creations_status_timestamps/);
  assert.match(sql, /creations_published_fields_complete/);
  assert.match(sql, /creation_external_links_https/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO)\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+"?[a-z_]+"?\s+SET\b/i);
  assert.doesNotMatch(sql, /publication_license_contract_v4|Rights V4|PublicationLicense/i);
  assert.equal(migrationDirectories.some((name) => name.includes("publication_license_contract_v4")), false);
});

test("corrective direct-upload migration is additive, video-only and Rights-free", async () => {
  const sql = await readFile(correctiveMigrationUrl, "utf8");
  assert.match(sql, /CREATE TYPE "CreationMediaUploadStatus"/);
  assert.match(sql, /CREATE TABLE "creation_media_upload_sessions"/);
  assert.match(sql, /"role" = 'VIDEO'/);
  assert.match(sql, /"declaredSizeBytes" > 0.*209715200/s);
  assert.match(sql, /"partSizeBytes" = 8388608/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO)\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+"?[a-z_]+"?\s+SET\b/i);
  assert.doesNotMatch(sql, /publication_license_contract_v4|Rights V4|PublicationLicense/i);
});

test("corrective direct-upload migration upgrades the reviewed V3.3 foundation", async () => {
  const [foundation, corrective] = await Promise.all([readFile(migrationUrl, "utf8"), readFile(correctiveMigrationUrl, "utf8")]);
  const database = new PGlite();
  try {
    await database.exec('CREATE TABLE "assets" ("id" UUID NOT NULL, CONSTRAINT "assets_pkey" PRIMARY KEY ("id"));');
    await database.exec('CREATE TABLE "users" ("id" UUID NOT NULL, CONSTRAINT "users_pkey" PRIMARY KEY ("id"));');
    await database.exec(foundation);
    await database.exec(corrective);
    await database.exec(`
      INSERT INTO "users" ("id") VALUES ('30000000-0000-4000-8000-000000000001');
      INSERT INTO "creations" ("id", "slug", "title", "status", "lockVersion", "updatedAt") VALUES
        ('10000000-0000-4000-8000-000000000001', 'video-test', 'Video test', 'DRAFT', 1, CURRENT_TIMESTAMP);
      INSERT INTO "creation_media_upload_sessions" (
        "id", "tokenHash", "creationId", "creationSlug", "actorUserId", "role", "expectedLockVersion",
        "rightsConfirmed", "originalFilename", "declaredMimeType", "declaredSizeBytes", "quarantineKey",
        "provider", "providerUploadId", "partSizeBytes", "partCount", "expiresAt", "updatedAt"
      ) VALUES (
        '40000000-0000-4000-8000-000000000001', '${"a".repeat(64)}',
        '10000000-0000-4000-8000-000000000001', 'video-test', '30000000-0000-4000-8000-000000000001',
        'VIDEO', 1, TRUE, 'test.mp4', 'video/mp4', 25, 'creations/quarantine/a/b/video.mp4',
        'r2', 'upload-1', 8388608, 1, CURRENT_TIMESTAMP + interval '1 hour', CURRENT_TIMESTAMP
      );
    `);
    const result = await database.query<{ status: string; size: string }>('SELECT "status"::text AS status, "declaredSizeBytes"::text AS size FROM "creation_media_upload_sessions"');
    assert.deepEqual(result.rows, [{ status: "UPLOADING", size: "25" }]);
    await assert.rejects(database.exec(`UPDATE "creation_media_upload_sessions" SET "declaredSizeBytes" = 0;`), /size_valid/);
    await assert.rejects(database.exec(`UPDATE "creation_media_upload_sessions" SET "role" = 'AUDIO';`), /video_only/);
  } finally {
    await database.close();
  }
});

test("V3.3 migration applies on PostgreSQL and enforces lifecycle, links and asset references", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const database = new PGlite();
  try {
    await database.exec('CREATE TABLE "assets" ("id" UUID NOT NULL, CONSTRAINT "assets_pkey" PRIMARY KEY ("id"));');
    await database.exec(sql);
    await database.exec(`
      INSERT INTO "assets" ("id") VALUES ('00000000-0000-4000-8000-000000000010');
      INSERT INTO "creations" (
        "id", "slug", "title", "summary", "primaryMedia", "position", "status", "lockVersion", "updatedAt"
      ) VALUES (
        '00000000-0000-4000-8000-000000000001',
        'creation-test',
        'Création test',
        'Résumé éditorial',
        'VIDEO',
        0,
        'DRAFT',
        1,
        CURRENT_TIMESTAMP
      );
      INSERT INTO "creation_assets" ("creationId", "role", "assetId") VALUES (
        '00000000-0000-4000-8000-000000000001',
        'VIDEO',
        '00000000-0000-4000-8000-000000000010'
      );
      INSERT INTO "creation_external_links" (
        "id", "creationId", "label", "url", "position", "updatedAt"
      ) VALUES (
        '00000000-0000-4000-8000-000000000020',
        '00000000-0000-4000-8000-000000000001',
        'Voir la collaboration',
        'https://example.com/collaboration',
        0,
        CURRENT_TIMESTAMP
      );
    `);

    const rows = await database.query<{ slug: string; status: string }>(
      'SELECT "slug", "status"::text AS "status" FROM "creations"',
    );
    assert.deepEqual(rows.rows, [{ slug: "creation-test", status: "DRAFT" }]);

    await assert.rejects(
      database.exec(`INSERT INTO "creations" (
        "id", "slug", "title", "summary", "primaryMedia", "status", "updatedAt"
      ) VALUES (
        '00000000-0000-4000-8000-000000000002',
        'publication-invalide',
        'Invalide',
        'Résumé valide',
        'VIDEO',
        'PUBLISHED',
        CURRENT_TIMESTAMP
      );`),
      /creations_status_timestamps/,
    );
    await assert.rejects(
      database.exec(`INSERT INTO "creations" (
        "id", "slug", "title", "status", "publishedAt", "updatedAt"
      ) VALUES (
        '00000000-0000-4000-8000-000000000003',
        'publication-sans-champs',
        'Publication incomplète',
        'PUBLISHED',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      );`),
      /creations_published_fields_complete/,
    );
    await assert.rejects(
      database.exec(`INSERT INTO "creation_external_links" (
        "id", "creationId", "label", "url", "updatedAt"
      ) VALUES (
        '00000000-0000-4000-8000-000000000021',
        '00000000-0000-4000-8000-000000000001',
        'Lien non sûr',
        'http://example.com',
        CURRENT_TIMESTAMP
      );`),
      /creation_external_links_https/,
    );
    await assert.rejects(
      database.exec(`INSERT INTO "creation_assets" ("creationId", "role", "assetId") VALUES (
        '00000000-0000-4000-8000-000000000001',
        'AUDIO',
        '00000000-0000-4000-8000-000000000099'
      );`),
      /creation_assets_assetId_fkey/,
    );
  } finally {
    await database.close();
  }
});
