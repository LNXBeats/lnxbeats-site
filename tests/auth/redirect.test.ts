import assert from "node:assert/strict";
import test from "node:test";

import { safeInternalPath } from "@/lib/auth/redirect";

test("safe internal paths preserve path, query and fragment", () => {
  assert.equal(safeInternalPath("/compte"), "/compte");
  assert.equal(safeInternalPath("/admin?vue=projets#actifs"), "/admin?vue=projets#actifs");
});

test("external, protocol-relative and malformed redirects fail closed", () => {
  assert.equal(safeInternalPath("https://example.com"), "/compte");
  assert.equal(safeInternalPath("//example.com/admin"), "/compte");
  assert.equal(safeInternalPath("/\\example.com/admin"), "/compte");
  assert.equal(safeInternalPath(" /admin"), "/compte");
  assert.equal(safeInternalPath("/admin\nignored"), "/compte");
  assert.equal(safeInternalPath(undefined, "/connexion"), "/connexion");
});
