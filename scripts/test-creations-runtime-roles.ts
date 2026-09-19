import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Client } from "pg";

import {
  CREATIONS_RUNTIME_GROUP,
  provisionCreationsRuntimePrivileges,
  quoteSqlIdentifier,
} from "@/lib/database/creations-runtime-privileges";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";

function requiredLocalUrl(name: string) {
  const value = process.env[name];
  assert.ok(value, `${name} is required.`);
  const parsed = assertSafeLocalPostgresUrl(value, name);
  assert.match(parsed.pathname, /_test$/, `${name} must target an explicit *_test database.`);
  return parsed;
}

const migrationUrl = requiredLocalUrl("MIGRATION_DATABASE_URL");
const runtimeAUrl = requiredLocalUrl("RUNTIME_A_DATABASE_URL");
const runtimeBUrl = requiredLocalUrl("RUNTIME_B_DATABASE_URL");
assert.equal(runtimeAUrl.pathname, migrationUrl.pathname);
assert.equal(runtimeBUrl.pathname, migrationUrl.pathname);

const migration = new Client({ connectionString: migrationUrl.toString(), application_name: "creations-role-qa-migration" });
const runtimeA = new Client({ connectionString: runtimeAUrl.toString(), application_name: "creations-role-qa-a" });
const runtimeB = new Client({ connectionString: runtimeBUrl.toString(), application_name: "creations-role-qa-b" });
const runtimeARole = decodeURIComponent(runtimeAUrl.username);
const runtimeBRole = decodeURIComponent(runtimeBUrl.username);
const group = quoteSqlIdentifier(CREATIONS_RUNTIME_GROUP);
const creationId = randomUUID();
const actorId = randomUUID();
const assetId = randomUUID();
const externalLinkId = randomUUID();
const collaboratorId = randomUUID();
const collaboratorLinkId = randomUUID();
const uploadId = randomUUID();

async function assertDenied(client: Client, sql: string) {
  try {
    await client.query(sql);
    assert.fail(`Operation unexpectedly allowed: ${sql}`);
  } catch (error) {
    assert.equal(error && typeof error === "object" && "code" in error ? error.code : null, "42501");
  }
}

async function assertRuntimeAttributes(client: Client) {
  const result = await client.query<{
    rolcanlogin: boolean;
    rolinherit: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolbypassrls: boolean;
  }>("SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user");
  assert.deepEqual(result.rows[0], {
    rolcanlogin: true,
    rolinherit: true,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolbypassrls: false,
  });
}

async function exerciseCreationDomain(client: Client, label: string) {
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO creations (id, slug, title, status, "lockVersion", "updatedAt")
       VALUES ($1, $2, $3, 'DRAFT', 1, now())`,
      [creationId, `runtime-${label}`, `Runtime ${label}`],
    );
    await client.query(
      `INSERT INTO creation_assets ("creationId", role, "assetId") VALUES ($1, 'VIDEO', $2)`,
      [creationId, assetId],
    );
    await client.query(
      `INSERT INTO creation_external_links (id, "creationId", label, url, position, "updatedAt")
       VALUES ($1, $2, 'Official', $3, 0, now())`,
      [externalLinkId, creationId, `https://example.invalid/${label}`],
    );
    await client.query(
      `INSERT INTO creation_collaborators (id, "creationId", "displayName", role, position, "updatedAt")
       VALUES ($1, $2, 'Runtime Artist', 'Artist', 0, now())`,
      [collaboratorId, creationId],
    );
    await client.query(
      `INSERT INTO creation_collaborator_links (id, "collaboratorId", platform, label, url, position, "updatedAt")
       VALUES ($1, $2, 'WEBSITE', 'Official', $3, 0, now())`,
      [collaboratorLinkId, collaboratorId, `https://example.invalid/artist/${label}`],
    );
    await client.query(
      `INSERT INTO creation_media_upload_sessions (
        id, "tokenHash", "creationId", "creationSlug", "actorUserId", role, status,
        "expectedLockVersion", "rightsConfirmed", "originalFilename", "declaredMimeType",
        "declaredSizeBytes", "quarantineKey", provider, "providerUploadId", "partSizeBytes",
        "partCount", "expiresAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, 'VIDEO', 'UPLOADING', 1, TRUE, 'runtime.mp4',
        'video/mp4', 1024, $6, 'runtime-test', $7, 8388608, 1, now() + interval '1 hour', now())`,
      [uploadId, "a".repeat(64), creationId, `runtime-${label}`, actorId, `creations/quarantine/${creationId}/${uploadId}/video.mp4`, `provider-${label}-${uploadId}`],
    );
    const result = await client.query(
      `SELECT c.id
         FROM creations c
         JOIN creation_assets a ON a."creationId" = c.id
         JOIN creation_external_links e ON e."creationId" = c.id
         JOIN creation_collaborators collaborator ON collaborator."creationId" = c.id
         JOIN creation_collaborator_links collaborator_link ON collaborator_link."collaboratorId" = collaborator.id
         JOIN creation_media_upload_sessions upload ON upload."creationId" = c.id
        WHERE c.id = $1`,
      [creationId],
    );
    assert.equal(result.rowCount, 1);
    for (const [table, timestamp] of [
      ["creations", "updatedAt"],
      ["creation_assets", "createdAt"],
      ["creation_external_links", "updatedAt"],
      ["creation_media_upload_sessions", "updatedAt"],
      ["creation_collaborators", "updatedAt"],
      ["creation_collaborator_links", "updatedAt"],
    ] as const) {
      await client.query(`UPDATE ${quoteSqlIdentifier(table)} SET "${timestamp}" = "${timestamp}" WHERE false`);
    }
    await client.query("DELETE FROM creation_media_upload_sessions WHERE id = $1", [uploadId]);
    await client.query("DELETE FROM creation_collaborator_links WHERE id = $1", [collaboratorLinkId]);
    await client.query("DELETE FROM creation_collaborators WHERE id = $1", [collaboratorId]);
    await client.query("DELETE FROM creation_external_links WHERE id = $1", [externalLinkId]);
    await client.query('DELETE FROM creation_assets WHERE "creationId" = $1', [creationId]);
    await client.query("DELETE FROM creations WHERE id = $1", [creationId]);
  } finally {
    await client.query("ROLLBACK");
  }
}

