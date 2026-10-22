import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { EXPRESS_COVER_OWNER_POLICY, catalogCoverDeclaration, expressOwnerCoverEligible } from "../../lib/catalog/cover-owner-policy";

test("A standing cover declaration is accepted only through its exact owner policy or the existing explicit checkbox", () => {
  const form = new FormData();
  assert.equal(catalogCoverDeclaration(form), null);
  for (const value of ["yes", "true", "OWNER", "on"]) { form.set("ownerDeclaration", value); assert.equal(catalogCoverDeclaration(form), null); }
  form.set("ownerDeclaration", EXPRESS_COVER_OWNER_POLICY); assert.equal(catalogCoverDeclaration(form), EXPRESS_COVER_OWNER_POLICY);
  form.delete("ownerDeclaration"); form.set("rightsConfirmed", "on"); assert.equal(catalogCoverDeclaration(form), "CHECKBOX");
});
test("Simplified cover upload cannot be used to bypass published, public, active or non-Express image reviews", () => {
  const valid = { status: "DRAFT", publicVisible: false, hasActiveOffers: false, expressDraft: true };
  assert.equal(expressOwnerCoverEligible(valid), true);
  for (const change of [{ status: "PUBLISHED" }, { status: "ARCHIVED" }, { publicVisible: true }, { hasActiveOffers: true }, { expressDraft: false }]) assert.equal(expressOwnerCoverEligible({ ...valid, ...change }), false);
});
test("Server cover activation rechecks owner eligibility after storage and records the exact checksum and actor", async () => {
  const source = await readFile(new URL("../../lib/catalog/cover.ts", import.meta.url), "utf8");
  assert.match(source, /await assertCurrentCoverVersion\(projectId, expectedCoverAssetId, declaration\)/);
  const stored = source.indexOf("const stored = await writeCatalogCover"), activation = source.indexOf("await assertOwnerCoverDeclaration(transaction, projectId, state, declaration);", stored);
  assert.ok(stored > -1 && activation > stored);
  assert.match(source, /kind: "MUSIC_EXPRESS_COVER_DECLARATION"/); assert.match(source, /actorId: declaration\.actorId/);
  assert.match(source, /sha256: stored\.checksumSha256/); assert.match(source, /replacedAssetId: state\.currentCoverAssetId/);
  assert.match(source, /independentRightsEvidence: false/);
  const route = await readFile(new URL("../../app/api/admin/catalogue/cover/route.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf("isSameOriginMutation") < route.indexOf("const session = await requireAdmin()"));
  assert.match(route, /actorId: session\.user\.id/);
});
