import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../../prisma/migrations/20260913180000_creations_multimedia_foundation/migration.sql",
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
