import assert from "node:assert/strict";

import { Client } from "pg";

import { provisionCreationsRuntimePrivileges } from "@/lib/database/creations-runtime-privileges";

function requiredPostgresUrl(value: string | undefined, label: string) {
  assert.ok(value, `${label} is required.`);
  const parsed = new URL(value);
  assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol), `${label} must use PostgreSQL.`);
  assert.ok(parsed.username, `${label} must identify a database role.`);
  assert.ok(parsed.pathname.length > 1, `${label} must identify a database.`);
  return parsed;
}

const migration = requiredPostgresUrl(process.env.MIGRATION_DATABASE_URL, "MIGRATION_DATABASE_URL");
const runtime = requiredPostgresUrl(process.env.RUNTIME_DATABASE_URL ?? process.env.DATABASE_URL, "RUNTIME_DATABASE_URL");
assert.equal(runtime.pathname, migration.pathname, "Runtime and migration URLs must target the same database.");

const client = new Client({
  connectionString: migration.toString(),
  application_name: "lnx-creations-runtime-provisioning",
});

try {
  await client.connect();
  const result = await provisionCreationsRuntimePrivileges(client, decodeURIComponent(runtime.username));
  console.log(JSON.stringify({
    status: "ok",
    database: result.database,
    migrationRole: result.migrationRole,
    runtimeRole: result.runtimeRole,
    groupRole: result.groupRole,
    tables: result.tables,
    sequences: result.sequences,
    defaultPrivileges: "not used; post-migration provisioning is prefix-scoped",
  }, null, 2));
} finally {
  await client.end().catch(() => undefined);
}
