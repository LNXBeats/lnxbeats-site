import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";
import { selections } from "@/lib/digital/catalog";
import { assertDigitalExcerptApprovals } from "@/lib/digital/excerpt-commerce";
import { digitalErrorMessage } from "@/lib/digital/error-presentation";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { DIGITAL_EXCERPT_EVENT, digitalExcerptHash, type DigitalExcerptDetails, type DigitalExcerptEvent } from "@/lib/digital/excerpt-policy";
import { recordDigitalExcerptSelection } from "@/lib/digital/excerpt-service";
import { DIGITAL_RIGHTS_REVIEW_EVENT, DIGITAL_RIGHTS_REVIEW_POLICY, DIGITAL_RIGHTS_ATTESTATION, digitalRightsMasterBinding, digitalRightsReviewHash } from "@/lib/digital/rights-review-policy";
import { syntheticExistingExcerptApproval } from "./fixtures/excerpt-approval";

/** All approvals, actors and persistence below are explicit in-memory doubles.
 * No artistic approval is performed in QA, no file/DB/network/provider is touched.
 */
function fixture(scope: "TRACK" | "ALBUM" = "TRACK", count = 12) {
  const projectId = "e62bfcea-6d0c-4a9c-8de9-eee8961c30d7", offerId = randomUUID();
  const reviewer = { id: randomUUID(), role: "ADMIN", status: "ACTIVE", emailVerified: true };
  const actor: OrderActor = { ...reviewer, role: "ADMIN", status: "ACTIVE", emailVerified: true, email: "synthetic-artist@example.invalid", name: "Synthetic reviewer" };
  const makeMaster = (position: number) => {
    const id = randomUUID(), trackId = randomUUID(), wavId = randomUUID(), mp3Id = randomUUID(), previewId = randomUUID();
    const asset = (assetId: string, mimeType: string, visibility = "PRIVATE", durationMs = 120_000) => ({ id: assetId,
      type: mimeType === "audio/wav" ? "AUDIO" : "AUDIO_PREVIEW", mimeType, visibility, durationMs, sizeBytes: 400_000n, rightsStatus: "CLEARED", checksumSha256: "a".repeat(64) });
    return { id, trackId, version: 1, status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION, mp3BitrateKbps: 320,
      masterAssetId: wavId, mp3AssetId: mp3Id, previewAssetId: previewId, previewStartMs: 0, previewDurationMs: 59_950,
      masterAsset: asset(wavId, "audio/wav"), mp3Asset: asset(mp3Id, "audio/mpeg"), previewAsset: asset(previewId, "audio/mpeg", "PUBLIC", 59_950),
      track: { projectId, title: `Synthetic track ${position}` } };
  };
  const masters = Array.from({ length: count }, (_, i) => makeMaster(i + 1));
  const tracks = masters.map((master, i) => ({ id: master.trackId, position: i + 1, title: master.track.title, digitalMasters: [master] }));
  const offer = { id: offerId, scope, trackId: scope === "TRACK" ? tracks[0].id : null, active: true, rightsConfirmed: true, version: 1,
    priceCents: scope === "ALBUM" ? 990 : 129, project: { id: projectId, title: "Synthetic album", status: "PUBLISHED", publicVisible: true, tracks } };
  type Artistic = DigitalExcerptEvent & { masterId: string; externalKey?: string };
  const artistic: Artistic[] = [], rights = new Map<string, ReturnType<typeof approveRights>>(), candidates = new Map<string, ReturnType<typeof makeMaster>["previewAsset"]>();
  const queries: string[] = []; let writes = 0, offerQuery: unknown;
  function approveRights(master: ReturnType<typeof makeMaster>) {
    const at = new Date("2026-10-16T09:00:00.000Z"), proof = { policy: DIGITAL_RIGHTS_REVIEW_POLICY, binding: digitalRightsMasterBinding(master), status: "APPROVED",
      privateEvidenceReference: "private-evidence:synthetic/excerpt-gate-test", evidenceSha256: "b".repeat(64), attestation: DIGITAL_RIGHTS_ATTESTATION,
      reason: null, reviewedAt: at.toISOString(), requestHash: "d".repeat(64) };
    const event = { id: randomUUID(), actorId: reviewer.id, kind: DIGITAL_RIGHTS_REVIEW_EVENT, createdAt: at, details: { ...proof, recordHash: digitalRightsReviewHash({ actorId: reviewer.id, ...proof }) } };
    rights.set(master.id, event); return event;
  }
  masters.forEach(approveRights);
  function latestArt(id: string) { return artistic.filter(event => event.masterId === id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0] ?? null; }
  const current = () => tracks.map(track => [...track.digitalMasters].sort((a, b) => b.version - a.version)[0]);
  const db = {
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      const sql = parts.join("?"); queries.push(sql);
      if (sql.includes("dcn-excerpt-current-masters")) return current().filter(master => (values[0] as string[]).includes(master.trackId)).map(master => ({ id: master.id, trackId: master.trackId }));
      if (sql.includes("dcn-excerpt-latest-artistic-events")) return (values[1] as string[]).flatMap(id => { const event = latestArt(id); return event ? [event] : []; });
      return [];
    },
    digitalOffer: { async findMany(input: unknown) { offerQuery = input; return [{ ...offer, project: { ...offer.project,
      tracks: tracks.map(track => ({ ...track, digitalMasters: [...track.digitalMasters].sort((a, b) => b.version - a.version).slice(0, 1) })) } }]; } },
    digitalMaster: {
      async findMany({ where }: { where: { id: { in: string[] } } }) { return tracks.flatMap(track => track.digitalMasters).filter(master => where.id.in.includes(master.id)); },
      async findUnique({ where }: { where: { id: string } }) { return tracks.flatMap(track => track.digitalMasters).find(master => master.id === where.id) ?? null; },
      async findFirst({ where }: { where: { trackId: string } }) { return current().find(master => master.trackId === where.trackId) ?? null; },
    },
    digitalEvent: {
      async findFirst({ where }: { where: { kind: string; details: { equals: string } } }) { return where.kind === DIGITAL_RIGHTS_REVIEW_EVENT ? rights.get(where.details.equals) ?? null : latestArt(where.details.equals); },
      async findUnique({ where }: { where: { externalKey: string } }) { return artistic.find(event => event.externalKey === where.externalKey) ?? null; },
      async create({ data }: { data: Omit<Artistic, "id" | "masterId"> }) { writes++; const event = { ...data, id: randomUUID(), masterId: (data.details as DigitalExcerptDetails).binding.masterId }; artistic.push(event); return event; },
    },
    user: { async findUnique() { return reviewer; }, async findMany() { return [reviewer]; } },
    asset: { async findMany({ where }: { where: { id: { in: string[] } } }) { return [...candidates.values()].filter(candidate => where.id.in.includes(candidate.id)); } },
  } as unknown as Prisma.TransactionClient;
  const approve = (master = masters[0]) => { const event = syntheticExistingExcerptApproval(master, reviewer.id); artistic.push(event); return event; };
  return { db, actor, reviewer, masters, tracks, offer, artistic, candidates, approve, approveRights, queries, offerQuery: () => offerQuery, writes: () => writes };
}