try {
  await migration.connect();
  await migration.query(
    `INSERT INTO users (id, email, "displayName", role, status, "updatedAt")
     VALUES ($1, $2, 'Runtime QA', 'ADMIN', 'ACTIVE', now())`,
    [actorId, `runtime-role-${actorId}@example.invalid`],
  );
  await migration.query(
    `INSERT INTO assets (id, type, "storageKey", filename, "mimeType", "sizeBytes", "updatedAt")
     VALUES ($1, 'VIDEO', $2, 'runtime.mp4', 'video/mp4', 1024, now())`,
    [assetId, `runtime/roles/${assetId}.mp4`],
  );
  await migration.query("CREATE TABLE unrelated_runtime_probe (id integer)");

  const provisionedA = await provisionCreationsRuntimePrivileges(migration, runtimeARole);
  assert.equal(provisionedA.tables.length, 6);
  assert.deepEqual(provisionedA.sequences, []);
  await runtimeA.connect();
  await assertRuntimeAttributes(runtimeA);
  await exerciseCreationDomain(runtimeA, "a");
  await assertDenied(runtimeA, "CREATE TABLE runtime_a_forbidden(id integer)");
  await assertDenied(runtimeA, "SELECT * FROM _prisma_migrations LIMIT 1");
  await assertDenied(runtimeA, "SELECT * FROM unrelated_runtime_probe");

  const provisionedB = await provisionCreationsRuntimePrivileges(migration, runtimeBRole);
  assert.equal(provisionedB.tables.length, 6);
  await runtimeB.connect();
  await assertRuntimeAttributes(runtimeB);
  await exerciseCreationDomain(runtimeB, "b");

  await migration.query(`REVOKE ${group} FROM ${quoteSqlIdentifier(runtimeARole, "Runtime A role")}`);
  await assertDenied(runtimeA, "SELECT * FROM creations LIMIT 1");
  assert.equal((await runtimeB.query("SELECT count(*)::int AS count FROM creations")).rows[0].count, 0);

  await migration.query("CREATE TABLE creation_future_permissions_probe (id integer)");
  await migration.query("CREATE SEQUENCE creation_future_permissions_probe_seq");
  await assertDenied(runtimeB, "SELECT * FROM creation_future_permissions_probe");
  const future = await provisionCreationsRuntimePrivileges(migration, runtimeBRole);
  assert.ok(future.tables.includes("creation_future_permissions_probe"));
  assert.deepEqual(future.sequences, ["creation_future_permissions_probe_seq"]);
  await runtimeB.query("BEGIN");
  await runtimeB.query("INSERT INTO creation_future_permissions_probe VALUES (1)");
  await runtimeB.query("UPDATE creation_future_permissions_probe SET id = 2 WHERE id = 1");
  assert.equal((await runtimeB.query("SELECT id FROM creation_future_permissions_probe")).rows[0].id, 2);
  await runtimeB.query("DELETE FROM creation_future_permissions_probe WHERE id = 2");
  assert.equal((await runtimeB.query("SELECT nextval('creation_future_permissions_probe_seq') AS value")).rows[0].value, "1");
  await runtimeB.query("ROLLBACK");

  console.log(JSON.stringify({
    runtimeA: "PASS",
    runtimeBRotation: "PASS",
    futureTable: "PASS",
    futureSequence: "PASS",
    creationsTables: provisionedB.tables,
    currentCreationsSequences: provisionedB.sequences,
    ddlDenied: true,
    prismaHistoryDenied: true,
    unrelatedTableDenied: true,
  }, null, 2));
} finally {
  await runtimeA.end().catch(() => undefined);
  await runtimeB.end().catch(() => undefined);
  await migration.query("DROP TABLE IF EXISTS creation_future_permissions_probe").catch(() => undefined);
  await migration.query("DROP SEQUENCE IF EXISTS creation_future_permissions_probe_seq").catch(() => undefined);
  await migration.query("DROP TABLE IF EXISTS unrelated_runtime_probe").catch(() => undefined);
  await migration.query("DELETE FROM assets WHERE id = $1", [assetId]).catch(() => undefined);
  await migration.query("DELETE FROM users WHERE id = $1", [actorId]).catch(() => undefined);
  await migration.end().catch(() => undefined);
}
