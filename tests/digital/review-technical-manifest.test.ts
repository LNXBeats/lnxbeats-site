import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { browserSha256, privateEvidenceFingerprint, PRIVATE_EVIDENCE_MAX_BYTES, technicalReviewManifest } from "../../lib/digital/review-technical-manifest";
const track = { id: "t", title: "QA", position: 1, masterId: "m", version: 2, durationMs: 100000, previewStartMs: 0, previewDurationMs: 59950,
  sourceFormat: "WAV" as "WAV" | "MP3", sourceSha256: "a".repeat(64),
  wavSha256: "a".repeat(64), mp3Sha256: "b".repeat(64), previewSha256: "c".repeat(64), bindingHash: "d".repeat(64) };
const project = { id: "p", slug: "qa", title: "Projet QA", tracks: [track] };
test("manifest keeps exact track/master/version and the three separate audio fingerprints", () => {
  const manifest = technicalReviewManifest(project), row = manifest.tracks[0];
  assert.equal(row.trackId, "t"); assert.equal(row.masterId, "m"); assert.equal(row.version, 2);
  assert.equal(row.wavSha256, track.wavSha256); assert.equal(row.mp3Sha256, track.mp3Sha256); assert.equal(row.previewSha256, track.previewSha256);
  assert.equal(manifest.grantsRights, false); assert.equal(manifest.validatesListening, false); assert.equal(manifest.activatesOffers, false);
  assert.match(manifest.checksumSource, /NOT_A_FRESH_REMOTE_OBJECT_HASH/);
});
test("manifest projects no secret, private proof, storage locator, price or customer field", () => {
  const input = { ...project, secret: "sensitive", evidenceReferences: "private", customerEmail: "private", tracks: [{ ...track, storageKey: "private/path", signedUrl: "secret", priceCents: 999 }] };
  const text = JSON.stringify(technicalReviewManifest(input));
  for (const forbidden of ["sensitive", "private/path", "customerEmail", "signedUrl", "evidenceReferences", "priceCents"]) assert(!text.includes(forbidden));
});
test("stable order does not mutate the input and absent single masters remain absent", () => {
  const input = Object.freeze({ ...project, tracks: Object.freeze([{ ...track, id: "late", position: 2 }, { ...track, masterId: null, version: null, wavSha256: null }]) });
  const before = JSON.stringify(input), result = technicalReviewManifest(input as unknown as typeof project);
  assert.equal(result.tracks[0].masterId, null); assert.equal(result.tracks[0].wavSha256, null); assert.equal(JSON.stringify(input), before);
});
test("different exact masters or excerpts change the technical manifest", () => {
  const original = JSON.stringify(technicalReviewManifest(project));
  for (const patch of [{ masterId: "other" }, { version: 3 }, { previewSha256: "f".repeat(64) }, { previewStartMs: 7800 }])
    assert.notEqual(JSON.stringify(technicalReviewManifest({ ...project, tracks: [{ ...track, ...patch }] })), original);
});
test("MP3-only draft is identified as a lossy source, not a WAV original", () => {
  const manifest = technicalReviewManifest({ ...project, tracks: [{ ...track, sourceFormat: "MP3", wavSha256: null, mp3Sha256: null, previewSha256: null, bindingHash: null }] });
  assert.equal(manifest.tracks[0].sourceFormat, "MP3"); assert.equal(manifest.tracks[0].wavSha256, null);
  assert.equal(manifest.tracks[0].sourceSha256, track.sourceSha256); assert.equal(manifest.activatesOffers, false);
  const service = readFileSync("lib/digital/group-review-service.ts", "utf8");
  assert.match(service, /wavSha256: m\?\.codec === "wav" \? m.masterAsset.checksumSha256 : null/);
});
test("private document SHA is calculated from raw bytes without a provider request", async () => {
  const bytes = new TextEncoder().encode("QA document\n").buffer;
  const expected = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
  assert.equal(await browserSha256(bytes), expected);
  assert.deepEqual(await privateEvidenceFingerprint({ size: bytes.byteLength, arrayBuffer: async () => bytes }), { sha256: expected, reference: `private-evidence:dcn-evidence/${expected}` });
});
test("empty/oversized documents fail before reading, and changed sizes fail closed", async () => {
  for (const size of [0, -1, PRIVATE_EVIDENCE_MAX_BYTES + 1, NaN]) {
    let read = false; await assert.rejects(privateEvidenceFingerprint({ size, arrayBuffer: async () => { read = true; return new ArrayBuffer(1); } })); assert.equal(read, false);
  }
  await assert.rejects(privateEvidenceFingerprint({ size: 3, arrayBuffer: async () => new ArrayBuffer(2) }));
});
test("document read failure does not create a fake fingerprint", async () => {
  await assert.rejects(privateEvidenceFingerprint({ size: 4, arrayBuffer: async () => { throw new Error("unavailable"); } }));
});
test("UI retains human attestation, pending-request keys, stale read guards and separate commercial decision", () => {
  const rights = readFileSync("components/digital-rights-review.tsx", "utf8"), group = readFileSync("components/music-group-review.tsx", "utf8");
  assert.match(rights, /generation !== fingerprintGeneration.current/); assert.match(rights, /setAttested\(false\)/);
  assert.match(rights, /expectedReviews: selected.map/); assert.match(rights, /idempotencyKey: key/);
  assert.match(rights, /status === "APPROVED" && \(!sha \|\| !reference \|\| !attested\)/);
  assert.match(group, /selection\?\.status !== "VALIDATED"/); assert.match(group, /Décision commerciale distincte/);
  assert.match(group, /expectedBindings:/); assert.match(group, /pending.current/);
});
test("read-only service exposes the saved price and real MP3 draft without a fake WAV or review transfer", async () => {
  process.env.DCN_ENABLED = "true"; process.env.DCN_MODE = "TEST"; process.env.DCN_GROUP_REVIEW_ENABLED = "true";
  const { loadGroupReview } = await import("../../lib/digital/group-review-service");
  const id = "11111111-1111-4111-8111-111111111111", actor = { id, role: "ADMIN", status: "ACTIVE", emailVerified: true } as OrderActor;
  const source = { id: "source", durationMs: 104420, checksumSha256: "a".repeat(64), mimeType: "audio/mpeg", visibility: "PRIVATE" };
  const p = { id, title: "Single QA", slug: "single-qa", type: "SINGLE", credits: [], assets: [], digitalOffers: [{ scope: "TRACK", trackId: id, priceCents: 157, active: false }],
    tracks: [{ id, title: "Titre QA", position: 1, credits: [], digitalMasters: [{ id: "master-qa", version: 1, codec: "mp3", status: "QUARANTINED", masterAsset: source, mp3Asset: null, previewAsset: null, previewStartMs: 0, previewDurationMs: null }] }] };
  const before = JSON.stringify(p), db = { user: { findUnique: async () => actor }, project: { findUnique: async () => p, findUniqueOrThrow: async () => p }, digitalEvent: { findFirst: async () => null } } as unknown as Prisma.TransactionClient;
  const result = await loadGroupReview(actor, id, db), t = result.tracks[0];
  assert.equal(t.priceCents, 157); assert.equal(t.offerActive, false); assert.equal(t.sourceFormat, "MP3");
  assert.equal(t.sourceSha256, source.checksumSha256); assert.equal(t.wavSha256, null); assert.equal(t.mp3Sha256, null);
  assert.equal(t.ready, false); assert.equal(t.previewUrl, null); assert.equal(t.selection, null); assert.equal(t.bindingHash, null);
  assert.equal(t.listened, false); assert.notEqual(t.review?.status, "APPROVED"); assert.equal(JSON.stringify(p), before);
});
