import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("route Gestion réservée ADMIN actif, privée, LIVE, sans accès fournisseur ni mutation", async () => {
  const source = await readFile(new URL("../../app/api/admin/recettes/gestion/route.ts", import.meta.url), "utf8");
  assert.match(source, /getAuthSession\(\)/);
  assert.match(source, /session\.user\.status !== "ACTIVE"/); assert.match(source, /session\.user\.role !== "ADMIN"/);
  assert.ok(source.indexOf("status: 403") < source.indexOf("await loadRevenue("));
  assert.match(source, /private, no-store/); assert.match(source, /noindex, nofollow/); assert.match(source, /nosniff/);
  assert.match(source, /params\.get\("mode"\) !== "LIVE"/); assert.match(source, /mode: "LIVE"/);
  assert.match(source, /buildRevenueExchange\(report\)/); assert.match(source, /Content-Disposition/);
  assert.doesNotMatch(source, /fetch\(|\.create\(|\.update\(|\.delete\(|process\.env|STRIPE_SECRET|PAYPAL_SECRET|checkoutUrl|storageKey/);
  assert.doesNotMatch(source, /export async function (POST|PUT|DELETE|PATCH)/);
});
