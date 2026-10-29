import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import { loadPremierePageData } from "@/lib/members/premiere-page";
import { listPublishedPremiereAnnouncements } from "@/lib/members/previews";
import { MEMBER_PREMIERE_EVENT, memberPremiereBinding } from "@/lib/members/premiere-policy";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { DIGITAL_RIGHTS_ATTESTATION, DIGITAL_RIGHTS_REVIEW_EVENT, DIGITAL_RIGHTS_REVIEW_POLICY, digitalRightsMasterBinding, digitalRightsReviewHash } from "@/lib/digital/rights-review-policy";
import { syntheticExistingExcerptApproval } from "../digital/fixtures/excerpt-approval";

// Repository doubles only. No existing account, vote, email, media or database
// is read or changed. The shared publication engine receives synthetic proofs.
const now = new Date("2026-10-29T21:00:00Z");
const actor = { role: "MEMBER", status: "ACTIVE", emailVerified: true };
const environment = { ...process.env };
before(() => {
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST", NODE_ENV: "test", DCN_DISCOGRAPHY_V13_ENABLED: "false" });
  for (const key of ["RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "PAYMENT_DEPLOYMENT_ENV"]) delete process.env[key];
});
after(() => {
  for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
  Object.assign(process.env, environment);
});

function pageFixture() {
  const coverId = randomUUID(), trackId = randomUUID(), excerptId = randomUUID();
  const announcement = { id: randomUUID(), slug: "avant-premiere-qa", title: "Création originale — 東京", type: "SINGLE" as const,
    releaseDate: "2026-12-01", coverUrl: `/media/catalog/${coverId}`, trackCount: 1 };
  const presentation = { slug: announcement.slug, title: announcement.title, type: "single" as const, status: "published" as const,
    publicVisible: true, releaseDate: announcement.releaseDate, cover: announcement.coverUrl, shortDescription: "Présentation publique existante." };
  const premiere = { id: announcement.id, slug: announcement.slug, title: announcement.title, type: "SINGLE" as const,
    releaseDate: announcement.releaseDate, coverUrl: `/media/members-premieres/covers/${coverId}`, binding: "private-documentary-binding",
    tracks: [{ id: trackId, title: "Titre inchangé", position: 1, durationMs: 59_000, previewUrl: `/media/members-premieres/${excerptId}` }] };
  const calls = { public: 0, announcements: 0, members: 0 };
  const sources = {
    enabled: () => true,
    publicProjects: async () => { calls.public++; return [presentation]; },
    announcements: async () => { calls.announcements++; return [announcement]; },
    members: async () => { calls.members++; return [premiere]; },
  };
  return { announcement, presentation, premiere, calls, sources };
}

test("premiere public page: anonymous and non-eligible actors never call the private member loader", async () => {
  for (const member of [null, undefined, { ...actor, emailVerified: false }, { ...actor, status: "SUSPENDED" }, { ...actor, role: "VISITOR" }]) {
    const f = pageFixture(), result = await loadPremierePageData(member, now, f.sources);
    assert.equal(result.announcements.length, 1); assert.deepEqual(result.memberPremieres, []);
    assert.deepEqual(f.calls, { public: 1, announcements: 1, members: 0 });
    assert.doesNotMatch(JSON.stringify(result), /binding|previewUrl|members-premieres|storageKey|masterAssetId|mp3AssetId/);
    assert.equal(result.announcements[0].coverUrl, f.presentation.cover);
  }
});
test("premiere public page: eligible member gets the same metadata and separately gated audio, with no second publication lookup", async () => {
  const f = pageFixture(), result = await loadPremierePageData(actor, now, f.sources);
  assert.deepEqual(result.announcements[0], { ...f.announcement, description: f.presentation.shortDescription });
  assert.deepEqual(result.memberPremieres, [f.premiere]);
  assert.deepEqual(f.calls, { public: 1, announcements: 0, members: 1 });
  assert.doesNotMatch(JSON.stringify(result.announcements), /binding|previewUrl|members-premieres/);
});
test("premiere public page: missing, private or changed catalogue presentation fails closed for both audiences", async () => {
  for (const member of [null, actor]) for (const change of ["missing", "private", "title", "date", "cover", "status", "kind"] as const) {
    const f = pageFixture();
    if (change === "missing") f.sources.publicProjects = async () => [];
    if (change === "private") f.presentation.publicVisible = false;
    if (change === "title") f.presentation.title += " modifié";
    if (change === "date") f.presentation.releaseDate = "2027-01-01";
    if (change === "cover") f.presentation.cover = `/media/catalog/${randomUUID()}`;
    if (change === "status") Object.assign(f.presentation, { status: "draft" });
    if (change === "kind") Object.assign(f.presentation, { type: "album" });
    assert.deepEqual(await loadPremierePageData(member, now, f.sources), { announcements: [], memberPremieres: [] }, change);
  }
});
test("premiere public page: unknown/private/external covers and duplicate project identities are not promoted", async () => {
  for (const coverUrl of ["https://private.example/cover.webp", "/media/members-premieres/covers/not-an-id", "/api/private/cover", ""]) {
    const f = pageFixture(); f.announcement.coverUrl = coverUrl; f.presentation.cover = coverUrl;
    assert.deepEqual(await loadPremierePageData(null, now, f.sources), { announcements: [], memberPremieres: [] });
  }
  const f = pageFixture(); f.sources.announcements = async () => [f.announcement, f.announcement];
  assert.deepEqual(await loadPremierePageData(null, now, f.sources), { announcements: [], memberPremieres: [] });
});
test("premiere public page: allowlist never spreads private data, documents or commercial fields", async () => {
  const f = pageFixture();
  Object.assign(f.announcement, { binding: "private", storageKey: "private/source.wav", masterAssetId: randomUUID(),
    priceCents: 129, invoice: "private-document", recipientEmail: "synthetic@example.test" });
  Object.assign(f.presentation, { credits: [{ note: "internal-note" }], dataConfidence: { private: true } });
  const result = await loadPremierePageData(null, now, f.sources);
  assert.deepEqual(Object.keys(result.announcements[0]).sort(), ["coverUrl", "description", "id", "releaseDate", "slug", "title", "trackCount", "type"].sort());
  assert.doesNotMatch(JSON.stringify(result), /private|internal-note|priceCents|recipientEmail|masterAssetId/);
});
test("premiere public page: closed feature reads nothing and infrastructure failures remain failures", async () => {
  const f = pageFixture(); f.sources.enabled = () => false;
  assert.deepEqual(await loadPremierePageData(actor, now, f.sources), { announcements: [], memberPremieres: [] });
  assert.deepEqual(f.calls, { public: 0, announcements: 0, members: 0 });
  const unavailable = pageFixture(); unavailable.sources.announcements = async () => { throw Error("SYNTHETIC_UNAVAILABLE"); };
  await assert.rejects(loadPremierePageData(null, now, unavailable.sources), /SYNTHETIC_UNAVAILABLE/);
});

function repositoryFixture() {
  const projectId = randomUUID(), trackId = randomUUID(), reviewer = { id: randomUUID(), ...actor, role: "ADMIN" };
  const asset = (mimeType: string, durationMs: number, preview = false) => ({ id: randomUUID(), mimeType,
    visibility: preview ? "PUBLIC" : "PRIVATE", rightsStatus: "CLEARED", type: preview ? "AUDIO_PREVIEW" : "AUDIO_MASTER",
    durationMs, sizeBytes: 4096n, checksumSha256: "a".repeat(64), storageKey: `digital/studio/${randomUUID()}/${randomUUID()}.mp3` });
  const wav = asset("audio/wav", 180_000), mp3 = asset("audio/mpeg", 180_000), preview = asset("audio/mpeg", 59_000, true);
  const master = { id: randomUUID(), trackId, version: 1, status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION,
    mp3BitrateKbps: 320, masterAssetId: wav.id, masterAsset: wav, mp3AssetId: mp3.id, mp3Asset: mp3,
    previewAssetId: preview.id, previewAsset: preview, previewStartMs: 0, previewDurationMs: 59_000,
    track: { projectId, title: "Titre QA", status: "RELEASED", project: { status: "PUBLISHED", publicVisible: true } } };
  const cover = { id: randomUUID(), type: "COVER", checksumSha256: "e".repeat(64), visibility: "PUBLIC", rightsStatus: "CLEARED" };
  const project = { id: projectId, slug: "annonce-qa", title: "Annonce QA", type: "SINGLE", status: "PUBLISHED", publicVisible: true,
    membersPreviewEnabled: true, releaseDate: new Date("2026-12-01T00:00:00Z"), assets: [{ assetId: cover.id, asset: cover }],
    digitalOffers: [{ active: false }], tracks: [{ id: trackId, title: "Titre QA", position: 1, status: "RELEASED", digitalMasters: [master] }] };
  const proof = { policy: DIGITAL_RIGHTS_REVIEW_POLICY, binding: digitalRightsMasterBinding(master), status: "APPROVED",
    privateEvidenceReference: "private-evidence:synthetic/premiere-page", evidenceSha256: "b".repeat(64), attestation: DIGITAL_RIGHTS_ATTESTATION,
    reason: null, reviewedAt: now.toISOString(), requestHash: "d".repeat(64) };
  const rights = { id: randomUUID(), actorId: reviewer.id, kind: DIGITAL_RIGHTS_REVIEW_EVENT, createdAt: now,
    details: { ...proof, recordHash: digitalRightsReviewHash({ actorId: reviewer.id, ...proof }) } };
  let receipt: { actorId: string; details: { projectId: string; premiereBinding: string } } | null = null;
  const queries: unknown[] = [];
  const db = {
    project: { findMany: async (query: unknown) => { queries.push(query); return [project]; } },
    digitalEvent: { findFirst: async ({ where }: { where: { kind: string } }) => where.kind === MEMBER_PREMIERE_EVENT ? receipt : rights },
    digitalMaster: { findMany: async () => [master] },
    user: { findUnique: async () => reviewer, findMany: async () => [reviewer] },
    $queryRaw: async (parts: TemplateStringsArray) => parts.join("?").includes("dcn-excerpt-current-masters")
      ? [{ trackId, id: master.id }] : [syntheticExistingExcerptApproval(master, reviewer.id)],
  };
  return { project, master, queries, db: db as unknown as Prisma.TransactionClient,
    publish: () => { receipt = { actorId: reviewer.id, details: { projectId, premiereBinding: memberPremiereBinding(project) } }; } };
}
test("premiere announcement source: exact publication receipt is required, output contains metadata only", async () => {
  const f = repositoryFixture();
  assert.deepEqual(await listPublishedPremiereAnnouncements(f.db, now), []);
  f.publish();
  const result = await listPublishedPremiereAnnouncements(f.db, now);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { id: f.project.id, slug: f.project.slug, title: f.project.title, type: "SINGLE", releaseDate: "2026-12-01",
    trackCount: 1, coverUrl: `/media/catalog/${f.project.assets[0].assetId}` });
  const serialized = JSON.stringify(result);
  for (const forbidden of ["binding", "tracks", "previewUrl", "storageKey", f.master.id, f.master.masterAssetId, f.master.mp3AssetId, f.master.previewAssetId]) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.deepEqual(f.project.digitalOffers, [{ active: false }]);
});
test("premiere announcement source: private, stale or revoked exact version is never shown publicly", async () => {
  for (const change of ["private", "title", "date", "cover", "rights", "disabled", "past"] as const) {
    const f = repositoryFixture(); f.publish();
    if (change === "private") f.project.publicVisible = false;
    if (change === "title") f.project.title += " changé";
    if (change === "date") f.project.releaseDate = new Date("2027-01-01T00:00:00Z");
    if (change === "cover") f.project.assets[0].asset.checksumSha256 = "f".repeat(64);
    if (change === "rights") f.master.previewAsset.rightsStatus = "REJECTED";
    if (change === "disabled") f.project.membersPreviewEnabled = false;
    if (change === "past") f.project.releaseDate = new Date("2026-01-01T00:00:00Z");
    assert.deepEqual(await listPublishedPremiereAnnouncements(f.db, now), [], change);
  }
});
