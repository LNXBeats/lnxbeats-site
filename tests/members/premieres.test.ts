import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { DIGITAL_RIGHTS_ATTESTATION, DIGITAL_RIGHTS_REVIEW_EVENT, DIGITAL_RIGHTS_REVIEW_POLICY, digitalRightsMasterBinding, digitalRightsReviewHash } from "@/lib/digital/rights-review-policy";
import { digitalExcerptHash, type DigitalExcerptDetails } from "@/lib/digital/excerpt-policy";
import { putMediaObject, mediaScopeForReference, createPublicMediaSignedUrl } from "@/lib/media/storage";
import { assertMemberPremiereReady, authorizeMemberPremiereExcerpts, listMemberPremieres, memberPremiereAudioAsset, memberPremiereCoverAsset } from "@/lib/members/previews";
import { MEMBER_PREMIERE_EVENT, memberPremiereBinding, premiereFutureDate, premiereMemberAllowed, privatePremiereExcerpt } from "@/lib/members/premiere-policy";
import { syntheticExistingExcerptApproval } from "../digital/fixtures/excerpt-approval";

// Repository doubles and a newly created 4 KiB private byte fixture only.
// No database, actual user, historical media, approval, payment or email is used.
const environment = { ...process.env };
const now = new Date("2026-10-22T10:00:00.000Z");
const member = { role: "MEMBER", status: "ACTIVE", emailVerified: true };
const bytes = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 251));
const checksum = createHash("sha256").update(bytes).digest("hex");
const storageKey = `digital/studio/${randomUUID()}/${randomUUID()}.mp3`;
let root: string;
type TestSession = { user: typeof member } | null;
const context = globalThis as typeof globalThis & { __memberPremiereTestSession?: TestSession };
registerHooks({ load(url, loadContext, next) {
  if (url.endsWith("/lib/auth/session.ts")) return { format: "module", source: "export async function getAuthSession() { return globalThis.__memberPremiereTestSession ?? null; }", shortCircuit: true };
  return next(url, loadContext);
} });
const memberRoute = await import("@/app/media/members-premieres/[id]/route");
const publicRoute = await import("@/app/media/digital/previews/[id]/route");
const legacyRoute = await import("@/app/media/catalog/audio/[assetId]/route");

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lnx-member-premiere-"));
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST", NODE_ENV: "test", DCN_DISCOGRAPHY_V13_ENABLED: "false",
    MEDIA_STORAGE_DRIVER: "local", MEDIA_DEPLOYMENT_ENV: "test", MEDIA_LOCAL_PUBLIC_ROOT: path.join(root, "public"), MEDIA_LOCAL_PRIVATE_ROOT: path.join(root, "private") });
  for (const key of ["RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "PAYMENT_DEPLOYMENT_ENV"]) delete process.env[key];
  await putMediaObject({ scope: "private", key: storageKey, body: bytes, contentLength: bytes.length, contentType: "audio/mpeg", checksumSha256: checksum });
});
after(async () => {
  context.__memberPremiereTestSession = null;
  await rm(root, { recursive: true, force: true }); // Only this test's mkdtemp path.
  for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
  Object.assign(process.env, environment);
});

