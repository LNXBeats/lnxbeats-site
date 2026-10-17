import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { publicDigitalProject } from "@/lib/digital/catalog";
import { digitalPublicPreviewAllowed } from "@/lib/digital/public-preview";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { DIGITAL_RIGHTS_REVIEW_EVENT, DIGITAL_RIGHTS_REVIEW_POLICY, DIGITAL_RIGHTS_ATTESTATION, digitalRightsMasterBinding, digitalRightsReviewHash } from "@/lib/digital/rights-review-policy";
import { digitalExcerptHash, type DigitalExcerptDetails } from "@/lib/digital/excerpt-policy";
import { writeCatalogAudioPreview } from "@/lib/catalog/media-storage";
import { GET, HEAD } from "@/app/media/digital/previews/[id]/route";
import { syntheticExistingExcerptApproval } from "./fixtures/excerpt-approval";

// Repository doubles and a newly created 4 KiB byte fixture only: no QA database,
// historical media, external storage/provider, or real approval is read/written.
const environment = { ...process.env };
const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
const checksum = createHash("sha256").update(bytes).digest("hex");
const storageKey = `catalog/audio-previews/${randomUUID()}.mp3`;
let root: string;
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lnx-dcn-public-preview-"));
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST", MEDIA_STORAGE_DRIVER: "local", MEDIA_DEPLOYMENT_ENV: "test",
    MEDIA_LOCAL_PUBLIC_ROOT: path.join(root, "public"), MEDIA_LOCAL_PRIVATE_ROOT: path.join(root, "private") });
  for (const key of ["RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "PAYMENT_DEPLOYMENT_ENV"]) delete process.env[key];
  await writeCatalogAudioPreview(storageKey, bytes);
});
after(async () => {
  await rm(root, { recursive: true, force: true }); // Only this test's mkdtemp directory.
  for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
  Object.assign(process.env, environment);
});

function fixture(count = 1) {
  const reviewer = { id: randomUUID(), role: "ADMIN", status: "ACTIVE", emailVerified: true };
  const projectId = randomUUID();
  const masters = Array.from({ length: count }, (_, index) => {
    const asset = (id: string, mimeType: string, visibility: string, durationMs: number) => ({ id, type: mimeType === "audio/wav" ? "AUDIO" : "AUDIO_PREVIEW",
      mimeType, visibility, durationMs, sizeBytes: BigInt(bytes.length), checksumSha256: checksum, rightsStatus: "CLEARED", storageKey,
      storageBackend: "LOCAL" as const, storageProvider: "local", updatedAt: new Date("2026-10-16T00:00:00Z") });
    const wavId = randomUUID(), mp3Id = randomUUID(), previewId = randomUUID();
    return { id: randomUUID(), trackId: randomUUID(), version: 1, status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION,
      mp3BitrateKbps: 320, masterAssetId: wavId, mp3AssetId: mp3Id, previewAssetId: previewId, previewStartMs: 0, previewDurationMs: 59_950,
      masterAsset: asset(wavId, "audio/wav", "PRIVATE", 120_000), mp3Asset: asset(mp3Id, "audio/mpeg", "PRIVATE", 120_000),
      previewAsset: asset(previewId, "audio/mpeg", "PUBLIC", 59_950), track: { title: `Synthetic ${index}`, status: "RELEASED", project: { status: "PUBLISHED", publicVisible: true } } };
  });
  type Master = (typeof masters)[number];
  const rights = new Map<string, ReturnType<typeof approveRights>>();
  const artistic = new Map<string, ReturnType<typeof syntheticExistingExcerptApproval>>();
  const latest = new Map(masters.map(master => [master.trackId, master.id]));
  let offerReads = 0, projectQuery: unknown;
  function approveRights(master: Master, status = "APPROVED") {
    const at = new Date("2026-10-16T10:00:00Z"), proof = { policy: DIGITAL_RIGHTS_REVIEW_POLICY, binding: digitalRightsMasterBinding(master), status,
      privateEvidenceReference: "private-evidence:synthetic/public-preview", evidenceSha256: "b".repeat(64), attestation: DIGITAL_RIGHTS_ATTESTATION,
      reason: null, reviewedAt: at.toISOString(), requestHash: "d".repeat(64) };
    const event = { id: randomUUID(), actorId: reviewer.id, kind: DIGITAL_RIGHTS_REVIEW_EVENT, createdAt: at,
      details: { ...proof, recordHash: digitalRightsReviewHash({ actorId: reviewer.id, ...proof }) } };
    rights.set(master.id, event); return event;
  }
  const db = {
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      const sql = parts.join("?");
      if (sql.includes("dcn-excerpt-current-masters")) return [...latest].filter(([trackId]) => (values[0] as string[]).includes(trackId)).map(([trackId, id]) => ({ trackId, id }));
      if (sql.includes("dcn-excerpt-latest-artistic-events")) return (values[1] as string[]).flatMap(id => artistic.has(id) ? [artistic.get(id)!] : []);
      return [];
    },
    digitalMaster: {
      async findFirst({ where }: { where: { previewAssetId: string } }) { return masters.find(master => master.previewAssetId === where.previewAssetId
        && master.status === "READY" && master.previewDurationMs <= 60_000 && master.previewAsset.visibility === "PUBLIC" && master.previewAsset.rightsStatus === "CLEARED"
        && master.track.status === "RELEASED" && master.track.project.status === "PUBLISHED" && master.track.project.publicVisible) ?? null; },
      async findMany({ where }: { where: { id: { in: string[] } } }) { return masters.filter(master => where.id.in.includes(master.id)); },
    },
    digitalEvent: { async findFirst({ where }: { where: { details: { equals: string } } }) { return rights.get(where.details.equals) ?? null; } },
    user: { async findUnique() { return reviewer; }, async findMany() { return [reviewer]; } },
    asset: { async findMany() { return []; } },
    project: { async findFirst(query: unknown) { projectQuery = query; return { id: projectId, digitalOffers: [], tracks: masters.map((master, index) => ({ id: master.trackId,
      title: master.track.title, position: index + 1, status: master.track.status, durationSeconds: 120, digitalMasters: [master] })) }; } },
    digitalOffer: { async findMany() { offerReads++; return []; } },
  };
  const approve = (master = masters[0]) => { approveRights(master); artistic.set(master.id, syntheticExistingExcerptApproval(master, reviewer.id)); };
  return { db, tx: db as unknown as Prisma.TransactionClient, masters, reviewer, rights, artistic, latest, approve, approveRights,
    offerReads: () => offerReads, projectQuery: () => projectQuery };
}

