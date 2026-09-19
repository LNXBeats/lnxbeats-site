import assert from "node:assert/strict";

import type { Client } from "pg";

export const CREATIONS_RUNTIME_GROUP = "lnx_creations_runtime";

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const CREATIONS_RELATION = /^(?:creations|creation_[a-z0-9_]+)$/;

export type RuntimeProvisioningResult = {
  database: string;
  migrationRole: string;
  runtimeRole: string;
  groupRole: string;
  tables: string[];
  sequences: string[];
};

export function assertSqlIdentifier(value: string, label: string) {
  assert.match(value, SQL_IDENTIFIER, `${label} must be a normalized PostgreSQL identifier.`);
  return value;
}

export function quoteSqlIdentifier(value: string, label = "SQL identifier") {
  return `"${assertSqlIdentifier(value, label)}"`;
}

export function isCreationsRuntimeRelation(value: string) {
  return CREATIONS_RELATION.test(value);
}

async function loadRole(client: Client, role: string) {
  const result = await client.query<{
    rolcanlogin: boolean;
    rolinherit: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
  }>(
    `SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
            rolreplication, rolbypassrls
       FROM pg_roles
      WHERE rolname = $1`,
    [role],
  );
  return result.rows[0] ?? null;
}

async function discoverRelations(client: Client, kind: "table" | "sequence") {
  const relkinds = kind === "table" ? ["r", "p"] : ["S"];
  const result = await client.query<{ name: string; owner: string }>(
    `SELECT c.relname AS name, owner.rolname AS owner
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_roles owner ON owner.oid = c.relowner
      WHERE n.nspname = 'public'
        AND c.relkind = ANY($1::"char"[])
      ORDER BY c.relname`,
    [relkinds],
  );
  return result.rows.filter(({ name }) => isCreationsRuntimeRelation(name));
}

export async function provisionCreationsRuntimePrivileges(client: Client, runtimeRoleValue: string) {
  const runtimeRole = assertSqlIdentifier(runtimeRoleValue, "Runtime role");
  const groupRole = assertSqlIdentifier(CREATIONS_RUNTIME_GROUP, "Runtime group role");
  const identity = await client.query<{ database: string; migration_role: string }>(
    "SELECT current_database() AS database, current_user AS migration_role",
  );
  const { database, migration_role: migrationRole } = identity.rows[0];
  assertSqlIdentifier(database, "Database");
  assertSqlIdentifier(migrationRole, "Migration role");
  assert.notEqual(runtimeRole, migrationRole, "Runtime and migration roles must be distinct.");

  const runtime = await loadRole(client, runtimeRole);
  assert.ok(runtime, "Runtime role does not exist.");
  assert.equal(runtime.rolcanlogin, true, "Runtime role must be a LOGIN role.");
  assert.equal(runtime.rolinherit, true, "Runtime role must inherit its scoped group membership.");
  assert.equal(runtime.rolsuper, false, "Runtime role must not be SUPERUSER.");
  assert.equal(runtime.rolcreatedb, false, "Runtime role must not have CREATEDB.");
  assert.equal(runtime.rolcreaterole, false, "Runtime role must not have CREATEROLE.");
  assert.equal(runtime.rolreplication, false, "Runtime role must not have REPLICATION.");
  assert.equal(runtime.rolbypassrls, false, "Runtime role must not have BYPASSRLS.");

  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('lnx-creations-runtime-privileges'))");
    const group = await loadRole(client, groupRole);
    if (!group) {
      await client.query(
        `CREATE ROLE ${quoteSqlIdentifier(groupRole)}
         NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
    } else {
      assert.equal(group.rolcanlogin, false, "Runtime group must remain NOLOGIN.");
      assert.equal(group.rolsuper, false, "Runtime group must not be SUPERUSER.");
      assert.equal(group.rolcreatedb, false, "Runtime group must not have CREATEDB.");
      assert.equal(group.rolcreaterole, false, "Runtime group must not have CREATEROLE.");
      assert.equal(group.rolreplication, false, "Runtime group must not have REPLICATION.");
      assert.equal(group.rolbypassrls, false, "Runtime group must not have BYPASSRLS.");
    }

    const tables = await discoverRelations(client, "table");
    assert.ok(tables.length > 0, "No Creations runtime table was found.");
    for (const relation of tables) {
      assert.equal(relation.owner, migrationRole, `${relation.name} must be owned by the migration role.`);
      await client.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${quoteSqlIdentifier(relation.name, "Table")} TO ${quoteSqlIdentifier(groupRole)}`,
      );
    }

    const sequences = await discoverRelations(client, "sequence");
    for (const sequence of sequences) {
      assert.equal(sequence.owner, migrationRole, `${sequence.name} must be owned by the migration role.`);
      await client.query(
        `GRANT USAGE ON SEQUENCE public.${quoteSqlIdentifier(sequence.name, "Sequence")} TO ${quoteSqlIdentifier(groupRole)}`,
      );
    }

    await client.query(`GRANT CONNECT ON DATABASE ${quoteSqlIdentifier(database, "Database")} TO ${quoteSqlIdentifier(groupRole)}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${quoteSqlIdentifier(groupRole)}`);
    await client.query(`GRANT ${quoteSqlIdentifier(groupRole)} TO ${quoteSqlIdentifier(runtimeRole)}`);
    await client.query("COMMIT");

    return {
      database,
      migrationRole,
      runtimeRole,
      groupRole,
      tables: tables.map(({ name }) => name),
      sequences: sequences.map(({ name }) => name),
    } satisfies RuntimeProvisioningResult;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
