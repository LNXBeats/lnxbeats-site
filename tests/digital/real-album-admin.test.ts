import assert from "node:assert/strict";
import { syntheticExistingExcerptApproval } from "./fixtures/excerpt-approval";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import { selections, saveOffer, publicDigitalProject } from "@/lib/digital/catalog";
import { digitalSalesReadiness } from "@/lib/digital/admin";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";
import { DIGITAL_RIGHTS_ATTESTATION, DIGITAL_RIGHTS_REVIEW_EVENT, DIGITAL_RIGHTS_REVIEW_POLICY, digitalRightsMasterBinding, digitalRightsReviewHash } from "@/lib/digital/rights-review-policy";

function approvedReview(master: Parameters<typeof digitalRightsMasterBinding>[0], actorId: string) {
  const createdAt = new Date("2026-10-15T10:00:00.000Z"), proof = { policy: DIGITAL_RIGHTS_REVIEW_POLICY, binding: digitalRightsMasterBinding(master), status: "APPROVED",
    privateEvidenceReference: "private-evidence:synthetic/manifest", evidenceSha256: "b".repeat(64), attestation: DIGITAL_RIGHTS_ATTESTATION, reason: null,
    reviewedAt: createdAt.toISOString(), requestHash: "c".repeat(64) };
  return { id: randomUUID(), actorId, kind: DIGITAL_RIGHTS_REVIEW_EVENT, createdAt, details: { ...proof, recordHash: digitalRightsReviewHash({ actorId, ...proof }) } };
}

/** Catalogue repository doubles only: no real album import, DB or provider call. */
function fixture(scope: "ALBUM" | "TRACK" = "ALBUM") {
  const id = randomUUID(), projectId = randomUUID();
  const tracks = Array.from({ length: 12 }, (_, index) => {
    const trackId = randomUUID(), wavId = randomUUID(), previewId = randomUUID();
    const mp3Id: string = randomUUID(); // Mutable negative fixture, not a production UUID type relaxation.
    const asset = (assetId: string, mimeType: string, visibility = "PRIVATE") => ({ id: assetId, type: mimeType === "audio/wav" ? "AUDIO" : "AUDIO_PREVIEW", visibility, rightsStatus: "CLEARED", mimeType, checksumSha256: "a".repeat(64), durationMs: 120_000, sizeBytes: 400_000n });
    return { id: trackId, title: `Synthetic title ${index + 1}`, status: "RELEASED", position: index + 1,
      digitalMasters: [{ id: randomUUID(), trackId, version: 1, masterAssetId: wavId, mp3AssetId: mp3Id, previewAssetId: previewId, status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION, mp3BitrateKbps: 320, previewStartMs: 0,
        masterAsset: asset(wavId, "audio/wav"), mp3Asset: { ...asset(mp3Id, "audio/mpeg"), durationMs: 120_040 },
        previewAsset: { ...asset(previewId, "audio/mpeg", "PUBLIC"), durationMs: 59_900 }, previewDurationMs: 59_900 }] };
  });
  const offer = { id, scope, trackId: scope === "TRACK" ? tracks[0].id : null, active: true, rightsConfirmed: true, priceCents: scope === "ALBUM" ? 990 : 129,
    version: 2, distribution: "UNRELEASED", project: { id: projectId, title: "Synthetic unreleased album", type: scope === "ALBUM" ? "ALBUM" : "SINGLE", status: "PUBLISHED", publicVisible: true,
      membersPreviewEnabled: false, releaseDate: new Date("2030-01-02T00:00:00.000Z"), tracks } };
  let query: unknown;
  const reviewerId = randomUUID();
  // Explicit immutable synthetic artistic proofs; never approvals on a real catalogue.
  const artistic = tracks.map(track => syntheticExistingExcerptApproval(track.digitalMasters[0], reviewerId));
  const db = { $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => { const sql = parts.join("?");
    if (sql.includes("dcn-excerpt-current-masters")) return tracks.filter(track => (values[0] as string[]).includes(track.id)).map(track => ({ id: track.digitalMasters[0]?.id, trackId: track.id }));
    if (sql.includes("dcn-excerpt-latest-artistic-events")) return artistic.filter(event => (values[1] as string[]).includes(event.masterId));
    return []; }, digitalOffer: { async findMany(input: unknown) { query = input; return [offer]; } },
    digitalMaster: { async findMany({ where }: { where: { id: { in: string[] } } }) { return tracks.flatMap(track => track.digitalMasters).filter(master => where.id.in.includes(master.id)); } },
    digitalEvent: { async findFirst({ where }: { where: { details: { equals: string } } }) { const master = tracks.flatMap(track => track.digitalMasters).find(master => master.id === where.details.equals); return master ? approvedReview(master, reviewerId) : null; } },
    user: { async findUnique() { return { id: reviewerId, role: "ADMIN", status: "ACTIVE", emailVerified: true }; },
      async findMany() { return [{ id: reviewerId, role: "ADMIN", status: "ACTIVE", emailVerified: true }]; } },
  } as unknown as Prisma.TransactionClient;
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
  // Load the whole edition: silently filtering out an announced/missing track would sell a truncated album.
  assert.equal((f.query() as { include: { project: { include: { tracks: { where?: unknown } } } } }).include.project.include.tracks.where, undefined);
});

