import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import { selections, saveOffer } from "@/lib/digital/catalog";
import { digitalSalesReadiness } from "@/lib/digital/admin";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";

/** Catalogue repository doubles only: no real album import, DB or provider call. */
function fixture(scope: "ALBUM" | "TRACK" = "ALBUM") {
  const id = randomUUID(), projectId = randomUUID();
  const tracks = Array.from({ length: 12 }, (_, index) => {
    const trackId = randomUUID(), wavId = randomUUID(), previewId = randomUUID();
    const mp3Id: string = randomUUID(); // Mutable negative fixture, not a production UUID type relaxation.
    const asset = (assetId: string, mimeType: string, visibility = "PRIVATE") => ({ id: assetId, visibility, rightsStatus: "CLEARED", mimeType, checksumSha256: "a".repeat(64), durationMs: 120_000, sizeBytes: 400_000n });
    return { id: trackId, title: `Synthetic title ${index + 1}`, status: "RELEASED", position: index + 1,
      digitalMasters: [{ id: randomUUID(), masterAssetId: wavId, mp3AssetId: mp3Id, previewAssetId: previewId, status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION, mp3BitrateKbps: 320,
        masterAsset: asset(wavId, "audio/wav"), mp3Asset: { ...asset(mp3Id, "audio/mpeg"), durationMs: 120_040 },
        previewAsset: { ...asset(previewId, "audio/mpeg", "PUBLIC"), durationMs: 59_900 }, previewDurationMs: 59_900 }] };
  });
  const offer = { id, scope, trackId: scope === "TRACK" ? tracks[0].id : null, active: true, rightsConfirmed: true, priceCents: scope === "ALBUM" ? 990 : 129,
    version: 2, distribution: "UNRELEASED", project: { id: projectId, title: "Synthetic unreleased album", type: scope === "ALBUM" ? "ALBUM" : "SINGLE", status: "PUBLISHED", publicVisible: true, tracks } };
  let query: unknown;
  const db = { digitalOffer: { async findMany(input: unknown) { query = input; return [offer]; } } } as unknown as Prisma.TransactionClient;
  return { id, db, offer, tracks, query: () => query };
}

test("Admin preparation: unreleased 12-track album is sellable without a platform link or individual offers", async () => {
  const f = fixture(), chosen = (await selections([f.id], f.db))[0];
  assert.equal(chosen.scope, "ALBUM"); assert.equal(chosen.priceCents, 990); assert.equal(chosen.tracks.length, 12);
  assert.deepEqual(chosen.tracks.map(t => t.position), Array.from({ length: 12 }, (_, i) => i + 1));
  for (const [i, track] of chosen.tracks.entries()) {
    assert.deepEqual(track.formats, ["WAV", "MP3"]);
    assert.equal(track.wavAssetId, f.tracks[i].digitalMasters[0].masterAssetId);
    assert.equal(track.mp3AssetId, f.tracks[i].digitalMasters[0].mp3AssetId);
  }
  assert.deepEqual((f.query() as { include: { project: { include: { tracks: { where: unknown } } } } }).include.project.include.tracks.where, { status: "RELEASED" });
});

test("Admin preparation: single retains its independent price and only its own pinned edition", async () => {
  const f = fixture("TRACK"), chosen = (await selections([f.id], f.db))[0];
  assert.equal(chosen.priceCents, 129); assert.equal(chosen.tracks.length, 1); assert.equal(chosen.tracks[0].trackId, f.tracks[0].id);
});

test("Admin preparation: album fails closed when any included file, rights or excerpt is incomplete", async () => {
  const variants = ["missingMp3", "publicWav", "pendingRights", "missingChecksum", "longExcerpt", "missingMaster", "oldEncoder", "truncatedProof", "durationMismatch", "newInvalidTrack"] as const;
  for (const variant of variants) {
    const f = fixture(), master = f.tracks[11].digitalMasters[0];
    if (variant === "missingMp3") master.mp3AssetId = "";
    if (variant === "publicWav") master.masterAsset.visibility = "PUBLIC";
    if (variant === "pendingRights") master.masterAsset.rightsStatus = "PENDING";
    if (variant === "missingChecksum") master.mp3Asset.checksumSha256 = "";
    if (variant === "longExcerpt") master.previewDurationMs = 60_001;
    if (variant === "missingMaster") f.tracks[11].digitalMasters = [];
    if (variant === "oldEncoder") master.encoderVersion = "ffmpeg-libmp3lame-cbr-v1";
    if (variant === "truncatedProof") master.masterAsset.sizeBytes = 0n;
    if (variant === "durationMismatch") master.mp3Asset.durationMs += 101;
    if (variant === "newInvalidTrack") f.tracks.push({ ...f.tracks[0], id: randomUUID(), position: 13, digitalMasters: [] });
    await assert.rejects(() => selections([f.id], f.db), { code: "NO_READY_MASTER" }, variant);
  }
});