function fixture(count = 1) {
  const reviewer = { id: randomUUID(), role: "ADMIN", status: "ACTIVE", emailVerified: true };
  const projectId = randomUUID(), coverId = randomUUID();
  const asset = (id: string, mimeType: string, visibility: "PUBLIC" | "PRIVATE", durationMs: number) => ({ id,
    type: visibility === "PUBLIC" ? "AUDIO_PREVIEW" : "AUDIO_MASTER", mimeType, visibility, durationMs, sizeBytes: BigInt(bytes.length), checksumSha256: checksum,
    rightsStatus: "CLEARED", storageKey, storageBackend: "LOCAL" as const, storageProvider: "local", updatedAt: now });
  const masters = Array.from({ length: count }, (_, index) => {
    const wavId = randomUUID(), mp3Id = randomUUID(), previewId = randomUUID();
    return { id: randomUUID(), trackId: randomUUID(), version: 1, status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION,
      mp3BitrateKbps: 320, masterAssetId: wavId, mp3AssetId: mp3Id, previewAssetId: previewId, previewStartMs: 0, previewDurationMs: 59_950,
      masterAsset: asset(wavId, "audio/wav", "PRIVATE", 120_000), mp3Asset: asset(mp3Id, "audio/mpeg", "PRIVATE", 120_000),
      previewAsset: asset(previewId, "audio/mpeg", "PUBLIC", 59_950), track: { projectId, title: `Titre original — 東京 ${index}`, status: "RELEASED", project: { status: "PUBLISHED", publicVisible: true } } };
  });
  const project = { id: projectId, slug: "premiere-synthetique", title: "Album original — 東京", type: count === 1 ? "SINGLE" : "ALBUM", status: "PUBLISHED", publicVisible: true,
    membersPreviewEnabled: true, releaseDate: new Date("2026-10-30T00:00:00.000Z"), digitalOffers: [{ active: false }],
    assets: [{ assetId: coverId, asset: { id: coverId, type: "COVER", checksumSha256: "e".repeat(64), visibility: "PUBLIC", rightsStatus: "CLEARED" } }],
    tracks: masters.map((master, index) => ({ id: master.trackId, title: master.track.title, position: index + 1, status: "RELEASED", digitalMasters: [master] })) };
  type Master = (typeof masters)[number];
  const rights = new Map<string, ReturnType<typeof approveRights>>();
  const artistic = new Map<string, ReturnType<typeof syntheticExistingExcerptApproval>>();
  const latest = new Map(masters.map(master => [master.trackId, master.id]));
  let receipt: { actorId: string; details: { projectId: string; premiereBinding: string } } | null = null;
  let reads = 0, writes = 0;
  const assetChanges: unknown[] = [], events: unknown[] = [], queries: unknown[] = [];
  function approveRights(master: Master, status = "APPROVED") {
    const at = new Date("2026-10-22T09:00:00.000Z"), proof = { policy: DIGITAL_RIGHTS_REVIEW_POLICY, binding: digitalRightsMasterBinding(master), status,
      privateEvidenceReference: "private-evidence:synthetic/member-premiere", evidenceSha256: "b".repeat(64), attestation: DIGITAL_RIGHTS_ATTESTATION,
      reason: null, reviewedAt: at.toISOString(), requestHash: "d".repeat(64) };
    const event = { id: randomUUID(), actorId: reviewer.id, kind: DIGITAL_RIGHTS_REVIEW_EVENT, createdAt: at,
      details: { ...proof, recordHash: digitalRightsReviewHash({ actorId: reviewer.id, ...proof }) } };
    rights.set(master.id, event); return event;
  }
  const db = {
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      reads++; const sql = parts.join("?");
      if (sql.includes("dcn-excerpt-current-masters")) return [...latest].filter(([trackId]) => (values[0] as string[]).includes(trackId)).map(([trackId, id]) => ({ trackId, id }));
      if (sql.includes("dcn-excerpt-latest-artistic-events")) return (values[1] as string[]).flatMap(id => artistic.has(id) ? [artistic.get(id)!] : []);
      return [];
    },
    project: {
      async findMany(query: unknown) { reads++; queries.push(query); return [project]; },
      async findUnique() { reads++; return project; },
    },
    projectAsset: {
      async count() { reads++; return 0; },
      async findMany() { reads++; return [{ projectId }]; },
    },
    digitalMaster: {
      async findFirst({ where }: { where: { previewAssetId: string; track?: { project?: { membersPreviewEnabled?: boolean } } } }) {
        reads++; queries.push(where);
        if (where.track?.project?.membersPreviewEnabled === false && project.membersPreviewEnabled) return null;
        return masters.find(master => master.previewAssetId === where.previewAssetId) ?? null;
      },
      async findMany({ where }: { where: { id: { in: string[] } } }) { reads++; return masters.filter(master => where.id.in.includes(master.id)); },
    },
    digitalEvent: {
      async findFirst({ where }: { where: { kind: string; details: { equals: string } } }) {
        reads++; return where.kind === MEMBER_PREMIERE_EVENT ? receipt : rights.get(where.details.equals) ?? null;
      },
      async create(input: unknown) { writes++; events.push(input); return input; },
    },
    user: { async findUnique() { reads++; return reviewer; }, async findMany() { reads++; return [reviewer]; } },
    asset: {
      async findMany() { reads++; return []; },
      async findFirst(query: { where: { projects: { some: { project: { membersPreviewEnabled?: boolean } } } } }) {
        reads++; queries.push(query);
        return query.where.projects.some.project.membersPreviewEnabled === false && project.membersPreviewEnabled ? null : masters[0].previewAsset;
      },
      async updateMany(input: { where: { id: { in: string[] }; type: string; rightsStatus: string }; data: { rightsStatus: string } }) {
        writes++; assetChanges.push(input); let count = 0;
        for (const master of masters) if (input.where.id.in.includes(master.previewAssetId) && master.previewAsset.type === input.where.type && master.previewAsset.rightsStatus === input.where.rightsStatus) {
          master.previewAsset.rightsStatus = input.data.rightsStatus; count++;
        }
        return { count };
      },
    },
  };
  const approve = () => masters.forEach(master => { approveRights(master); artistic.set(master.id, syntheticExistingExcerptApproval(master, reviewer.id)); });
  const publish = () => { receipt = { actorId: reviewer.id, details: { projectId, premiereBinding: memberPremiereBinding(project) } }; };
  return { db, tx: db as unknown as Prisma.TransactionClient, masters, project, reviewer, rights, artistic, latest, approve, approveRights, publish,
    unpublish: () => { receipt = null; }, reads: () => reads, writes: () => writes, assetChanges, events, queries };
}
async function withRepositories<T>(f: ReturnType<typeof fixture>, run: () => Promise<T>) {
  const restore: Array<() => void> = [];
  const replace = (target: object, key: string, value: unknown) => {
    const record = target as Record<string, unknown>, original = record[key]; record[key] = value; restore.push(() => { record[key] = original; });
  };
  replace(prisma, "$transaction", async (callback: (db: Prisma.TransactionClient) => Promise<T>) => callback(f.tx));
  replace(prisma, "$queryRaw", f.db.$queryRaw);
  for (const name of ["project", "projectAsset", "digitalMaster", "digitalEvent", "user", "asset"] as const)
    for (const [key, value] of Object.entries(f.db[name])) replace(prisma[name], key, value);
  try { return await run(); } finally { restore.reverse().forEach(reset => reset()); context.__memberPremiereTestSession = null; }
}