test("Admin preparation: single retains its independent price and only its own pinned edition", async () => {
  const f = fixture("TRACK"), chosen = (await selections([f.id], f.db))[0];
  assert.equal(chosen.priceCents, 129); assert.equal(chosen.tracks.length, 1); assert.equal(chosen.tracks[0].trackId, f.tracks[0].id);
});

test("Early sale: a future platform date and member-only excerpts do not block an explicitly active, cleared album offer", async () => {
  const f = fixture(); f.offer.project.membersPreviewEnabled = true;
  const before = structuredClone(f.offer), chosen = (await selections([f.id], f.db))[0];
  assert.equal(chosen.priceCents, 990); assert.equal(chosen.tracks.length, 12);
  assert.ok(chosen.tracks.every(track => track.formats?.join(",") === "WAV,MP3"));
  assert.deepEqual(f.offer, before); // Eligibility alone never creates a sale, payment, right or altered offer.
});

test("Early sale: a future date/member flag never substitutes activation, exact rights/artistic approval or private cleared files", async () => {
  for (const change of ["inactive", "unconfirmed", "pendingWav", "pendingMp3", "pendingPreview", "missingRights", "missingArtistic", "announcedTrack", "quarantine"] as const) {
    const f = fixture(); f.offer.project.membersPreviewEnabled = true;
    const master = f.tracks[0].digitalMasters[0];
    if (change === "inactive") f.offer.active = false; if (change === "unconfirmed") f.offer.rightsConfirmed = false;
    if (change === "pendingWav") master.masterAsset.rightsStatus = "PENDING";
    if (change === "pendingMp3") master.mp3Asset.rightsStatus = "PENDING";
    if (change === "pendingPreview") master.previewAsset.rightsStatus = "PENDING";
    if (change === "announcedTrack") f.tracks[0].status = "ANNOUNCED";
    if (change === "quarantine") master.status = "QUARANTINED";
    if (change === "missingRights") f.db.digitalEvent.findFirst = (async () => null) as typeof f.db.digitalEvent.findFirst;
    if (change === "missingArtistic") {
      const original = f.db.$queryRaw;
      f.db.$queryRaw = (async (parts: TemplateStringsArray, ...values: unknown[]) => parts.join("?").includes("dcn-excerpt-latest-artistic-events") ? [] : original(parts, ...values)) as typeof original;
    }
    await assert.rejects(selections([f.id], f.db), { code: ["inactive", "unconfirmed"].includes(change) ? "OFFER_UNAVAILABLE"
      : change === "missingRights" ? "RIGHTS_REVIEW_REQUIRED" : change === "missingArtistic" ? "EXCERPT_ARTISTIC_VALIDATION_REQUIRED" : "NO_READY_MASTER" }, change);
  }
});

async function isolatedPublicProjection<T>(f: ReturnType<typeof fixture>, run: () => Promise<T>) {
  const resets: Array<() => void> = [];
  const replace = (target: object, key: string, value: unknown) => { const object = target as Record<string, unknown>, previous = object[key]; object[key] = value; resets.push(() => { object[key] = previous; }); };
  replace(prisma, "$queryRaw", f.db.$queryRaw);
  replace(prisma.project, "findFirst", async () => ({ ...f.offer.project, digitalOffers: [{ id: f.id, scope: f.offer.scope, trackId: f.offer.trackId }] }));
  for (const model of ["digitalMaster", "digitalOffer", "digitalEvent", "user"] as const)
    for (const method of ["findMany", "findFirst", "findUnique"] as const) {
      const replacement = (f.db[model] as unknown as Record<string, unknown>)[method]; if (replacement) replace(prisma[model], method, replacement);
    }
  try { return await run(); } finally { resets.reverse().forEach(reset => reset()); }
}
test("Early sale: public catalogue exposes the approved offer but no member excerpt or full audio URL", async () => {
  const f = fixture(); f.offer.project.membersPreviewEnabled = true;
  await isolatedPublicProjection(f, async () => {
    const view = await publicDigitalProject("synthetic-members-early-sale");
    assert.equal(view?.membersPreviewOnly, true); assert.equal(view?.album?.id, f.id); assert.equal(view?.album?.priceCents, 990);
    assert.ok(view?.tracks.every(track => track.previewUrl === null));
    const serialized = JSON.stringify(view);
    for (const track of f.tracks) for (const assetId of [track.digitalMasters[0].masterAssetId, track.digitalMasters[0].mp3AssetId, track.digitalMasters[0].previewAssetId])
      assert.equal(serialized.includes(assetId!), false, "Only the catalogue/offer IDs, never audio IDs, are projected");
    assert.doesNotMatch(serialized, /storageKey|\/media\/digital\/previews|downloadUrl/);
    f.offer.active = false;
    assert.equal(await publicDigitalProject("synthetic-members-early-sale"), null); // Flag/date alone never opens a purchase.
  });
});

