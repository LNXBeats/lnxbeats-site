import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { publicDigitalProject } from "@/lib/digital/catalog";
import { publicDigitalProjects } from "@/lib/digital/public-catalog";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { DIGITAL_RIGHTS_ATTESTATION, DIGITAL_RIGHTS_REVIEW_EVENT, DIGITAL_RIGHTS_REVIEW_POLICY,
  digitalRightsMasterBinding, digitalRightsReviewHash } from "@/lib/digital/rights-review-policy";
import { syntheticExistingExcerptApproval } from "./fixtures/excerpt-approval";

function fixture(count = 3) {
  const reviewer = { id: randomUUID(), role: "ADMIN", status: "ACTIVE", emailVerified: true };
  const tracks = Array.from({ length: count }, (_, index) => {
    const id = randomUUID();
    const asset = (mimeType: string, visibility: string, durationMs: number) => ({ id: randomUUID(), type: "AUDIO_PREVIEW", mimeType,
      visibility, durationMs, sizeBytes: 400_000n, checksumSha256: "a".repeat(64), rightsStatus: "CLEARED",
      storageKey: "private-not-for-the-browser/original", storageBackend: "OBJECT", storageProvider: "r2" });
    const wav = asset("audio/wav", "PRIVATE", 120_000), mp3 = asset("audio/mpeg", "PRIVATE", 120_000), preview = asset("audio/mpeg", "PUBLIC", 59_900);
    const master = { id: randomUUID(), trackId: id, version: 1, status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION,
      mp3BitrateKbps: 320, masterAssetId: wav.id, mp3AssetId: mp3.id as string | null, previewAssetId: preview.id,
      masterAsset: wav, mp3Asset: mp3 as typeof mp3 | null, previewAsset: preview, previewStartMs: 0, previewDurationMs: 59_900 };
    return { id, title: `Synthetic ${index}`, position: index + 1, status: "RELEASED", durationSeconds: 120, digitalMasters: [master] };
  });
  const project = { id: randomUUID(), slug: "synthetic", title: "Synthetic album", publicVisible: true, status: "PUBLISHED", type: "ALBUM",
    membersPreviewEnabled: false, tracks, digitalOffers: [] as Array<{ id: string; scope: "ALBUM" | "TRACK"; trackId: string | null;
      active: boolean; rightsConfirmed: boolean; priceCents: number | null; version: number }> };
  project.digitalOffers = [{ id: randomUUID(), scope: "ALBUM", trackId: null, active: true, rightsConfirmed: true, priceCents: 990, version: 1 },
    ...tracks.map(track => ({ id: randomUUID(), scope: "TRACK" as const, trackId: track.id, active: true, rightsConfirmed: true, priceCents: 129, version: 1 }))];
  const rights = new Map<string, ReturnType<typeof rightsEvent>>();
  const artistic = new Map(tracks.map(track => {
    const master = track.digitalMasters[0];
    rights.set(master.id, rightsEvent(master));
    return [master.id, syntheticExistingExcerptApproval(master, reviewer.id)];
  }));
  function rightsEvent(master: typeof tracks[number]["digitalMasters"][number], status = "APPROVED") {
    const createdAt = new Date("2026-10-16T10:00:00Z"), proof = { policy: DIGITAL_RIGHTS_REVIEW_POLICY,
      binding: digitalRightsMasterBinding(master), status, attestation: DIGITAL_RIGHTS_ATTESTATION,
      privateEvidenceReference: "private-evidence:synthetic/comparison", evidenceSha256: "b".repeat(64), reason: null,
      reviewedAt: createdAt.toISOString(), requestHash: "c".repeat(64) };
    return { id: randomUUID(), actorId: reviewer.id, kind: DIGITAL_RIGHTS_REVIEW_EVENT, createdAt,
      details: { ...proof, recordHash: digitalRightsReviewHash({ actorId: reviewer.id, ...proof }) }, masterId: master.id };
  }
  let reads = 0;
  const db = {
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      reads++;
      const sql = parts.join("?");
      if (sql.includes("dcn-public-catalogue-latest-proofs")) return [...rights.values(), ...artistic.values()];
      if (sql.includes("dcn-excerpt-current-masters")) return tracks.filter(track => (values[0] as string[]).includes(track.id))
        .map(track => ({ id: track.digitalMasters[0].id, trackId: track.id }));
      if (sql.includes("dcn-excerpt-latest-artistic-events")) return [...artistic.values()].filter(event => (values[1] as string[]).includes(event.masterId));
      return [];
    },
    project: {
      async findMany() { reads++; return [project]; },
      async findFirst() { reads++; return { ...project, tracks: tracks.filter(track => ["RELEASED", "ANNOUNCED"].includes(track.status)) }; },
    },
    digitalOffer: { async findMany({ where }: { where: { id: { in: string[] } } }) { reads++;
      return project.digitalOffers.filter(offer => where.id.in.includes(offer.id)).map(offer => ({ ...offer, project })); } },
    digitalMaster: { async findMany({ where }: { where: { id: { in: string[] } } }) { reads++;
      return tracks.flatMap(track => track.digitalMasters).filter(master => where.id.in.includes(master.id)); } },
    digitalEvent: { async findFirst({ where }: { where: { details: { equals: string } } }) { reads++; return rights.get(where.details.equals) ?? null; } },
    user: { async findMany() { reads++; return [reviewer]; }, async findUnique() { reads++; return reviewer; } },
    asset: { async findMany() { reads++; return []; } },
  };
  return { project, tracks, rights, artistic, reviewer, db: db as unknown as Prisma.TransactionClient, rightsEvent,
    reads: () => reads, resetReads: () => { reads = 0; } };
}

