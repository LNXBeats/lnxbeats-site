import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { approvedLegalDocuments, consumerMediatorInformation } from "@/data/legal";
import { digitalMusicTermsDraft, digitalPrivacyAddendumDraft, DIGITAL_MUSIC_TERMS_DRAFT_TEXT, DIGITAL_MUSIC_TERMS_DRAFT_TEXT_HASH,
  existingLegalProofReferences } from "@/lib/digital/digital-legal";
test("only new digital draft documents; previous approvals/version hashes remain referenced and are not replaced", () => {
  for (const d of [digitalMusicTermsDraft, digitalPrivacyAddendumDraft]) {
    assert.equal(d.status, "DRAFT"); assert.equal(d.approvedAt, null); assert.equal(d.approvedBy, null); assert.equal(d.effectiveAt, null);
    assert.equal(d.legalReviewReference, null); assert.match(d.hashSha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(existingLegalProofReferences.map(p => p.hashSha256), approvedLegalDocuments.map(p => p.hashSha256));
  assert.ok(approvedLegalDocuments.every(d => d.status === "APPROVED"));
  assert.ok(!approvedLegalDocuments.some(d => d.version === digitalMusicTermsDraft.version));
  assert.equal(createHash("sha256").update(DIGITAL_MUSIC_TERMS_DRAFT_TEXT).digest("hex"), DIGITAL_MUSIC_TERMS_DRAFT_TEXT_HASH);
});
test("existing CM2C and French context reused; no new membership or automatic worldwide VAT exemption", () => {
  assert.ok(DIGITAL_MUSIC_TERMS_DRAFT_TEXT.includes(consumerMediatorInformation.name));
  assert.ok(DIGITAL_MUSIC_TERMS_DRAFT_TEXT.includes(consumerMediatorInformation.website));
  assert.match(DIGITAL_MUSIC_TERMS_DRAFT_TEXT, /CM2C est déjà désigné/);
  assert.match(DIGITAL_MUSIC_TERMS_DRAFT_TEXT, /SIRET 10687085000018/);
  assert.match(DIGITAL_MUSIC_TERMS_DRAFT_TEXT, /BNC\/micro-BNC/);
  assert.match(DIGITAL_MUSIC_TERMS_DRAFT_TEXT, /Aucune mention française article 293 B ou TVA zéro n’est appliquée par défaut/);
});
test("new documents preserve consumer guarantees, explicit supply/withdrawal review, formats and immutable purchases", () => {
  for (const text of ["WAV et au MP3", "ZIP WAV et un ZIP MP3 séparés", "Les garanties légales", "confirmation sur support durable", "n’est pas automatique", "sans clause absolue de non-remboursement", "ne transfère pas la propriété intellectuelle", "ne sont pas supprimés", "ni annulée par un avoir automatique"]) {
    assert.ok(DIGITAL_MUSIC_TERMS_DRAFT_TEXT.includes(text), text);
  }
  assert.ok(digitalMusicTermsDraft.reviewRequired.includes("CM2C_EXISTING_CONVENTION_DIGITAL_SCOPE"));
  assert.ok(digitalPrivacyAddendumDraft.reviewRequired.includes("DCN_DATA_RETENTION_AND_TAX_EVIDENCE"));
});