test("Admin selection: rightsConfirmed flag cannot replace a bound current rights review", async () => {
  const f = fixture();
  f.db.digitalEvent.findFirst = (async () => null) as unknown as typeof f.db.digitalEvent.findFirst;
  await assert.rejects(() => selections([f.id], f.db), { code: "RIGHTS_REVIEW_REQUIRED" });
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
    for (const variant of ["oldEncoder", "truncatedProof", "durationMismatch", "newInvalidTrack", "hiddenProject", "draftProject", "missingRightsReview", "reviewerInactive", "valid", "inactiveDraft"] as const) {
      const f = fixture(), master = f.tracks[11].digitalMasters[0], writes: string[] = [];
      const artistic=f.tracks.flatMap(track=>track.digitalMasters).map(master=>syntheticExistingExcerptApproval(master,actor.id));
      if (variant === "oldEncoder") master.encoderVersion = "ffmpeg-libmp3lame-cbr-v1";
      if (variant === "truncatedProof") master.mp3Asset.checksumSha256 = "a".repeat(63);
      if (variant === "durationMismatch") master.mp3Asset.durationMs += 101;
      if (variant === "newInvalidTrack") f.tracks.push({ ...f.tracks[0], id: randomUUID(), position: 13, digitalMasters: [] });
      if (variant === "hiddenProject") f.offer.project.publicVisible = false;
      if (variant === "draftProject" || variant === "inactiveDraft") f.offer.project.status = "DRAFT";
      if (variant === "inactiveDraft") for (const track of f.tracks) track.digitalMasters = [];
      const tx = {
        $queryRaw: async (parts:TemplateStringsArray,...values:unknown[]) => {
          const sql=parts.join("?");
          if(sql.includes("dcn-excerpt-current-masters"))return f.tracks.filter(track=>(values[0] as string[]).includes(track.id))
            .flatMap(track=>track.digitalMasters.map(master=>({id:master.id,trackId:track.id})));
          if(sql.includes("dcn-excerpt-latest-artistic-events"))return artistic.filter(event=>(values[1] as string[]).includes(event.masterId));
          return[];
        },
        project: { async findUnique() { return f.offer.project; } },
        track: { async findFirst() { return null; } },
        digitalOffer: { async findFirst() { return null; }, async create({ data }: { data: Record<string, unknown> }) { writes.push("offer"); return { ...data, id: f.id }; } },
        digitalMaster: { async findMany() { return f.tracks.flatMap(track => track.digitalMasters); } },
        asset: { async updateMany() { writes.push("rights"); return { count: 1 }; } },
        digitalEvent: { async create() { writes.push("audit"); return {}; }, async findFirst({ where }: { where: { details: { equals: string } } }) {
          if(variant==="missingRightsReview")return null;
          const master = f.tracks.flatMap(track => track.digitalMasters).find(master => master.id === where.details.equals); return master ? approvedReview(master, actor.id) : null;
        } },
        user: { async findUnique() { return { id: actor.id, role: "ADMIN", status: variant==="reviewerInactive"?"SUSPENDED":"ACTIVE", emailVerified: true }; },
          async findMany() { return [{ id: actor.id, role: "ADMIN", status: variant==="reviewerInactive"?"SUSPENDED":"ACTIVE", emailVerified: true }]; } },
      } as unknown as Prisma.TransactionClient;
      prisma.$transaction = (async (callback: (db: Prisma.TransactionClient) => Promise<unknown>) => callback(tx)) as unknown as typeof original;
      const run = () => saveOffer(actor, { projectId: f.offer.project.id, trackId: null, priceCents: variant === "inactiveDraft" ? null : 990,
        active: variant !== "inactiveDraft", rightsConfirmed: variant !== "inactiveDraft", expectedVersion: 0, distribution: "UNRELEASED" });
      if (variant === "valid") {
        assert.equal(await run(), f.id); assert.deepEqual(writes, ["offer", "rights", "audit"]); assert.equal(f.tracks.length, 12);
      } else if (variant === "inactiveDraft") {
        assert.equal(await run(), f.id); assert.deepEqual(writes, ["offer", "audit"]);
      } else {
        await assert.rejects(run, { code: ["missingRightsReview","reviewerInactive"].includes(variant)?"RIGHTS_REVIEW_REQUIRED":"NO_READY_MASTER" }, variant); assert.deepEqual(writes, [], variant);
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
