import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_ORDER_VISIBILITY_AUDIT_TABLE,
  CREATIONS_RUNTIME_GROUP,
  assertSqlIdentifier,
  isCreationsRuntimeRelation,
  provisionAdminOrderVisibilityAuditPrivileges,
  quoteSqlIdentifier,
} from "@/lib/database/creations-runtime-privileges";

test("the stable Creations runtime group is a normalized non-login role name", () => {
  assert.equal(CREATIONS_RUNTIME_GROUP, "lnx_creations_runtime");
  assert.equal(quoteSqlIdentifier(CREATIONS_RUNTIME_GROUP), '"lnx_creations_runtime"');
});

test("SQL identifiers are fail-closed before interpolation", () => {
  assert.equal(assertSqlIdentifier("lnx_web_rot_20260908_01", "role"), "lnx_web_rot_20260908_01");
  for (const invalid of ["", "Postgres", "role-name", "role name", 'role"x', "a".repeat(64)]) {
    assert.throws(() => assertSqlIdentifier(invalid, "role"));
  }
});

test("only the Creations domain relation prefix is provisioned", () => {
  for (const allowed of [
    "creations",
    "creation_assets",
    "creation_external_links",
    "creation_media_upload_sessions",
    "creation_collaborators",
    "creation_collaborator_links",
    "creation_future_permissions_probe",
  ]) assert.equal(isCreationsRuntimeRelation(allowed), true, allowed);

  for (const denied of ["users", "assets", "orders", "rights_licenses", "creation", "creations_private-other"]) {
    assert.equal(isCreationsRuntimeRelation(denied), false, denied);
  }
});

function orderVisibilityProvisionerClient(options: { owner?: string; tableExists?: boolean } = {}) {
  const statements: string[] = [];
  const group = {
    rolcanlogin: false,
    rolinherit: true,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
  };
  const client = {
    async query(query: string) {
      statements.push(query);
      if (query.includes("SELECT current_database()")) {
        return { rows: [{ database: "railway", migration_role: "migration_role" }] };
      }
      if (query.includes("FROM pg_roles")) return { rows: [group] };
      if (query.includes("FROM pg_class")) {
        return { rows: options.tableExists === false ? [] : [{ owner: options.owner ?? "migration_role" }] };
      }
      return { rows: [] };
    },
  };
  return { client, statements };
}

test("order visibility runtime provisioning grants only SELECT and INSERT on its exact audit table", async () => {
  const { client, statements } = orderVisibilityProvisionerClient();

  const result = await provisionAdminOrderVisibilityAuditPrivileges(client as never);

  assert.deepEqual(result, {
    table: ADMIN_ORDER_VISIBILITY_AUDIT_TABLE,
    privileges: ["SELECT", "INSERT"],
  });
  assert.ok(statements.includes(
    'GRANT SELECT, INSERT ON TABLE public."order_current_view_visibility_events" TO "lnx_creations_runtime"',
  ));
  assert.equal(statements.some((statement) => /GRANT .*\bUPDATE\b|GRANT .*\bDELETE\b/.test(statement)), false);
});

test("order visibility provisioning fails closed if the audit table is missing or owned by another role", async () => {
  const missing = orderVisibilityProvisionerClient({ tableExists: false });
  await assert.rejects(
    provisionAdminOrderVisibilityAuditPrivileges(missing.client as never),
    /must exist before runtime grants/,
  );
  assert.equal(missing.statements.some((statement) => statement.startsWith("GRANT ")), false);

  const wrongOwner = orderVisibilityProvisionerClient({ owner: "unexpected_owner" });
  await assert.rejects(
    provisionAdminOrderVisibilityAuditPrivileges(wrongOwner.client as never),
    /must be owned by the migration role/,
  );
  assert.equal(wrongOwner.statements.some((statement) => statement.startsWith("GRANT ")), false);
});
