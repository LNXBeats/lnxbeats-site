import assert from "node:assert/strict";
import test from "node:test";
import {
  digitalFranceLiveContractCandidate as candidate, DIGITAL_FRANCE_LIVE_CONTRACT_TEXT as text,
  DIGITAL_FRANCE_LIVE_CONTRACT_VERSION as version, DIGITAL_FRANCE_LIVE_CONTRACT_SCOPE as scope,
  DIGITAL_FRANCE_LIVE_CONTRACT_TEXT_HASH as textHash, DIGITAL_FRANCE_LIVE_CONTRACT_CONSENTS_HASH as consentsHash,
  assessDigitalFranceLiveContractApproval as assess, digitalFranceLiveContractApprovalHash as recordHash,
  snapshotDigitalFranceLiveContractApproval as snapshot, validateSavedDigitalFranceLiveContractApproval as saved,
  digitalFranceLiveContractByVersion as byVersion, type DigitalFranceLiveContractApproval,
} from "../../lib/digital/france-live-contract";
import {digitalFranceTermsDraft, DIGITAL_FRANCE_TERMS_TEXT_HASH} from "@/lib/digital/france-legal";
const now = new Date("2026-10-16T17:00:00.000Z");
const actor = { id: "11111111-1111-4111-8111-111111111111", role: "ADMIN", status: "ACTIVE", emailVerified: true };
function approval(): DigitalFranceLiveContractApproval {
  const body = { id: "22222222-2222-4222-8222-222222222222", kind: "DIGITAL_FRANCE_LIVE_CONTRACT_APPROVAL" as const, status: "APPROVED" as const,
    version, documentHashSha256: candidate.hashSha256, textHashSha256: textHash, consentsHashSha256: consentsHash, scope,
    approvedAt: "2026-10-16T16:00:00.000Z", createdAt: "2026-10-16T16:01:00.000Z", approvedBy: actor.id,
    evidenceReference: "private-evidence:synthetic-fixture-not-real-approval", evidenceSha256: "a".repeat(64) };
  return {...body, recordHash: recordHash(body)};
}
test("candidate remains DRAFT and never approves importing it", () => {
  assert.equal(candidate.status,"DRAFT"); assert.equal(candidate.approvedForLive,false); assert.equal(candidate.approvedBy,null);
  assert.equal(assess(null,actor,now),false); assert.throws(()=>snapshot(null,actor,now),/APPROVAL_REQUIRED/);
});
test("frozen02 document and text hashes preserved",()=>{
  assert.equal(DIGITAL_FRANCE_TERMS_TEXT_HASH,"5e350e6bddb003b6ff0d2cd0236aa6876857b2d0376f8c99dd8362e8a1babe48");
  assert.equal(digitalFranceTermsDraft.hashSha256,"30c7ac06586dad083f13c334affd4763ba4c9b215b3c8f4cc28522e400ef042c");
});
test("11 sections and appendix retained, guarantee box byte-preserved",()=>{
  assert.equal(candidate.sections.length,12); assert.deepEqual(candidate.sections[8],digitalFranceTermsDraft.sections[8]);
  assert.deepEqual(candidate.sections[11],digitalFranceTermsDraft.sections[11]);
});
test("commercial wording and CM2C correction do not create a hardcoded tax exemption",()=>{
  assert.ok(text.includes("CM2C a confirmé le 15 octobre 2026")); assert.ok(!text.includes("les montants de démonstration restent fictifs"));
  assert.ok(!text.includes("pas encore approuvées pour une vente réelle"));
  assert.equal(candidate.fiscalMentionPolicy,"EXACT_APPROVED_LIVE_RULE_SNAPSHOT_REQUIRED"); assert.ok(!text.includes("293 B"));
});
test("coherent synthetic approval validates only with freshly verified actor",()=>{
  assert.equal(assess(approval(),actor,now),true); assert.equal(assess(approval(),null,now),false);
  assert.equal(assess(approval(),{...actor,emailVerified:false},now),false); assert.equal(assess(approval(),{...actor,status:"DISABLED"},now),false);
});
test("version/document/text/consents/scope substitution fails closed",()=>{
  for(const field of ["version","documentHashSha256","textHashSha256","consentsHashSha256","scope"] as const) assert.equal(assess({...approval(),[field]:"wrong"},actor,now),false);
});
test("missing proof, revoked approval, future date and tampered hash rejected",()=>{
  assert.equal(assess({...approval(),evidenceReference:""},actor,now),false); assert.equal(assess({...approval(),status:"REVOKED"},actor,now),false);
  assert.equal(assess({...approval(),createdAt:"2099-01-01T00:00:00.000Z"},actor,now),false); assert.equal(assess({...approval(),recordHash:"0".repeat(64)},actor,now),false);
});
test("historical snapshot remains valid independently of a later actor revocation",()=>{
  const acquired=snapshot(approval(),actor,now); assert.equal(saved(acquired),true);
  assert.equal(assess(approval(),{...actor,status:"DISABLED"},new Date("2027-01-01T00:00:00.000Z")),false);
  assert.equal(saved(acquired),true); assert.equal(saved({...acquired,snapshotHash:"0".repeat(64)}),false);
});
test("explicit version lookup cannot silently substitute latest for an old purchase",()=>{
  assert.equal(byVersion(version),candidate); assert.equal(byVersion("digital-music-france-cgv-20261015-draft-02"),null);
});
