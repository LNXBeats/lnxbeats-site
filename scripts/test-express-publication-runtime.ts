/** Existing isolated synthetic QA only; no real catalogue, financial calls or audio re-encoding. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
const cfg = JSON.parse(await fs.readFile(".private/express-qa.json", "utf8")), url = new URL(cfg.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55522"); assert.equal(url.pathname, "/lnx_dcn_v12_express_test_20261017");
for (const key of Object.keys(process.env)) if (/STRIPE|PAYPAL|RESEND|AWS|R2|S3|RAILWAY|DATABASE_URL|AUTH_SECRET/.test(key)) delete process.env[key];
Object.assign(process.env, cfg, { DCN_GROUP_REVIEW_ENABLED: "true" });
globalThis.fetch = async () => { throw Error("EXTERNAL_NETWORK_FORBIDDEN"); };
const { prisma } = await import("@/lib/prisma"), { saveExpressDraft, loadExpressProject, publishExpressProject } = await import("@/lib/digital/express-service"),
  { loadGroupReview, mutateGroupReview } = await import("@/lib/digital/group-review-service"), { saveOffer, selections } = await import("@/lib/digital/catalog");
const results: Record<string, string> = {}, run = randomUUID();
try {
  const actorUser = await prisma.user.create({ data: { email: `publication-${run}@example.invalid`, role: "ADMIN", status: "ACTIVE", emailVerified: true, displayName: "Synthetic publication test" } });
  const actor = { id: actorUser.id, email: actorUser.email, name: actorUser.displayName, role: "ADMIN" as const, status: "ACTIVE" as const, emailVerified: true as const };
  const input = { projectId: null, expectedUpdatedAt: null, title: `QA publication correction ${run}`, type: "ALBUM", tracks: [1, 2].map(i => ({ id: null, title: `Synthetic ${i}`, priceCents: i === 1 ? 149 : 129, expectedOfferVersion: 0 })), albumPriceCents: 1190, expectedAlbumOfferVersion: 0, idempotencyKey: randomUUID() };
  const saved = await saveExpressDraft(actor, input); assert.equal((await saveExpressDraft(actor, input)).duplicate, true); results.DRAFT_REPLAY_NO_DUPLICATE = "PASS";
  let p = await loadExpressProject(saved.projectId);
  await assert.rejects(publishExpressProject(actor, { projectId: p.id, reviewToken: p.reviewToken, confirmed: true, idempotencyKey: randomUUID() }), { code: "SALE_REQUIREMENTS" }); results.MISSING_FILES_PUBLICATION_REFUSED = "PASS";
  const source = await prisma.digitalMaster.findFirstOrThrow({ where: { status: "READY", codec: "wav", track: { project: { title: { startsWith: "QA —" } } } }, include: { masterAsset: true, mp3Asset: true, previewAsset: true } });
  for (const track of p.tracks) {
    const ids: string[] = [];
    for (const asset of [source.masterAsset, source.mp3Asset!, source.previewAsset!]) {
      const id = randomUUID(); ids.push(id);
      // Metadata fixtures reference already-tested synthetic bytes, never a real music master.
      await prisma.asset.create({ data: { id, type: asset.type, filename: `SYNTHETIC-${asset.filename}`, storageKey: `qa-publication-metadata-only/${id}`, storageBackend: "LOCAL", storageProvider: "local", visibility: asset.visibility, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, durationMs: asset.durationMs, checksumSha256: asset.checksumSha256, rightsStatus: "PENDING", confidence: "CONFIRMED" } });
    }
    await prisma.digitalMaster.create({ data: { trackId: track.id, version: 1, masterAssetId: ids[0], mp3AssetId: ids[1], previewAssetId: ids[2], codec: "wav", status: "READY", encoderVersion: source.encoderVersion, mp3BitrateKbps: 320, previewStartMs: 0, previewDurationMs: source.previewDurationMs } });
  }
  const sourceCover = await prisma.projectAsset.findFirstOrThrow({ where: { role: "COVER", project: { title: { startsWith: "QA —" } } }, include: { asset: true } });
  await prisma.projectAsset.create({ data: { projectId: p.id, assetId: sourceCover.assetId, role: "COVER" } });
  let view = await loadGroupReview(actor, p.id);
  const rights = { projectId: p.id, operation: "original-rights", masterIds: view.tracks.map(t => t.masterId), expectedBindings: view.tracks.map(t => ({ masterId: t.masterId, bindingHash: t.bindingHash })), expectedReviews: view.tracks.map(t => ({ masterId: t.masterId, reviewId: t.review?.reviewId ?? null })), facts: { policy: "OWNER_ORIGINAL_CONFIRMATION_V1", confirmed: true }, attested: true, idempotencyKey: randomUUID() };
  await mutateGroupReview(actor, rights); await mutateGroupReview(actor, rights); view = await loadGroupReview(actor, p.id); assert(view.tracks.every(t => t.review?.status === "APPROVED")); results.PERSONAL_CONFIRMATION_INTERNAL_PROOF_AND_IDEMPOTENCE = "PASS";
  const art = { projectId: p.id, operation: "artistic", masterIds: view.tracks.map(t => t.masterId), expectedBindings: view.tracks.map(t => ({ masterId: t.masterId, bindingHash: t.bindingHash })), expectedSelections: view.tracks.map(t => ({ masterId: t.masterId, revisionId: t.selection?.revisionId ?? null })), provenance: "OWNER_DECLARED", attested: true, idempotencyKey: randomUUID() };
  await mutateGroupReview(actor, art); await mutateGroupReview(actor, art); view = await loadGroupReview(actor, p.id); assert(view.tracks.every(t => t.selection?.status === "VALIDATED" && !t.listened)); results.DECLARED_ARTISTIC_APPROVAL_NO_FABRICATED_LISTENING = "PASS";
  p = await loadExpressProject(p.id); assert.deepEqual(p.blockers, []);
  await prisma.project.update({ where: { id: p.id }, data: { status: "PUBLISHED", publicVisible: true } }); await prisma.track.update({ where: { id: p.tracks[0].id }, data: { status: "RELEASED" } });
  await saveOffer(actor, { projectId: p.id, trackId: p.tracks[0].id, priceCents: 149, expectedVersion: p.tracks[0].offer!.version, active: true, rightsConfirmed: true, distribution: "UNRELEASED" });
  // A released subset may never turn into a truncated saleable album.
  p = await loadExpressProject(p.id); await assert.rejects(saveOffer(actor, { projectId: p.id, trackId: null, priceCents: 1190, expectedVersion: p.albumOffer!.version, active: true, rightsConfirmed: true, distribution: "UNRELEASED" }), { code: "NO_READY_MASTER" }); results.NO_TRUNCATED_ALBUM_WITH_ANNOUNCED_TRACK = "PASS";
  const oldReviews = view.tracks.map(t => [t.review?.reviewId, t.selection?.revisionId]);
  const edit = { projectId: p.id, expectedUpdatedAt: p.updatedAt, title: p.title, type: p.type, tracks: p.tracks.map((t, i) => ({ id: t.id, title: t.title, priceCents: i === 0 ? 159 : t.offer!.priceCents!, expectedOfferVersion: t.offer!.version })), albumPriceCents: 1190, expectedAlbumOfferVersion: p.albumOffer!.version, idempotencyKey: randomUUID() };
  await saveExpressDraft(actor, edit); assert.equal((await saveExpressDraft(actor, edit)).duplicate, true); p = await loadExpressProject(p.id); assert.equal(p.tracks[0].offer!.active, true); assert.equal(p.tracks[0].offer!.priceCents, 159); assert.equal(p.tracks[1].offer!.active, false);
  view = await loadGroupReview(actor, p.id); assert.deepEqual(view.tracks.map(t => [t.review?.reviewId, t.selection?.revisionId]), oldReviews); results.PARTIALLY_ACTIVE_SAVE_PRESERVES_SALES_RIGHTS_AND_ARTISTIC = "PASS";
  const publish = { projectId: p.id, reviewToken: p.reviewToken, confirmed: true, idempotencyKey: randomUUID() };
  await publishExpressProject(actor, publish); assert.equal((await publishExpressProject(actor, publish)).duplicate, true); p = await loadExpressProject(p.id); assert(p.tracks.every(t => t.offer?.active)); assert.equal(p.albumOffer!.active, true);
  const sale = await selections([p.albumOffer!.id]); assert.equal(sale[0].tracks.length, 2); assert.equal(sale[0].priceCents, 1190); assert.equal((await selections([p.tracks[0].offer!.id]))[0].priceCents, 159); results.COMPLETE_ALBUM_PUBLICATION_AND_SERVER_CART_COHERENCE = "PASS";
  results.FINANCIAL_CALLS = "0";
  const out = "/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/DCN_PUBLICATION_DEBLOCAGE_20261018";
  await fs.writeFile(out + "/proofs/RUNTIME.json", JSON.stringify({ at: new Date().toISOString(), results, projectId: p.id, scope: "Isolated PostgreSQL synthetic fixture; media metadata only, not a new real audio test", recoveryWrites: 0, productionWrites: 0 }, null, 2), { mode: 0o600 }); console.log(JSON.stringify(results));
} finally { await prisma.$disconnect(); }
