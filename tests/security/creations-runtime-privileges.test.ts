import assert from "node:assert/strict";
import test from "node:test";

import {
  CREATIONS_RUNTIME_GROUP,
  assertSqlIdentifier,
  isCreationsRuntimeRelation,
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
