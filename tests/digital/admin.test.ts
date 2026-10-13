import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { digitalAdminPage, digitalSalesReadiness, runDigitalBatch, type DigitalReadinessTrack } from "@/lib/digital/admin";
const project = { status: "PUBLISHED", publicVisible: true }, offer = { priceCents: 149, active: true, rightsConfirmed: true };
const track = (id: string): DigitalReadinessTrack => ({ id, title: id, publication: "RELEASED", masterReady: true, mediaCleared: true, previewDurationMs: 59_900, offer });
test("Admin readiness counts only the actual released album offer, not announcements", () => {
  const result = digitalSalesReadiness(project, [track("one"), track("two"), { ...track("future"), publication: "ANNOUNCED" }], { ...offer, priceCents: 250 });
  assert.equal(result.albumReady, true); assert.equal(result.includedTrackCount, 2); assert.equal(result.items[2].ready, false); assert.equal(result.individualTotalCents, 298); assert.equal(result.albumMoreExpensive, false);
});
test("Admin independent album price warning is advisory and only compares identical sellable tracks", () => {
  const expensive = digitalSalesReadiness(project, [track("one"), track("two")], { ...offer, priceCents: 599 });
  assert.equal(expensive.albumMoreExpensive, true); assert.equal(expensive.albumReady, true);
  const incomplete = digitalSalesReadiness(project, [track("one"), { ...track("two"), offer: { ...offer, active: false } }], { ...offer, priceCents: 599 });
  assert.equal(incomplete.albumReady, true); assert.equal(incomplete.individualTotalCents, null); assert.equal(incomplete.albumMoreExpensive, false);
});
test("Admin readiness remains fail-closed for draft/hidden/media/rights/invalid excerpt", () => {
  for (const p of [{ ...project, status: "DRAFT" }, { ...project, publicVisible: false }]) assert.equal(digitalSalesReadiness(p, [track("a")], offer).albumReady, false);
  for (const change of [{ masterReady: false }, { mediaCleared: false }, { previewDurationMs: null }, { previewDurationMs: 60_001 }]) assert.equal(digitalSalesReadiness(project, [{ ...track("a"), ...change }], offer).albumReady, false);
  assert.equal(digitalSalesReadiness(project, [track("a")], { ...offer, rightsConfirmed: false }).albumReady, false);
});
test("Twelve-file batch has two active tasks maximum and keeps successes after one failure", async () => {
  let active = 0, peak = 0; const completed: number[] = [];
  await runDigitalBatch(Array.from({ length: 12 }, (_, i) => i), async i => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; if (i === 7) throw Error("invalid synthetic WAV"); completed.push(i); });
  assert.equal(peak, 2); assert.equal(completed.length, 11); assert.ok(completed.includes(11));
  await assert.rejects(runDigitalBatch(Array.from({ length: 51 }, (_, i) => i), async () => undefined), /BATCH_TOO_LARGE/);
});
test("Batch stop prevents new starts, and page parsing never accepts an arbitrary offset", async () => {
  let stopped = false; const started: number[] = [];
  await runDigitalBatch([1, 2, 3, 4], async n => { started.push(n); stopped = true; }, () => stopped); assert.deepEqual(started, [1]);
  assert.equal(digitalAdminPage("2"), 2); for (const value of ["0", "-1", "1e3", "1000000", undefined]) assert.equal(digitalAdminPage(value), 1);
});
test("Admin import keeps batch selection explicit and preserves prior rows; mutations stay authenticated", async () => {
  const ui = await readFile(new URL("../../components/digital-admin.tsx", import.meta.url), "utf8");
  assert.match(ui, /\[\.\.\.old, \.\.\.unique\.map/); assert.match(ui, /Choisir explicitement/); assert.match(ui, /saved\.previewStartMs === startMs/); assert.match(ui, /state !== "ready"/);
  const route = await readFile(new URL("../../app/api/admin/digital/projects/[id]/tracks/route.ts", import.meta.url), "utf8");
  assert.match(route, /digitalActor\(request, true\)/); assert.match(route, /digitalBody/); assert.match(route, /updateCatalogTrack/); assert.match(route, /moveCatalogTrack/);
});
