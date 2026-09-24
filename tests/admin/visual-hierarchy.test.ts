import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { orderAdminKpis } from "@/lib/admin/kpi-presentation";

test("actionable KPIs precede positive neutral counts and zero counts without losing an indicator", () => {
  const metrics = [
    { title: "Zero", count: 0, tone: "attention" },
    { title: "Reference", count: 3, tone: "neutral" },
    { title: "Action", count: 1, tone: "attention" },
    { title: "Another zero", count: 0, tone: "neutral" },
  ] as const;
  assert.deepEqual(orderAdminKpis(metrics).map((item) => item.title), ["Action", "Reference", "Zero", "Another zero"]);
  assert.deepEqual(metrics.map((item) => item.title), ["Zero", "Reference", "Action", "Another zero"]);
});

test("quiet indicators stay readable and member rows keep a read-only account access", async () => {
  const [css, members] = await Promise.all([
    readFile(new URL("../../app/admin/admin.css", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/membres/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(css, /\.admin-v21-stat\[data-tone="quiet"\] \{ min-height: 76px/);
  assert.match(css, /@media \(min-width: 1121px\)[\s\S]*?\.admin-v21-member-grid \{ grid-template-columns: minmax\(0,1fr\)/);
  assert.match(members, /className="admin-v21-member-card__action" href=\{`\/admin\/membres\?q=\$\{encodeURIComponent\(member.email\)\}`\}/);
  assert.doesNotMatch(members, /prisma\.[a-z]+\.(?:update|delete|create)|<form[^>]*method="post"/);
});