async function legacy(f: ReturnType<typeof fixture>) {
  const reset: Array<() => void> = [];
  for (const name of ["project", "digitalOffer", "digitalMaster", "digitalEvent", "user", "asset"] as const) {
    for (const [key, value] of Object.entries(f.db[name])) {
      const target = prisma[name] as unknown as Record<string, unknown>, original = target[key];
      target[key] = value; reset.push(() => { target[key] = original; });
    }
  }
  const originalRaw = prisma.$queryRaw; prisma.$queryRaw = f.db.$queryRaw;
  try { return await publicDigitalProject("synthetic"); }
  finally { prisma.$queryRaw = originalRaw; reset.reverse().forEach(fn => fn()); }
}

test("public catalogue batch: anonymous output equals the existing exact gate and contains no private references", async () => {
  const f = fixture(), old = await legacy(f), before = f.reads(); f.resetReads();
  const current = (await publicDigitalProjects(["synthetic"], f.db)).get("synthetic");
  assert.deepEqual(current, old); assert.equal(f.reads(), 3); assert.ok(before > 40);
  assert.doesNotMatch(JSON.stringify(current), /private-not-for-the-browser|storageKey|private-evidence|actorId|recordHash/);
});

test("public catalogue batch: 30-track album retains a constant three repository reads, without pool fan-out", async () => {
  const f = fixture(30);
  const view = (await publicDigitalProjects(["synthetic", "synthetic"], f.db)).get("synthetic");
  assert.equal(f.reads(), 3); assert.equal(view?.album?.trackCount, 30);
  assert.equal(view?.tracks.filter(track => track.offer).length, 30);
});

test("public catalogue batch: missing/revoked proofs, changed hashes, reviewer and media gates match legacy", async () => {
  for (const change of ["rights", "revoke", "artistic", "hash", "reviewer", "privatePreview", "missingMp3", "unlisted", "inactive", "unconfirmed", "noPrice"]) {
    const f = fixture(), master = f.tracks[0].digitalMasters[0];
    if (change === "rights") f.rights.delete(master.id);
    if (change === "revoke") f.rights.set(master.id, f.rightsEvent(master, "REVOKED"));
    if (change === "artistic") f.artistic.delete(master.id);
    if (change === "hash") master.masterAsset.checksumSha256 = "f".repeat(64);
    if (change === "reviewer") f.reviewer.status = "SUSPENDED";
    if (change === "privatePreview") master.previewAsset.visibility = "PRIVATE";
    if (change === "missingMp3") { master.mp3Asset = null; master.mp3AssetId = null; }
    if (change === "unlisted") f.tracks[0].status = "UNLISTED";
    if (change === "inactive") f.project.digitalOffers[0].active = false;
    if (change === "unconfirmed") f.project.digitalOffers[0].rightsConfirmed = false;
    if (change === "noPrice") f.project.digitalOffers[0].priceCents = null;
    assert.deepEqual((await publicDigitalProjects(["synthetic"], f.db)).get("synthetic"), await legacy(f), change);
  }
});

test("public catalogue batch: one blocked master blocks the whole album, not independent valid tracks", async () => {
  const f = fixture(); f.artistic.delete(f.tracks[0].digitalMasters[0].id);
  const view = (await publicDigitalProjects(["synthetic"], f.db)).get("synthetic");
  assert.equal(view?.album, null); assert.equal(view?.tracks[0].offer, null); assert.equal(view?.tracks[0].previewUrl, null);
  assert.equal(view?.tracks.filter(track => track.offer).length, 2);
});

test("public catalogue batch: free previews do not activate offers and member-only previews do not leak", async () => {
  const f = fixture(); f.project.digitalOffers.forEach(offer => { offer.active = false; });
  let view = (await publicDigitalProjects(["synthetic"], f.db)).get("synthetic");
  assert.ok(view?.tracks.every(track => track.previewUrl && !track.offer)); assert.equal(view?.album, null);
  f.project.membersPreviewEnabled = true;
  assert.equal((await publicDigitalProjects(["synthetic"], f.db)).get("synthetic"), null);
  f.project.digitalOffers[0].active = true;
  view = (await publicDigitalProjects(["synthetic"], f.db)).get("synthetic");
  assert.ok(view?.album); assert.ok(view?.tracks.every(track => track.previewUrl === null));
});

test("public catalogue batch: every call re-reads revocations; empty catalogues make no query", async () => {
  const f = fixture(1);
  assert.ok((await publicDigitalProjects(["synthetic"], f.db)).get("synthetic")?.album);
  f.rights.set(f.tracks[0].digitalMasters[0].id, f.rightsEvent(f.tracks[0].digitalMasters[0], "REVOKED"));
  assert.equal((await publicDigitalProjects(["synthetic"], f.db)).get("synthetic"), null);
  f.resetReads(); assert.equal((await publicDigitalProjects([], f.db)).size, 0); assert.equal(f.reads(), 0);
});

test("public catalogue batch: infrastructure failures propagate rather than invent an authorization", async () => {
  const f = fixture(); f.db.$queryRaw = (async () => { throw new Error("synthetic unavailable"); }) as typeof f.db.$queryRaw;
  await assert.rejects(publicDigitalProjects(["synthetic"], f.db), /synthetic unavailable/);
});
