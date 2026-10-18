import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ownerOriginalConfirmation, artisticProvenance, requiresParticularRightsCase } from "../../lib/digital/group-review-policy";
import { digitalExcerptInput } from "../../lib/digital/excerpt-policy";
test("a personal original confirmation generates an exact declaration without inventing third-party evidence", () => {
  const facts = ownerOriginalConfirmation({ policy: "OWNER_ORIGINAL_CONFIRMATION_V1", confirmed: true });
  assert.match(facts.statement, /déclaration personnelle/i); assert.match(facts.statement, /pas une certification indépendante/);
  for (const value of [true, "oui", {}, { policy: facts.policy, confirmed: false }, { policy: facts.policy, confirmed: true, externalProof: true }]) assert.throws(() => ownerOriginalConfirmation(value));
});
test("particular restrictions remain blocked after simplifying personal paperwork", () => {
  assert.equal(requiresParticularRightsCase(["FEATURING"], [], []), true);
  assert.equal(requiresParticularRightsCase([], ["RESTRICTED"], []), true);
  assert.equal(requiresParticularRightsCase([], [], ["REVOKED"]), true);
});
test("owner-declared approval is distinct from actual recorded playback", () => {
  assert.equal(artisticProvenance(undefined), "RECORDED_PLAYBACK"); assert.equal(artisticProvenance("OWNER_DECLARED"), "OWNER_DECLARED"); assert.throws(() => artisticProvenance("AUTO"));
  const base = { action: "validate-prepared", startMs: 0, expectedRevisionId: null, idempotencyKey: randomUUID(), attested: true };
  assert.equal(digitalExcerptInput({ ...base, provenance: "OWNER_DECLARED", receiptId: null }).provenance, "OWNER_DECLARED");
  assert.throws(() => digitalExcerptInput({ ...base, provenance: "OWNER_DECLARED", receiptId: randomUUID() }));
  assert.throws(() => digitalExcerptInput({ ...base, provenance: "RECORDED_PLAYBACK", receiptId: null }));
});
