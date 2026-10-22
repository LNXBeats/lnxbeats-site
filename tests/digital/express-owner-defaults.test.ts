import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expressDraft } from "../../lib/digital/express-policy";
import { EXPRESS_OWNER_ARTIST, EXPRESS_OWNER_COMPOSER, expressOwnerCreditPlan, expressHasCollaborationCredits } from "../../lib/digital/express-owner-defaults";

test("Owner defaults add only the requested principal artist and declared composer, not invented legal roles", () => {
  assert.deepEqual(expressOwnerCreditPlan([], false), [
    { name: EXPRESS_OWNER_ARTIST, role: "ARTIST" }, { name: EXPRESS_OWNER_COMPOSER, role: "COMPOSER" },
  ]);
  assert.doesNotMatch(JSON.stringify(expressOwnerCreditPlan([], false)), /WRITER|PRODUCER|PERFORMER|CLEARED|APPROVED/);
});
test("The additive plan is idempotent, avoids self aliases and preserves existing legal credits", () => {
  const existing = [{ name: "Ludovic Mathon", role: "ARTIST" }, { name: "A known composer", role: "COMPOSER" }, { name: "A known writer", role: "WRITER" }];
  const before = structuredClone(existing);
  assert.deepEqual(expressOwnerCreditPlan(existing, false), []);
  assert.deepEqual(existing, before);
  const added = expressOwnerCreditPlan([], false);
  assert.deepEqual(expressOwnerCreditPlan(added, false), []);
});
test("Collaboration mode and explicit collaborators never imply a sole-owner composer", () => {
  assert.deepEqual(expressOwnerCreditPlan([], true), [{ name: EXPRESS_OWNER_ARTIST, role: "ARTIST" }]);
  assert.equal(expressHasCollaborationCredits([{ name: "Guest", role: "FEATURING" }]), true);
  assert.equal(expressHasCollaborationCredits([{ name: "Guest", role: "ARTIST" }]), true);
  assert.equal(expressHasCollaborationCredits([{ name: "Guest Writer", role: "WRITER" }]), true);
  assert.equal(expressHasCollaborationCredits([{ name: "Guest Composer", role: "COMPOSER" }]), true);
  assert.equal(expressHasCollaborationCredits([{ name: EXPRESS_OWNER_ARTIST, role: "ARTIST" }, { name: EXPRESS_OWNER_COMPOSER, role: "COMPOSER" }]), false);
  const known = [{ name: "Guest", role: "COMPOSER" }];
  assert.deepEqual(expressOwnerCreditPlan(known, false), [{ name: EXPRESS_OWNER_ARTIST, role: "ARTIST" }]);
});
test("Draft collaboration choice is optional for old clients and rejects forged or non-boolean declarations", () => {
  const draft = { projectId: null, expectedUpdatedAt: null, title: "Synthetic original", type: "SINGLE", tracks: [{ id: null, title: "Synthetic original", priceCents: 129, expectedOfferVersion: 0 }], albumPriceCents: 990, expectedAlbumOfferVersion: 0, idempotencyKey: randomUUID() };
  assert.equal("hasCollaborations" in expressDraft(draft), false);
  for (const hasCollaborations of [true, false]) assert.equal(expressDraft({ ...draft, hasCollaborations }).hasCollaborations, hasCollaborations);
  for (const hasCollaborations of [undefined, null, "false", 0]) assert.throws(() => expressDraft({ ...draft, hasCollaborations }));
  assert.throws(() => expressDraft({ ...draft, ownerCreditsApproved: true }));
});
test("Credit defaults remain additive, restricted to private drafts, audited and isolated from publication approvals", async () => {
  const source = await readFile(new URL("../../lib/digital/express-service.ts", import.meta.url), "utf8");
  const draft = source.slice(source.indexOf("export async function saveExpressDraft"), source.indexOf("export async function publishExpressProject"));
  assert.match(draft, /p\.status === "DRAFT" && !p\.publicVisible && !p\.digitalOffers\.some\(o => o\.active\)/);
  assert.match(draft, /input\.hasCollaborations !== undefined && !!previousExpressDraft/);
  assert.match(draft, /addCatalogCreditInTransaction/); assert.match(draft, /creditIds: ownerCreditIds, independentRightsEvidence: false/);
  assert.doesNotMatch(draft, /credit\.(?:delete|update)|APPROVED|CLEARED|attested: true/);
  assert.match(source, /rightsAtPublication = !hasCollaborations/);
});