test("Admin saveOffer service: strict audio metadata is required before any offer, rights or audit write", async () => {
  const previous = { DCN_ENABLED: process.env.DCN_ENABLED, DCN_MODE: process.env.DCN_MODE, RAILWAY_ENVIRONMENT_NAME: process.env.RAILWAY_ENVIRONMENT_NAME,
    MEDIA_DEPLOYMENT_ENV: process.env.MEDIA_DEPLOYMENT_ENV, PAYMENT_DEPLOYMENT_ENV: process.env.PAYMENT_DEPLOYMENT_ENV };
  const original = prisma.$transaction;
  const actor: OrderActor = { id: randomUUID(), email: "qa@example.invalid", name: "Synthetic Admin", role: "ADMIN", status: "ACTIVE", emailVerified: true };
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST" });
  delete process.env.RAILWAY_ENVIRONMENT_NAME; delete process.env.MEDIA_DEPLOYMENT_ENV; delete process.env.PAYMENT_DEPLOYMENT_ENV;
  try {
    for (const variant of ["oldEncoder", "truncatedProof", "durationMismatch", "newInvalidTrack", "hiddenProject", "draftProject", "valid", "inactiveDraft"] as const) {
      const f = fixture(), master = f.tracks[11].digitalMasters[0], writes: string[] = [];
      if (variant === "oldEncoder") master.encoderVersion = "ffmpeg-libmp3lame-cbr-v1";
      if (variant === "truncatedProof") master.mp3Asset.checksumSha256 = "a".repeat(63);
      if (variant === "durationMismatch") master.mp3Asset.durationMs += 101;
      if (variant === "newInvalidTrack") f.tracks.push({ ...f.tracks[0], id: randomUUID(), position: 13, digitalMasters: [] });
      if (variant === "hiddenProject") f.offer.project.publicVisible = false;
      if (variant === "draftProject" || variant === "inactiveDraft") f.offer.project.status = "DRAFT";
      if (variant === "inactiveDraft") for (const track of f.tracks) track.digitalMasters = [];
      const tx = {
        $queryRaw: async () => [],
        project: { async findUnique() { return f.offer.project; } },
        track: { async findFirst() { return null; } },
        digitalOffer: { async findFirst() { return null; }, async create({ data }: { data: Record<string, unknown> }) { writes.push("offer"); return { ...data, id: f.id }; } },
        digitalMaster: { async findMany() { return f.tracks.flatMap(track => track.digitalMasters); } },
        asset: { async updateMany() { writes.push("rights"); return { count: 1 }; } },
        digitalEvent: { async create() { writes.push("audit"); return {}; } },
      } as unknown as Prisma.TransactionClient;
      prisma.$transaction = (async (callback: (db: Prisma.TransactionClient) => Promise<unknown>) => callback(tx)) as unknown as typeof original;
      const run = () => saveOffer(actor, { projectId: f.offer.project.id, trackId: null, priceCents: variant === "inactiveDraft" ? null : 990,
        active: variant !== "inactiveDraft", rightsConfirmed: variant !== "inactiveDraft", expectedVersion: 0, distribution: "UNRELEASED" });
      if (variant === "valid") {
        assert.equal(await run(), f.id); assert.deepEqual(writes, ["offer", "rights", "audit"]); assert.equal(f.tracks.length, 12);
      } else if (variant === "inactiveDraft") {
        assert.equal(await run(), f.id); assert.deepEqual(writes, ["offer", "audit"]);
      } else {
        await assert.rejects(run, { code: "NO_READY_MASTER" }, variant); assert.deepEqual(writes, [], variant);
      }
    }
  } finally {
    prisma.$transaction = original;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("Admin preparation: readiness never grants sale for a hidden project, absent price or unaffirmed rights", () => {
  const project = { status: "PUBLISHED", publicVisible: true }, offer = { active: true, rightsConfirmed: true, priceCents: 129 };
  const tracks = [{ id: randomUUID(), title: "Synthetic title", publication: "RELEASED", masterReady: true, mediaCleared: true, previewDurationMs: 59_900, offer }];
  assert.equal(digitalSalesReadiness(project, tracks, { ...offer, priceCents: 990 }).albumReady, true);
  for (const invalid of [{ ...offer, priceCents: null }, { ...offer, rightsConfirmed: false }, { ...offer, active: false }]) assert.equal(digitalSalesReadiness(project, tracks, invalid).albumReady, false);
  assert.equal(digitalSalesReadiness({ ...project, publicVisible: false }, tracks, offer).albumReady, false);
});