test("member premiere: only an active, verified member/customer/admin is eligible", () => {
  for (const role of ["MEMBER", "CUSTOMER", "ADMIN"]) assert.equal(premiereMemberAllowed({ ...member, role }), true);
  for (const actor of [null, undefined, { ...member, role: "VISITOR" }, { ...member, emailVerified: false }, { ...member, status: "PENDING" }, { ...member, status: "SUSPENDED" }, { ...member, status: "DEACTIVATED" }])
    assert.equal(premiereMemberAllowed(actor), false);
});
test("member premiere: the date-only release closes at midnight Paris, in summer and winter", () => {
  assert.equal(premiereFutureDate(new Date("2026-10-23T00:00:00Z"), new Date("2026-10-22T21:59:59Z")), true);
  assert.equal(premiereFutureDate(new Date("2026-10-23T00:00:00Z"), new Date("2026-10-22T22:00:00Z")), false);
  assert.equal(premiereFutureDate(new Date("2026-12-23T00:00:00Z"), new Date("2026-12-22T22:59:59Z")), true);
  assert.equal(premiereFutureDate(new Date("2026-12-23T00:00:00Z"), new Date("2026-12-22T23:00:00Z")), false);
  assert.equal(premiereFutureDate(null, now), false); assert.equal(premiereFutureDate(new Date("invalid"), now), false);
  assert.equal(premiereFutureDate(new Date("2030-01-01"), new Date("invalid")), false);
});
test("member premiere: the excerpt must be bounded MP3 AUDIO_PREVIEW in the physically private Studio namespace", () => {
  const preview = fixture().masters[0].previewAsset;
  assert.equal(privatePremiereExcerpt(preview), true);
  assert.equal(mediaScopeForReference(preview), "private");
  assert.equal(privatePremiereExcerpt({ ...preview, durationMs: 60_000, sizeBytes: 3n * 1024n * 1024n }), true);
  for (const change of [{ type: "AUDIO_MASTER" }, { mimeType: "audio/wav" }, { storageKey: storageKey.replace(/\.mp3$/, ".wav") },
    { storageKey: `catalog/audio-previews/${randomUUID()}.mp3` }, { storageKey: `digital/masters/${randomUUID()}/${randomUUID()}.mp3` },
    { storageKey: `../${storageKey}` }, { storageKey: `https://example.test/${storageKey}` }, { durationMs: 60_001 }, { durationMs: 1.5 },
    { durationMs: NaN }, { durationMs: 0 }, { durationMs: null }, { sizeBytes: 0n }, { sizeBytes: 3n * 1024n * 1024n + 1n }, { checksumSha256: null }])
    assert.equal(privatePremiereExcerpt({ ...preview, ...change }), false, JSON.stringify(change, (_, value) => typeof value === "bigint" ? String(value) : value));
});
test("member premiere: publication binding covers title, slug, cover, exact source, version, excerpt and date", () => {
  const f = fixture(), initial = memberPremiereBinding(f.project);
  for (const change of ["title", "slug", "cover", "source", "version", "master", "excerpt", "excerptKey", "date", "enabled"]) {
    const p = structuredClone(f.project), master = p.tracks[0].digitalMasters[0];
    if (change === "title") p.title += " changed"; if (change === "slug") p.slug += "-changed";
    if (change === "cover") p.assets[0].asset.checksumSha256 = "f".repeat(64);
    if (change === "source") master.masterAsset.checksumSha256 = "f".repeat(64);
    if (change === "version") master.version++; if (change === "master") master.id = randomUUID();
    if (change === "excerpt") master.previewAsset.id = randomUUID(); if (change === "excerptKey") master.previewAsset.storageKey = `digital/studio/${randomUUID()}/${randomUUID()}.mp3`;
    if (change === "date") p.releaseDate = new Date("2030-01-02"); if (change === "enabled") p.membersPreviewEnabled = false;
    assert.notEqual(memberPremiereBinding(p), initial, change);
  }
});
test("member premiere: incidental array order is stable, a real track reorder invalidates publication", () => {
  const f = fixture(2), before = memberPremiereBinding(f.project);
  f.project.tracks.reverse(); assert.equal(memberPremiereBinding(f.project), before);
  f.project.tracks[0].position = 1; f.project.tracks[1].position = 2;
  assert.notEqual(memberPremiereBinding(f.project), before);
});
test("member premiere: unauthenticated, unverified and inactive actors cannot even read repositories", async () => {
  const f = fixture(); f.approve(); f.publish();
  for (const actor of [null, { ...member, emailVerified: false }, { ...member, status: "SUSPENDED" }, { ...member, role: "VISITOR" }]) {
    assert.deepEqual(await listMemberPremieres(actor, f.tx, now), []);
    assert.equal(await memberPremiereAudioAsset(actor, f.masters[0].previewAssetId, f.tx, now), null);
    assert.equal(await memberPremiereCoverAsset(actor, f.project.assets[0].assetId, f.tx, now), null);
  }
  assert.equal(f.reads(), 0); assert.equal(f.writes(), 0);
});
test("member premiere: the closed or invalid digital environment cannot read repositories", async () => {
  const f = fixture();
  for (const mode of ["closed", "invalid"]) {
    process.env.DCN_ENABLED = mode === "closed" ? "false" : "true";
    process.env.DCN_MODE = mode === "invalid" ? "INVALID" : "TEST";
    try { assert.deepEqual(await listMemberPremieres(member, f.tx, now), []); assert.equal(await memberPremiereAudioAsset(member, randomUUID(), f.tx, now), null); }
    finally { process.env.DCN_ENABLED = "true"; process.env.DCN_MODE = "TEST"; }
  }
  assert.equal(f.reads(), 0);
});
test("member premiere: approvals alone without an explicit exact publication receipt expose nothing", async () => {
  const f = fixture(); f.approve();
  assert.deepEqual(await listMemberPremieres(member, f.tx, now), []);
  assert.equal(await memberPremiereAudioAsset(member, f.masters[0].previewAssetId, f.tx, now), null);
  assert.equal(f.writes(), 0);
});
test("member premiere: album-scoped lookup retains publication gates, is read-only and filters by exact slug", async () => {
  const f = fixture(); f.approve();
  assert.deepEqual(await listMemberPremieres(member, f.tx, now, { slug: f.project.slug }), []);
  f.publish();
  const result = await listMemberPremieres(member, f.tx, now, { slug: f.project.slug });
  assert.equal(result.length, 1); assert.equal(result[0].slug, f.project.slug);
  const query = f.queries[0] as { where: Record<string, unknown> };
  assert.deepEqual(query.where, { membersPreviewEnabled: true, status: "PUBLISHED", publicVisible: true, releaseDate: { gt: now }, slug: f.project.slug });
  assert.equal(f.writes(), 0);
});
test("member premiere: safe projection contains only bounded member audio and cover routes, never full assets, prices or evidence", async () => {
  const f = fixture(2); f.approve(); f.publish();
  const view = await listMemberPremieres(member, f.tx, now); assert.equal(view.length, 1); assert.equal(view[0].title, f.project.title);
  assert.equal(view[0].coverUrl, `/media/members-premieres/covers/${f.project.assets[0].assetId}`);
  assert.deepEqual(view[0].tracks.map(track => track.previewUrl), f.masters.map(master => `/media/members-premieres/${master.previewAssetId}`));
  const serialized = JSON.stringify(view);
  for (const forbidden of [storageKey, f.masters[0].masterAssetId, f.masters[0].mp3AssetId, "private-evidence:", "priceCents", "downloadUrl", "checksumSha256", "rightsStatus"])
    assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal(f.writes(), 0);
});
test("member premiere: explicitly active sales coexist with exact member excerpts without changing offers", async () => {
  for (const count of [1, 2]) {
    const f = fixture(count); f.approve(); f.publish(); f.project.digitalOffers.push({ active: true });
    const before = structuredClone(f.project.digitalOffers);
    assert.deepEqual(await assertMemberPremiereReady(f.tx, f.project.id, now), { binding: memberPremiereBinding(f.project) });
    const view = await listMemberPremieres(member, f.tx, now); assert.equal(view.length, 1);
    assert.equal(view[0].tracks[0].previewUrl, `/media/members-premieres/${f.masters[0].previewAssetId}`);
    assert.deepEqual(f.project.digitalOffers, before); assert.equal(f.writes(), 0);
  }
});
test("member premiere: missing/revoked rights, missing artistic approval and changed file hashes fail closed", async () => {
  for (const change of ["rights", "revoked", "art", "draft", "source", "preview", "reviewer"]) {
    const f = fixture(); f.approve(); f.publish();
    if (change === "rights") f.rights.clear(); if (change === "revoked") f.approveRights(f.masters[0], "REVOKED");
    if (change === "art") f.artistic.clear(); if (change === "source") f.masters[0].masterAsset.checksumSha256 = "f".repeat(64);
    if (change === "preview") f.masters[0].previewAsset.checksumSha256 = "f".repeat(64); if (change === "reviewer") f.reviewer.status = "SUSPENDED";
    if (change === "draft") {
      const event = f.artistic.get(f.masters[0].id)!, { recordHash, ...proof } = event.details as DigitalExcerptDetails; void recordHash;
      const draft = { ...proof, status: "DRAFT" as const, candidateAssetId: null, candidateSha256: null, previewDurationMs: null, attested: false, candidateOrigin: undefined };
      event.details = { ...draft, recordHash: digitalExcerptHash({ actorId: event.actorId, ...draft }) };
    }
    assert.deepEqual(await listMemberPremieres(member, f.tx, now), [], change);
    assert.equal(await memberPremiereAudioAsset(member, f.masters[0].previewAssetId, f.tx, now), null, change);
    assert.equal(f.writes(), 0);
  }
});
test("member premiere: a restricted/rejected original or derived file remains blocked despite exact prior approvals", async () => {
  for (const target of ["masterAsset", "mp3Asset", "previewAsset"] as const) for (const status of ["RESTRICTED", "REJECTED"]) {
    const f = fixture(); f.approve(); f.publish(); f.masters[0][target].rightsStatus = status;
    assert.deepEqual(await listMemberPremieres(member, f.tx, now), [], `${target} ${status}`);
    await assert.rejects(authorizeMemberPremiereExcerpts(f.tx, f.project.id, f.reviewer.id, now));
    assert.equal(f.writes(), 0);
  }
});
test("member premiere: private/draft/disabled releases, today's date and unlisted tracks stay unavailable", async () => {
  for (const change of ["private", "draft", "disabled", "today", "unlisted", "cover"]) {
    const f = fixture(); f.approve(); f.publish();
    if (change === "private") f.project.publicVisible = false; if (change === "draft") f.project.status = "DRAFT";
    if (change === "disabled") f.project.membersPreviewEnabled = false; if (change === "today") f.project.releaseDate = new Date("2026-10-22");
    if (change === "unlisted") f.project.tracks[0].status = "UNLISTED"; if (change === "cover") f.project.assets[0].asset.rightsStatus = "PENDING";
    assert.deepEqual(await listMemberPremieres(member, f.tx, now), [], change);
  }
});
test("member premiere: full WAV, complete MP3 and a superseded preview never use the member audio route", async () => {
  const f = fixture(); f.approve(); f.publish();
  for (const id of [f.masters[0].masterAssetId, f.masters[0].mp3AssetId]) assert.equal(await memberPremiereAudioAsset(member, id, f.tx, now), null);
  assert.equal((await memberPremiereAudioAsset(member, f.masters[0].previewAssetId, f.tx, now))?.id, f.masters[0].previewAssetId);
  f.latest.set(f.masters[0].trackId, randomUUID());
  assert.equal(await memberPremiereAudioAsset(member, f.masters[0].previewAssetId, f.tx, now), null);
});
test("member premiere: metadata changes invalidate the existing receipt even when exact audio approvals remain", async () => {
  for (const change of ["title", "trackTitle", "date", "order"]) {
    const f = fixture(2); f.approve(); f.publish();
    if (change === "title") f.project.title += " changed"; if (change === "trackTitle") f.project.tracks[0].title += " changed";
    if (change === "date") f.project.releaseDate = new Date("2026-11-01");
    if (change === "order") { f.project.tracks[0].position = 2; f.project.tracks[1].position = 1; }
    assert.deepEqual(await listMemberPremieres(member, f.tx, now), [], change);
  }
});
test("member premiere: explicit authorization clears only pending short excerpts, never full files or offers", async () => {
  const f = fixture(2); f.approve(); f.masters.forEach(master => { master.masterAsset.rightsStatus = "PENDING"; master.mp3Asset.rightsStatus = "PENDING"; master.previewAsset.rightsStatus = "PENDING"; });
  await authorizeMemberPremiereExcerpts(f.tx, f.project.id, f.reviewer.id, now);
  assert.equal(f.assetChanges.length, 1); assert.equal(f.events.length, 1);
  assert.deepEqual(f.assetChanges[0], { where: { id: { in: f.masters.map(master => master.previewAssetId) }, type: "AUDIO_PREVIEW", rightsStatus: "PENDING" }, data: { rightsStatus: "CLEARED" } });
  for (const master of f.masters) { assert.equal(master.previewAsset.rightsStatus, "CLEARED"); assert.equal(master.masterAsset.rightsStatus, "PENDING"); assert.equal(master.mp3Asset.rightsStatus, "PENDING"); }
  assert.deepEqual(f.project.digitalOffers, [{ active: false }]);
  // An authorization is still not a publication receipt.
  assert.deepEqual(await listMemberPremieres(member, f.tx, now), []);
});
test("member premiere: missing rights/artistic approval prevents even the limited excerpt-clearance write", async () => {
  for (const change of ["rights", "art", "actor"]) {
    const f = fixture(); f.approve(); f.masters[0].previewAsset.rightsStatus = "PENDING";
    if (change === "rights") f.rights.clear(); if (change === "art") f.artistic.clear(); if (change === "actor") f.reviewer.role = "MEMBER";
    await assert.rejects(authorizeMemberPremiereExcerpts(f.tx, f.project.id, f.reviewer.id, now)); assert.equal(f.writes(), 0);
  }
});
test("member premiere route: actual GET/HEAD/Range bytes stay private and repeat member/version gates before conditional responses", async () => {
  const f = fixture(); f.approve(); f.publish(); const id = f.masters[0].previewAssetId, params = { params: Promise.resolve({ id }) };
  await withRepositories(f, async () => {
    context.__memberPremiereTestSession = { user: member };
    const response = await memberRoute.GET(new Request(`http://localhost/media/members-premieres/${id}`), params);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie"); assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    const head = await memberRoute.HEAD(new Request(`http://localhost/media/members-premieres/${id}`, { method: "HEAD" }), params);
    assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), String(bytes.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
    const range = await memberRoute.GET(new Request(`http://localhost/media/members-premieres/${id}`, { headers: { range: "bytes=0-15" } }), params);
    assert.equal(range.status, 206); assert.equal(range.headers.get("content-range"), `bytes 0-15/${bytes.length}`); assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 16));
    context.__memberPremiereTestSession = null;
    const denied = await memberRoute.GET(new Request(`http://localhost/media/members-premieres/${id}`, { headers: { "if-none-match": response.headers.get("etag")! } }), params);
    assert.equal(denied.status, 404); assert.equal(denied.headers.get("cache-control"), "private, no-store");
    context.__memberPremiereTestSession = { user: member }; f.approveRights(f.masters[0], "REVOKED");
    assert.equal((await memberRoute.HEAD(new Request(`http://localhost/media/members-premieres/${id}`, { method: "HEAD" }), params)).status, 404);
  });
  assert.equal((await stat(path.join(root, "private", storageKey))).size, bytes.length);
  await assert.rejects(stat(path.join(root, "public", storageKey)), { code: "ENOENT" });
  assert.throws(() => createPublicMediaSignedUrl(f.masters[0].previewAsset, { expiresInSeconds: 30 }));
});
test("member premiere: public digital and legacy audio endpoints exclude members-only projects independently of the discography feature flag", async () => {
  const f = fixture(); f.approve(); f.publish(); f.project.digitalOffers.push({ active: true }); const id = f.masters[0].previewAssetId;
  await withRepositories(f, async () => {
    for (const route of [publicRoute.GET, publicRoute.HEAD]) assert.equal((await route(new Request(`http://localhost/media/digital/previews/${id}`), { params: Promise.resolve({ id }) })).status, 404);
    for (const route of [legacyRoute.GET, legacyRoute.HEAD]) assert.equal((await route(new Request(`http://localhost/media/catalog/audio/${id}`), { params: Promise.resolve({ assetId: id }) })).status, 404);
  });
  assert.equal(f.queries.some(query => JSON.stringify(query).includes('"membersPreviewEnabled":false')), true);
});
test("member premiere: infrastructure failures do not become grants and page/route rendering never exposes complete audio", async () => {
  const f = fixture(); f.approve(); f.publish(); f.db.project.findMany = async () => { throw Error("SYNTHETIC_REPOSITORY_UNAVAILABLE"); };
  await assert.rejects(listMemberPremieres(member, f.tx, now), /SYNTHETIC_REPOSITORY_UNAVAILABLE/);
  const page = await readFile(new URL("../../app/avant-premieres/page.tsx", import.meta.url), "utf8");
  const experience = await readFile(new URL("../../components/premiere-experience.tsx", import.meta.url), "utf8");
  const player = await readFile(new URL("../../components/digital-catalog.tsx", import.meta.url), "utf8");
  assert.match(page, /getAuthSession\(\)/); assert.match(page, /loadPremierePageData\(session\?\.user, now\)/);
  assert.match(page, /premiereMemberAllowed\(session\?\.user\)/); assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /member && premiere \? \{ voteBinding: premiere\.binding \} : \{\}/);
  assert.match(experience, /member && !!project\.voteBinding/);
  assert.match(experience, /listeningAllowed \? <div className=\{styles\.voteRoom\}><PremiereVote/);
  assert.match(player, /preload="none"/); assert.match(player, /src=\{track\.previewUrl \?\? undefined\}/);
  assert.doesNotMatch(page + experience, /masterAssetId|storageKey|createSignedUrl|checkout/);
  assert.match(experience, /OriginalName/);
});
