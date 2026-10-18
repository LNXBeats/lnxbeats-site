import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";
import { assertDigitalUuid, DigitalError, requireDigitalEnvironment } from "./domain";
import { digitalCommercialAudioReady } from "./formats";
import { digitalRightsMasterBinding, digitalRightsReviewHash } from "./rights-review-policy";
import { loadDigitalRightsReviews, recordDigitalRightsReviews } from "./rights-review-service";
import { digitalExcerptMasterInclude, getCurrentDigitalExcerptMaster, loadDigitalExcerptSelection, recordDigitalExcerptSelection, requireDigitalExcerptAdmin } from "./excerpt-service";
import { GROUP_LISTEN_RECEIPT, GROUP_ORIGINAL_DECLARATION, issueListeningTicket, listeningCoverage, listeningReceiptValid, originalFacts, ownerOriginalConfirmation, artisticProvenance, requiresParticularRightsCase, reviewAttested, reviewMasterIds, reviewObject, verifyListeningTicket } from "./group-review-policy";
type DB = Prisma.TransactionClient;
function enabled() { requireDigitalEnvironment(); if (process.env.DCN_GROUP_REVIEW_ENABLED !== "true") throw new DigitalError("GROUP_REVIEW_UNAVAILABLE", 503); }
function binding(master: Parameters<typeof digitalRightsMasterBinding>[0] & { previewStartMs: number; previewDurationMs: number | null }) {
  return digitalRightsReviewHash({ ...digitalRightsMasterBinding(master), durationMs: master.masterAsset.durationMs, previewDurationMs: master.previewDurationMs, previewStartMs: master.previewStartMs });
}
async function projectForReview(db: DB, actor: OrderActor, id: string, writing = false) {
  await requireDigitalExcerptAdmin(db, actor.id); assertDigitalUuid(id);
  const p = await db.project.findUnique({ where: { id }, include: { digitalOffers: { select: { active: true } } } });
  if (!p || !["ALBUM", "SINGLE"].includes(p.type)) throw new DigitalError("NOT_FOUND", 404);
  // Append-only decisions do not edit an active offer or an acquired edition.
  void writing;
  return p;
}
async function currentMaster(db: DB, projectId: string, id: string) {
  const m = await getCurrentDigitalExcerptMaster(db, id);
  if (m.track.projectId !== projectId || !digitalCommercialAudioReady(m)) throw new DigitalError("EXCERPT_NOT_READY", 409);
  return m;
}
async function receipt(db: DB, actorId: string, master: Awaited<ReturnType<typeof currentMaster>>) {
  const events = await db.digitalEvent.findMany({ where: { kind: GROUP_LISTEN_RECEIPT, actorId, details: { path: ["masterId"], equals: master.id } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10, select: { id: true, details: true } });
  return events.find(e => listeningReceiptValid(e.details, actorId, master.id, binding(master))) ?? null;
}
/** Private, safe DTO; no storage paths or confidential document contents. */
export async function loadGroupReview(actor: OrderActor, projectId: string, db: DB = prisma) {
  enabled(); const p = await projectForReview(db, actor, projectId);
  const data = await db.project.findUniqueOrThrow({ where: { id: p.id }, include: {
    credits: true, digitalOffers: { select: { trackId: true, scope: true, priceCents: true, active: true } }, assets: { where: { role: "COVER" }, orderBy: [{ position: "asc" }, { createdAt: "desc" }], take: 1, include: { asset: true } },
    tracks: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { credits: true, digitalMasters: { orderBy: { version: "desc" }, take: 1, include: digitalExcerptMasterInclude } } } } });
  const masters = data.tracks.flatMap(t => t.digitalMasters), reviews = await loadDigitalRightsReviews(db, masters);
  const tracks = [];
  for (const t of data.tracks) {
    const m = t.digitalMasters[0], ready = !!m && digitalCommercialAudioReady(m), selection = ready ? await loadDigitalExcerptSelection(db, m).catch(() => null) : null;
    const heard = ready ? await receipt(db, actor.id, m) : null;
    const offer = data.digitalOffers.find(o => o.scope === "TRACK" && o.trackId === t.id);
    tracks.push({ id: t.id, title: t.title, position: t.position, masterId: m?.id ?? null, version: m?.version ?? null, ready,
      durationMs: m?.masterAsset.durationMs ?? null, previewDurationMs: m?.previewDurationMs ?? null, previewStartMs: m?.previewStartMs ?? null,
      previewUrl: ready && m.previewAssetId ? `/api/admin/digital/previews/${m.previewAssetId}` : null,
      sourceFormat: m?.codec === "wav" ? "WAV" as const : m?.codec === "mp3" ? "MP3" as const : null,
      sourceSha256: m?.masterAsset.checksumSha256 ?? null,
      wavSha256: m?.codec === "wav" ? m.masterAsset.checksumSha256 : null, mp3Sha256: m?.mp3Asset?.checksumSha256 ?? null, previewSha256: m?.previewAsset?.checksumSha256 ?? null,
      bindingHash: ready ? binding(m) : null,
      priceCents: offer?.priceCents ?? null, offerActive: offer?.active ?? false,
      selection, listened: !!heard, receiptId: heard?.id ?? null, review: reviews.find(r => r.masterId === m?.id) ?? null,
      credits: t.credits.map(c => ({ name: c.name, role: c.role, confidence: c.confidence })) });
  }
  return { id: p.id, slug: p.slug, title: p.title, type: p.type, protectedLive: false, hasActiveOffers: p.digitalOffers.some(o => o.active),
    cover: data.assets[0] ? { url: `/api/admin/digital/covers/${data.assets[0].asset.id}`, rights: data.assets[0].asset.rightsStatus } : null,
    credits: data.credits.map(c => ({ name: c.name, role: c.role, confidence: c.confidence })), tracks };
}
export type GroupReviewView = Awaited<ReturnType<typeof loadGroupReview>>;