test("commercial excerpt gate: direct active track with cleared rights still refuses missing artistic approval", async () => {
  const f = fixture(); await assert.rejects(() => selections([f.offer.id], f.db), { code: "EXCERPT_ARTISTIC_VALIDATION_REQUIRED" }); assert.equal(f.writes(), 0);
});
test("commercial excerpt gate: album refuses one unvalidated included track without falling back", async () => {
  const f = fixture("ALBUM"); f.masters.slice(0, 11).forEach(master => f.approve(master));
  await assert.rejects(() => selections([f.offer.id], f.db), { code: "EXCERPT_ARTISTIC_VALIDATION_REQUIRED" }); assert.equal(f.writes(), 0);
});
test("commercial excerpt gate: track approval does not require unrelated unpurchased tracks", async () => {
  const f = fixture(); f.approve(); const selected = await selections([f.offer.id], f.db);
  assert.equal(selected[0].tracks.length, 1); assert.equal(selected[0].priceCents, 129); assert.equal(f.writes(), 0);
});
test("commercial excerpt gate: twelve explicit synthetic approvals pass with constant-count batch queries", async () => {
  const f = fixture("ALBUM"); f.masters.forEach(master => f.approve(master));
  assert.equal((await selections([f.offer.id], f.db))[0].tracks.length, 12);
  for (const marker of ["dcn-excerpt-lock-tracks", "dcn-excerpt-lock-selections", "dcn-excerpt-current-masters", "dcn-excerpt-latest-artistic-events"])
    assert.equal(f.queries.filter(query => query.includes(marker)).length, 1, marker);
  const query = f.offerQuery() as { include: { project: { include: { tracks: { include: { digitalMasters: { where?: unknown } } } } } } };
  assert.equal(query.include.project.include.tracks.include.digitalMasters.where, undefined); assert.equal(f.writes(), 0);
});
test("commercial excerpt gate: a newer quarantined or failed master never sells an old validated edition by default", async () => {
  for (const status of ["QUARANTINED", "FAILED"]) {
    const f = fixture(); f.approve(); f.tracks[0].digitalMasters.push({ ...f.masters[0], id: randomUUID(), version: 2, status });
    await assert.rejects(() => selections([f.offer.id], f.db), { code: "NO_READY_MASTER" }); assert.equal(f.writes(), 0);
  }
});
test("commercial excerpt gate: a replacement READY master with new rights cannot inherit an older artistic approval", async () => {
  const f = fixture(); f.approve(); const replacement = { ...f.masters[0], id: randomUUID(), version: 2 }; f.tracks[0].digitalMasters.push(replacement); f.approveRights(replacement);
  await assert.rejects(() => selections([f.offer.id], f.db), { code: "EXCERPT_ARTISTIC_VALIDATION_REQUIRED" }); assert.equal(f.writes(), 0);
});
test("commercial excerpt gate: freshly reapproved rights do not approve an old source SHA or a changed preview", async () => {
  for (const kind of ["source", "preview"]) {
    const f = fixture(); f.approve(); const master = f.masters[0];
    if (kind === "source") master.masterAsset.checksumSha256 = "e".repeat(64); else master.previewAsset.checksumSha256 = "e".repeat(64);
    f.approveRights(master); await assert.rejects(() => selections([f.offer.id], f.db), { code: "EXCERPT_ARTISTIC_VALIDATION_REQUIRED" }); assert.equal(f.writes(), 0);
  }
});
test("commercial excerpt gate: latest draft supersedes approval; a VALIDATED label alone, false attestation or inactive reviewer is insufficient", async () => {
  for (const variant of ["draft", "falseAttestation", "wrongHash", "inactiveReviewer"]) {
    const f = fixture(), approved = f.approve();
    if (variant === "inactiveReviewer") f.reviewer.status = "SUSPENDED";
    else {
      const details = structuredClone(approved.details) as DigitalExcerptDetails;
      if (variant === "draft") Object.assign(details, { status: "DRAFT", candidateAssetId: null, candidateSha256: null, previewDurationMs: null, attested: false, candidateOrigin: undefined });
      if (variant === "falseAttestation") details.attested = false;
      if (variant === "wrongHash") details.candidateSha256 = "f".repeat(64);
      const { recordHash: previousHash, ...proof } = details; void previousHash;
      f.artistic.push({ ...approved, id: randomUUID(), createdAt: new Date(approved.createdAt.getTime() + 1), details: { ...proof, recordHash: digitalExcerptHash({ actorId: approved.actorId, ...proof }) } });
    }
    await assert.rejects(() => assertDigitalExcerptApprovals(f.db, [f.masters[0]]), { code: "EXCERPT_ARTISTIC_VALIDATION_REQUIRED" }); assert.equal(f.writes(), 0);
  }
});
test("commercial excerpt gate: validated private candidate must be native-ready and identical to the actually served preview", async () => {
  for (const variant of ["valid", "missing", "differentAudio", "publicCandidate"]) {
    const f = fixture(), approved = f.approve(), candidate = { ...f.masters[0].previewAsset, id: randomUUID(), visibility: variant === "publicCandidate" ? "PUBLIC" : "PRIVATE" };
    const { recordHash: previousHash, candidateOrigin: originalOrigin, ...proof } = approved.details as DigitalExcerptDetails; void previousHash; void originalOrigin;
    const changed = { ...proof, candidateAssetId: candidate.id, candidateSha256: variant === "differentAudio" ? "e".repeat(64) : candidate.checksumSha256 };
    approved.details = { ...changed, recordHash: digitalExcerptHash({ actorId: approved.actorId, ...changed }) };
    if (variant !== "missing") f.candidates.set(candidate.id, candidate);
    if (variant === "valid") await assertDigitalExcerptApprovals(f.db, [f.masters[0]]);
    else await assert.rejects(() => assertDigitalExcerptApprovals(f.db, [f.masters[0]]), { code: "EXCERPT_ARTISTIC_VALIDATION_REQUIRED" });
    assert.equal(f.writes(), 0);
  }
});
test("commercial excerpt gate: empty cart makes no artistic repository query", async () => {
  const f = fixture(); await assertDigitalExcerptApprovals(f.db, []); assert.equal(f.queries.length, 0); assert.equal(f.writes(), 0);
});
test("commercial excerpt gate: normal human-action service keeps validation idempotent in explicit in-memory doubles", async () => {
  const f = fixture(), saved = { ...process.env }, original = prisma.$transaction;
  try {
    Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_STORAGE_MODE: "LOCAL", DCN_RECOVERY_EXCERPTS_REVIEW_ONLY: "true" });
    for (const name of ["RAILWAY_ENVIRONMENT_NAME", "MEDIA_DEPLOYMENT_ENV", "PAYMENT_DEPLOYMENT_ENV"]) delete process.env[name];
    prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(f.db)) as unknown as typeof original;
    const input = { action: "validate-existing", startMs: 0, attested: true, expectedRevisionId: null, idempotencyKey: randomUUID() };
    const first = await recordDigitalExcerptSelection(f.actor, f.masters[0].id, input);
    assert.deepEqual(await recordDigitalExcerptSelection(f.actor, f.masters[0].id, input), first); assert.equal(f.writes(), 1);
    assert.equal(first.selection.status, "VALIDATED"); await assertDigitalExcerptApprovals(f.db, [f.masters[0]]); assert.equal(f.writes(), 1);
    assert.equal(f.artistic[0].kind, DIGITAL_EXCERPT_EVENT);
  } finally { prisma.$transaction = original; for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
});
test("commercial excerpt gate: public message explains missing approval without exposing proofs or revoking purchases", () => {
  const message = digitalErrorMessage("EXCERPT_ARTISTIC_VALIDATION_REQUIRED"); assert.match(message, /validé personnellement/); assert.match(message, /achats déjà acquis restent inchangés/);
});
