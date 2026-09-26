import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeAdminSearchQuery } from "@/lib/admin/search";

test("Admin global search rejects short and control-only queries and bounds input", () => {
  assert.equal(normalizeAdminSearchQuery(" a "), "");
  assert.equal(normalizeAdminSearchQuery("\u0000\n  LNX-2026-001  "), "LNX-2026-001");
  assert.equal(normalizeAdminSearchQuery("a".repeat(200)).length, 120);
});

test("Admin search is authenticated, bounded per domain and read-only", () => {
  const page = readFileSync("app/admin/recherche/page.tsx", "utf8");
  const service = readFileSync("lib/admin/search.ts", "utf8");
  const topbar = readFileSync("components/admin-topbar.tsx", "utf8");
  assert.ok(page.indexOf("await requireAdmin()") < page.indexOf("searchAdminRecords(query,"));
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(topbar, /action="\/admin\/recherche" method="get" role="search"/);
  assert.match(service, /if \(!query\) return \[\]/);
  assert.match(service, /includeHiddenOrders/);
  assert.match(service, /hiddenFromCurrentViewsAt: null/);
  assert.equal((service.match(/take: 6/g) ?? []).length, 7);
  for (const domain of ["prisma.order.findMany", "prisma.shopOrder.findMany", "prisma.creation.findMany", "prisma.project.findMany", "prisma.user.findMany", "prisma.invoice.findMany", "prisma.creditNote.findMany"]) assert.ok(service.includes(domain), domain);
  assert.doesNotMatch(service, /\.create\(|\.update\(|\.delete\(|\$executeRaw|\$queryRaw/);
});