/** Only append-only reviews. No master, offer, acquisition or file is updated. */
export async function mutateGroupReview(actor: OrderActor, raw: unknown) {
  enabled(); const input = reviewObject(raw); assertDigitalUuid(input.projectId);
  const projectId = input.projectId;
  return prisma.$transaction(async db => {
    await projectForReview(db, actor, projectId, true);
    if (input.operation === "listen-start") {
      assertDigitalUuid(input.masterId); const m = await currentMaster(db, projectId, input.masterId);
      return { ticket: issueListeningTicket(actor.id, m.id, binding(m), process.env.AUTH_SECRET), durationMs: m.previewDurationMs };
    }
    if (input.operation === "listen-finish") {
      assertDigitalUuid(input.masterId); const m = await currentMaster(db, projectId, input.masterId);
      const ticket = verifyListeningTicket(input.ticket, actor.id, m.id, binding(m), m.previewDurationMs!, process.env.AUTH_SECRET);
      const coverageMs = listeningCoverage(input.playedRangesMs, m.previewDurationMs!);
      const externalKey = `dcn-listened:${ticket.nonce}`, record = { kind: GROUP_LISTEN_RECEIPT, actorId: actor.id, masterId: m.id, bindingHash: binding(m), durationMs: m.previewDurationMs, coverageMs,
        browserReportedCoverage: true, startedAt: ticket.startedAt, source: "BROWSER_PLAYBACK_PLUS_PERSONAL_ATTESTATION_REQUIRED" };
      const details = { ...record, recordHash: digitalRightsReviewHash(record) }, old = await db.digitalEvent.findUnique({ where: { externalKey }, select: { id: true, actorId: true, details: true } });
      if (old && (old.actorId !== actor.id || !listeningReceiptValid(old.details, actor.id, m.id, binding(m)))) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409);
      const result = old ?? await db.digitalEvent.create({ data: { kind: GROUP_LISTEN_RECEIPT, actorId: actor.id, externalKey, details }, select: { id: true } });
      return { receiptId: result.id, listened: true, artisticValidated: false };
    }
    const ids = reviewMasterIds(input.masterIds); assertDigitalUuid(input.idempotencyKey); reviewAttested(input.attested);
    let masters = await Promise.all(ids.map(id => currentMaster(db, projectId, id)));
    const expectedBindings = input.expectedBindings;
    const checkBindings = () => {
      if (!Array.isArray(expectedBindings) || expectedBindings.length !== ids.length || new Set(expectedBindings.map(e => reviewObject(e).masterId)).size !== ids.length
        || masters.some(m => !expectedBindings.some(e => e.masterId === m.id && e.bindingHash === binding(m)))) throw new DigitalError("EXCERPT_MASTER_CHANGED", 409);
    };
    if (input.operation === "original-rights") {
      for (const id of ids) await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-rights-master:${id}`})) IS NULL AS locked`;
      for (const id of [...new Set(masters.map(m => m.trackId))].sort()) await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${id}`})) IS NULL AS locked`;
      masters = await Promise.all(ids.map(id => currentMaster(db, projectId, id))); checkBindings();
      const credits = await db.credit.findMany({ where: { OR: [{ projectId, trackId: null }, { trackId: { in: masters.map(m => m.trackId) } }] }, select: { role: true } });
      const prior = await loadDigitalRightsReviews(db, masters);
      if (requiresParticularRightsCase(credits.map(c => c.role), masters.flatMap(m => [m.masterAsset.rightsStatus, m.mp3Asset?.rightsStatus ?? "", m.previewAsset?.rightsStatus ?? ""]), prior.map(r => r.status))) throw new DigitalError("GROUP_PARTICULAR_RIGHTS_REQUIRED", 409);
      const facts = input.operation === "original-rights" && reviewObject(input.facts).policy === "OWNER_ORIGINAL_CONFIRMATION_V1" ? ownerOriginalConfirmation(input.facts) : originalFacts(input.facts);
      const requestHash = digitalRightsReviewHash({ actorId: actor.id, projectId, ids, facts, bindings: masters.map(digitalRightsMasterBinding) });
      const externalKey = `dcn-originals:${input.idempotencyKey}`;
      const old = await db.digitalEvent.findUnique({ where: { externalKey }, select: { actorId: true, details: true } });
      const previous = old?.details as { requestHash?: string; evidenceHash?: string } | undefined;
      if (old && (old.actorId !== actor.id || previous?.requestHash !== requestHash)) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409);
      const document = { policy: GROUP_ORIGINAL_DECLARATION, actorId: actor.id, projectId, facts, bindings: masters.map(digitalRightsMasterBinding), uses: ["PRIVATE_B2C_WAV_MP3_FR_METROPOLITAN_CORSICA", "PUBLIC_BOUNDED_PREVIEW"], limitation: "Owner declaration, not independent legal approval; no automatic sale", requestHash };
      const evidenceHash = previous?.evidenceHash ?? digitalRightsReviewHash(document), reference = `private-evidence:dcn-originals/${input.idempotencyKey}`;
      if (!old) await db.digitalEvent.create({ data: { kind: GROUP_ORIGINAL_DECLARATION, actorId: actor.id, externalKey, details: { ...document, evidenceHash } } });
      const reviews = await recordDigitalRightsReviews(actor, { projectId, masterIds: ids, expectedReviews: input.expectedReviews, status: "APPROVED", privateEvidenceReference: reference,
        evidenceSha256: evidenceHash, attested: true, reason: "Déclaration personnelle groupée d’originaux contrôlés ; aucune offre activée.", idempotencyKey: input.idempotencyKey }, db);
      return { reviews, evidenceReference: reference, evidenceSha256: evidenceHash, saleActivated: false };
    }
    if (input.operation === "artistic") {
      const expected = input.expectedSelections;
      if (!Array.isArray(expected) || expected.length !== ids.length) throw new DigitalError("INVALID_GROUP_REVIEW");
      for (const e of expected) { const d = reviewObject(e); assertDigitalUuid(d.masterId); if (d.revisionId !== null) assertDigitalUuid(d.revisionId); }
      if (new Set(expected.map(e => e.masterId)).size !== ids.length || expected.some(e => !ids.includes(e.masterId))) throw new DigitalError("INVALID_GROUP_REVIEW");
      // Same group ordering as the existing engines, and one atomic transaction.
      for (const id of [...new Set(masters.map(m => m.trackId))].sort()) await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${id}`})) IS NULL AS locked`;
      for (const id of ids) await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-excerpt:${id}`})) IS NULL AS locked`;
      masters = await Promise.all(ids.map(id => currentMaster(db, projectId, id))); checkBindings();
      const provenance = artisticProvenance(input.provenance);
      const selections = [];
      for (const m of masters) {
        const heard = await receipt(db, actor.id, m);
        if (provenance === "RECORDED_PLAYBACK" && !heard) throw new DigitalError("GROUP_LISTENING_INCOMPLETE", 409);
        const result = await recordDigitalExcerptSelection(actor, m.id, { action: requireDigitalEnvironment() === "LIVE" ? "validate-current" : "validate-prepared",
          startMs: m.previewStartMs, expectedRevisionId: expected.find(e => e.masterId === m.id)!.revisionId, idempotencyKey: input.idempotencyKey, attested: true,
          provenance, receiptId: provenance === "RECORDED_PLAYBACK" ? heard!.id : null }, db);
        selections.push({ masterId: m.id, selection: result.selection });
      }
      return { selections, saleActivated: false };
    }
    throw new DigitalError("INVALID_GROUP_REVIEW");
  }, { timeout: 30_000 });
}
