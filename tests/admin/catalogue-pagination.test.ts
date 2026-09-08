import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the Admin discography uses bounded server pagination and preserves filters", async () => {
  const [service, page] = await Promise.all([
    readFile("lib/catalog/service.ts", "utf8"),
    readFile("app/admin/catalogue/page.tsx", "utf8"),
  ]);
  assert.match(service, /ADMIN_CATALOG_PAGE_SIZE = 10/);
  assert.match(service, /skip: \(page - 1\) \* ADMIN_CATALOG_PAGE_SIZE/);
  assert.match(service, /take: ADMIN_CATALOG_PAGE_SIZE/);
  assert.match(service, /project\.groupBy/);
  assert.match(page, /aria-label="Pagination de la discographie"/);
  assert.match(page, /Masqués \/ archivés/);
  assert.match(page, /values\.set\("q", query\)/);
  assert.match(page, /values\.set\("statut", status\)/);
});