async function withRepositories<T>(f: ReturnType<typeof fixture>, run: () => Promise<T>) {
  const restore: Array<() => void> = [];
  const replace = (target: object, key: string, value: unknown) => {
    const record = target as Record<string, unknown>, original = record[key]; record[key] = value; restore.push(() => { record[key] = original; });
  };
  replace(prisma, "$transaction", async (callback: (db: Prisma.TransactionClient) => Promise<T>) => callback(f.tx));
  replace(prisma, "$queryRaw", f.db.$queryRaw);
  for (const name of ["digitalMaster", "digitalEvent", "user", "asset", "project", "digitalOffer"] as const)
    for (const [key, value] of Object.entries(f.db[name])) replace(prisma[name], key, value);
  try { return await run(); } finally { restore.reverse().forEach(reset => reset()); }
}

test("public preview: exact approved edition listens without activating or consulting an offer", async () => {
  const f = fixture(); f.approve(); assert.equal(await digitalPublicPreviewAllowed(f.tx, f.masters[0]), true); assert.equal(f.offerReads(), 0);
});
test("public preview: missing/revoked rights, unvalidated audio, altered hashes and inactive reviewers fail closed", async () => {
  for (const change of ["missingRights", "revoked", "missingArt", "draft", "sourceHash", "previewHash", "reviewer", "pending"]) {
    const f = fixture(); f.approve(); const master = f.masters[0];
    if (change === "missingRights") f.rights.clear();
    if (change === "revoked") f.approveRights(master, "REVOKED");
    if (change === "missingArt") f.artistic.clear();
    if (change === "sourceHash") { master.masterAsset.checksumSha256 = "e".repeat(64); f.approveRights(master); }
    if (change === "previewHash") { master.previewAsset.checksumSha256 = "e".repeat(64); f.approveRights(master); }
    if (change === "reviewer") f.reviewer.status = "SUSPENDED";
    if (change === "pending") master.previewAsset.rightsStatus = "PENDING";
    if (change === "draft") {
      const event = f.artistic.get(master.id)!, details = event.details as DigitalExcerptDetails;
      const { recordHash: discarded, ...proof } = details; void discarded;
      const draft = { ...proof, status: "DRAFT" as const, candidateAssetId: null, candidateSha256: null, previewDurationMs: null, attested: false, candidateOrigin: undefined };
      event.details = { ...draft, recordHash: digitalExcerptHash({ actorId: event.actorId, ...draft }) };
    }
    assert.equal(await digitalPublicPreviewAllowed(f.tx, master), false, change);
  }
});
test("public preview: a newer version, including a quarantined replacement, never inherits an older approval", async () => {
  const f = fixture(); f.approve(); f.latest.set(f.masters[0].trackId, randomUUID());
  assert.equal(await digitalPublicPreviewAllowed(f.tx, f.masters[0]), false);
});
test("public preview projection: unapproved URLs never escape; approved free listening survives no active offers", async () => {
  const f = fixture(2);
  await withRepositories(f, async () => {
    assert.equal(await publicDigitalProject("synthetic"), null);
    f.approve(); const view = await publicDigitalProject("synthetic");
    assert.equal(view?.album, null); assert.equal(view?.tracks[0].previewUrl, `/media/digital/previews/${f.masters[0].previewAssetId}`);
    assert.equal(view?.tracks[1].previewUrl, null); assert.ok(view?.tracks.every(track => track.offer === null));
    const query = f.projectQuery() as { select: { tracks: { select: { digitalMasters: { where?: unknown } } } } };
    assert.equal(query.select.tracks.select.digitalMasters.where, undefined); // No fallback to an older READY version.
  });
});
test("public preview route: authentic application GET/HEAD/Range gates preserve byte semantics without exposing a complete file", async () => {
  const f = fixture(); f.approve(); const id = f.masters[0].previewAssetId, context = { params: Promise.resolve({ id }) };
  await withRepositories(f, async () => {
    const full = await GET(new Request(`http://localhost/media/digital/previews/${id}`), context);
    assert.equal(full.status, 200); assert.equal(full.headers.get("cache-control"), "no-store"); assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
    const head = await HEAD(new Request(`http://localhost/media/digital/previews/${id}`, { method: "HEAD" }), context);
    assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), String(bytes.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
    const range = await GET(new Request(`http://localhost/media/digital/previews/${id}`, { headers: { range: "bytes=0-15" } }), context);
    assert.equal(range.status, 206); assert.equal(range.headers.get("content-range"), `bytes 0-15/${bytes.length}`); assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 16));
    const invalid = await GET(new Request(`http://localhost/media/digital/previews/${id}`, { headers: { range: "bytes=999999-" } }), context);
    assert.equal(invalid.status, 416);
    f.approveRights(f.masters[0], "REVOKED");
    const revoked = await GET(new Request(`http://localhost/media/digital/previews/${id}`, { headers: { "if-none-match": full.headers.get("etag")! } }), context);
    assert.equal(revoked.status, 404); assert.equal((await revoked.arrayBuffer()).byteLength, 0);
  });
});
test("public preview route: GET, HEAD and Range all deny pending/unvalidated/revoked/changed editions", async () => {
  for (const change of ["pending", "missingArt", "revoked", "sourceHash", "previewHash", "newVersion"]) {
    const f = fixture(); f.approve(); const master = f.masters[0], id = master.previewAssetId, context = { params: Promise.resolve({ id }) };
    if (change === "pending") master.previewAsset.rightsStatus = "PENDING";
    if (change === "missingArt") f.artistic.clear();
    if (change === "revoked") f.approveRights(master, "REVOKED");
    if (change === "sourceHash") master.masterAsset.checksumSha256 = "f".repeat(64);
    if (change === "previewHash") master.previewAsset.checksumSha256 = "f".repeat(64);
    if (change === "newVersion") f.latest.set(master.trackId, randomUUID());
    await withRepositories(f, async () => {
      for (const [handler, method, headers] of [[GET, "GET", {}], [HEAD, "HEAD", {}], [GET, "GET", { range: "bytes=0-15" }]] as const) {
        const response = await handler(new Request(`http://localhost/media/digital/previews/${id}`, { method, headers }), context);
        assert.equal(response.status, 404, `${change} ${method}`); assert.equal((await response.arrayBuffer()).byteLength, 0);
      }
    });
  }
});
