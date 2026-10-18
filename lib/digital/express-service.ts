import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { createCatalogProjectInTransaction, addCatalogTrackInTransaction, addCatalogCreditInTransaction } from "@/lib/catalog/service";
import { normalizeCatalogSlug } from "@/lib/catalog/lifecycle";
import { catalogArtistAlreadyDocumented } from "@/lib/catalog/artist-identity";
import { DigitalError, assertDigitalUuid, requireDigitalEnvironment } from "./domain";
import { EXPRESS_DEFAULTS, expressDefaults, expressDraft } from "./express-policy";
import { saveOfferInTransaction, selections } from "./catalog";
import { digitalCommercialAudioReady } from "./formats";
import { loadDigitalRightsReviews } from "./rights-review-service";
import { loadDigitalExcerptSelection, requireDigitalExcerptAdmin } from "./excerpt-service";
import { requiresParticularRightsCase } from "./group-review-policy";
import { loadGroupReview, mutateGroupReview } from "./group-review-service";
import { OWNER_PUBLICATION_POLICY } from "./owner-declaration";

type DB = Prisma.TransactionClient;
const include = { tracks: { orderBy: { position: "asc" as const }, include: { credits: true, digitalMasters: { orderBy: { version: "desc" as const }, take: 1, include: { masterAsset: true, mp3Asset: true, previewAsset: true } } } },
  digitalOffers: true, credits: true, assets: { where: { role: "COVER" as const }, orderBy: [{ position: "asc" as const }, { createdAt: "desc" as const }], take: 1, include: { asset: true } } };
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function loadExpressDefaults(db: DB = prisma) {
  const event = await db.digitalEvent.findFirst({ where: { kind: "MUSIC_EXPRESS_DEFAULTS" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  return event ? expressDefaults(event.details) : { ...EXPRESS_DEFAULTS };
}
export async function addExpressArtist(actor: OrderActor, input: { projectId: string; name: string }) {
  requireDigitalEnvironment(); assertDigitalUuid(input.projectId);
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 180) throw new DigitalError("EXPRESS_INVALID");
  return prisma.$transaction(async db => {
    await requireDigitalExcerptAdmin(db, actor.id);
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-project:${input.projectId}`})) IS NULL AS locked`;
    if (!await db.project.findUnique({ where: { id: input.projectId } })) throw new DigitalError("NOT_FOUND", 404);
    if (await db.digitalOffer.findFirst({ where: { projectId: input.projectId, active: true } })) throw new DigitalError("EXPRESS_ACTIVE_OFFER", 409);
    const existing = await db.credit.findMany({ where: { projectId: input.projectId, role: "ARTIST" }, select: { name: true, role: true } });
    if (!catalogArtistAlreadyDocumented(existing, input.name)) {
      const credit = await addCatalogCreditInTransaction(db, input.projectId, { name: input.name, role: "artist", note: "Nom artistique explicitement renseigné en Admin Express ; ne démontre pas les droits d’auteur, d’interprétation ou de master." });
      await db.digitalEvent.create({ data: { kind: "MUSIC_EXPRESS_ARTIST_CREDIT", actorId: actor.id, details: { projectId: input.projectId, creditId: credit.id } } });
    }
    return loadExpressProject(input.projectId, db);
  });
}
export async function saveExpressDefaults(actor: OrderActor, raw: unknown) {
  requireDigitalEnvironment(); const defaults = expressDefaults(raw);
  return prisma.$transaction(async db => {
    await requireDigitalExcerptAdmin(db, actor.id);
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('music-express-defaults')) IS NULL AS locked`;
    const previous = await db.digitalEvent.findFirst({ where: { kind: "MUSIC_EXPRESS_DEFAULTS" }, orderBy: { createdAt: "desc" } });
    await db.digitalEvent.create({ data: { kind: "MUSIC_EXPRESS_DEFAULTS", actorId: actor.id, details: defaults, createdAt: new Date(Math.max(Date.now(), (previous?.createdAt.getTime() ?? 0) + 1)) } });
    return defaults;
  });
}
export async function loadExpressProject(id: string, db: DB = prisma) {
  assertDigitalUuid(id);
  const p = await db.project.findUnique({ where: { id }, include });
  if (!p) throw new DigitalError("NOT_FOUND", 404);
  const masters = p.tracks.flatMap(t => t.digitalMasters), reviews = await loadDigitalRightsReviews(db, masters);
  const tracks = [];
  for (const t of p.tracks) {
    const m = t.digitalMasters[0], offer = p.digitalOffers.find(o => o.trackId === t.id), excerpt = m ? await loadDigitalExcerptSelection(db, m).catch(() => null) : null;
    const review = reviews.find(r => r.masterId === m?.id) ?? null;
    const rightsAtPublication = !!m && digitalCommercialAudioReady(m) && !requiresParticularRightsCase([...p.credits, ...t.credits].map(c => c.role), [m.masterAsset, m.mp3Asset, m.previewAsset].flatMap(a => a ? [a.rightsStatus] : []), review ? [review.status] : []);
    tracks.push({ id: t.id, title: t.title, position: t.position, durationSeconds: t.durationSeconds, durationMs: m?.masterAsset.durationMs ?? null, publication: t.status,
      version: m?.version ?? 0, masterId: m?.id ?? null, previewStartMs: m?.previewStartMs ?? 0, previewDurationMs: m?.previewDurationMs ?? null,
      previewUrl: m?.previewAssetId ? `/api/admin/digital/previews/${m.previewAssetId}` : null, strictReady: !!m && digitalCommercialAudioReady(m),
      formats: !m ? "Aucun fichier" : m.codec === "mp3" ? "MP3 source uniquement — WAV original requis" : m.mp3AssetId ? "WAV + MP3" : "WAV — MP3 à préparer",
      review, rightsAtPublication, artisticStatus: excerpt?.status ?? "TO_LISTEN",
      offer: offer ? { id: offer.id, priceCents: offer.priceCents, version: offer.version, active: offer.active, rightsConfirmed: offer.rightsConfirmed, distribution: offer.distribution } : null });
  }
  const cover = p.assets[0]?.asset, album = p.digitalOffers.find(o => o.scope === "ALBUM");
  const blockers = [
    ...(p.status === "ARCHIVED" ? ["Projet archivé : revue préalable dans le Catalogue"] : []),
    ...(p.tracks.some(t => t.status === "UNLISTED") ? ["Pistes non listées : confirmez leur inclusion dans le Catalogue avant publication"] : []),
    ...(!cover || cover.rightsStatus !== "CLEARED" ? ["Pochette et droits de publication à vérifier"] : []),
    ...tracks.flatMap(t => [!t.strictReady ? `${t.title} : WAV/MP3/extrait requis` : "", t.review?.status !== "APPROVED" && !t.rightsAtPublication ? `${t.title} : droits particuliers de cette version à vérifier` : "", t.artisticStatus !== "VALIDATED" ? `${t.title} : extrait à écouter et valider` : "", !t.offer?.priceCents ? `${t.title} : prix à renseigner` : ""].filter(Boolean)),
    ...(p.type === "ALBUM" && !album?.priceCents ? ["Prix de l’album à renseigner"] : []),
    ...(p.type !== "SINGLE" && p.type !== "ALBUM" ? ["Projet expert : publication depuis le Catalogue"] : []),
    ...(p.type === "SINGLE" && p.tracks.length !== 1 ? ["Le single doit contenir une seule piste"] : []),
  ];
  const result = { id: p.id, slug: p.slug, title: p.title, type: p.type, updatedAt: p.updatedAt.toISOString(), status: p.status, publicVisible: p.publicVisible,
    cover: cover ? { id: cover.id, url: `/api/admin/digital/covers/${cover.id}`, alt: cover.alt ?? p.title } : null,
    tracks, credits: p.credits.map(c => ({ name: c.name, role: c.role })), albumOffer: album ? { id: album.id, priceCents: album.priceCents, version: album.version, active: album.active } : null, blockers };
  return { ...result, reviewToken: hash(result) };
}
/** Private technical inventory, deliberately distinct from legal ownership evidence. */
export async function loadExpressManifest(projectId: string) {
  assertDigitalUuid(projectId);
  const p = await prisma.project.findUnique({ where: { id: projectId }, include });
  if (!p) throw new DigitalError("NOT_FOUND", 404);
  const manifest = { kind: "TECHNICAL_INVENTORY_NOT_INDEPENDENT_IP_PROOF", projectId: p.id, title: p.title,
    tracks: p.tracks.map(t => ({ trackId: t.id, title: t.title, versions: t.digitalMasters.map(m => ({ masterId: m.id, version: m.version, codec: m.codec,
      files: [m.masterAsset, m.mp3Asset, m.previewAsset].filter(a => !!a).map(a => ({ assetId: a.id, format: a.mimeType, sha256: a.checksumSha256, durationMs: a.durationMs, visibility: a.visibility })) })) })) };
  return { manifest, sha256: hash(manifest) };
}
export async function saveExpressDraft(actor: OrderActor, raw: unknown) {
  requireDigitalEnvironment(); const input = expressDraft(raw), requestHash = hash(input), externalKey = `music-express-save:${input.idempotencyKey}`;
  return prisma.$transaction(async db => {
    await requireDigitalExcerptAdmin(db, actor.id);
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${externalKey})) IS NULL AS locked`;
    const previous = await db.digitalEvent.findUnique({ where: { externalKey } });
    if (previous) {
      const details = previous.details as { requestHash: string; projectId: string };
      if (previous.actorId !== actor.id || details.requestHash !== requestHash) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409);
      return { projectId: details.projectId, duplicate: true };
    }
    let projectId = input.projectId;
    if (!projectId) {
      // Same lock as Catalogue creation; a retry or alternate tab cannot create a second project.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('catalog-project-creation')) IS NULL AS locked`;
      if (await db.project.findFirst({ where: { OR: [{ title: { equals: input.title, mode: "insensitive" } }, { slug: normalizeCatalogSlug(input.title) }] } })) throw new DigitalError("EXPRESS_DUPLICATE", 409);
      const p = await createCatalogProjectInTransaction(db, { title: input.title, slug: normalizeCatalogSlug(input.title), type: input.type.toLowerCase(), status: "draft", publicVisible: false });
      projectId = p.id;
    }
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-project:${projectId}`})) IS NULL AS locked`;
    const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { tracks: true, digitalOffers: true } });
    if (input.projectId && (p.updatedAt.toISOString() !== input.expectedUpdatedAt || p.type !== input.type)) throw new DigitalError("EXPRESS_CHANGED", 409);
    // Saving draft prices must not silently edit the public catalogue identity.
    if ((p.status === "PUBLISHED" || p.digitalOffers.some(o => o.active)) && (input.title !== p.title || input.tracks.length !== p.tracks.length || input.tracks.some((t,i) => !p.tracks.some(old => old.id === t.id && old.title === t.title && old.position === i+1)))) throw new DigitalError("EXPRESS_PUBLIC_METADATA", 409);
    if (p.tracks.some(t => !input.tracks.some(row => row.id === t.id))) throw new DigitalError("EXPRESS_TRACK_REMOVAL", 409);
    if (input.tracks.some(t => t.id && !p.tracks.some(row => row.id === t.id))) throw new DigitalError("NOT_FOUND", 404);
    // Temporary positions avoid unique-key collisions when reordering; no track is deleted.
    const offset = Math.max(0, ...p.tracks.map(t => t.position)) + input.tracks.length + 1;
    for (let i = 0; i < p.tracks.length; i++) await db.track.update({ where: { id: p.tracks[i].id }, data: { position: offset + i } });
    const ids: string[] = [];
    for (const t of input.tracks) {
      const row = t.id ? await db.track.update({ where: { id: t.id }, data: { title: t.title } }) : await addCatalogTrackInTransaction(db, projectId, { title: t.title, status: "announced", durationSeconds: "" });
      ids.push(row.id);
    }
    for (let i = 0; i < ids.length; i++) await db.track.update({ where: { id: ids[i] }, data: { position: i + 1 } });
    for (let i = 0; i < ids.length; i++) {
      const current = p.digitalOffers.find(o => o.trackId === ids[i]);
      await saveOfferInTransaction(db, actor, { projectId, trackId: ids[i], priceCents: input.tracks[i].priceCents, expectedVersion: input.tracks[i].expectedOfferVersion, active: current?.active ?? false, rightsConfirmed: current?.rightsConfirmed ?? false, distribution: current?.distribution ?? "UNRELEASED" }, true);
    }
    if (input.type === "ALBUM") {
      const current = p.digitalOffers.find(o => o.scope === "ALBUM");
      await saveOfferInTransaction(db, actor, { projectId, trackId: null, priceCents: input.albumPriceCents, expectedVersion: input.expectedAlbumOfferVersion, active: current?.active ?? false, rightsConfirmed: current?.rightsConfirmed ?? false, distribution: current?.distribution ?? "UNRELEASED" }, true);
    }
    await db.project.update({ where: { id: projectId }, data: { title: input.title, trackCount: ids.length } });
    await db.digitalEvent.create({ data: { actorId: actor.id, kind: "MUSIC_EXPRESS_DRAFT", externalKey, details: { projectId, requestHash, trackIds: ids } } });
    return { projectId, duplicate: false };
  }, { timeout: 30_000 });
}
export async function publishExpressProject(actor: OrderActor, input: { projectId: string; reviewToken: string; confirmed: boolean; idempotencyKey: string; rightsDeclaration?: string }) {
  requireDigitalEnvironment(); assertDigitalUuid(input.projectId); assertDigitalUuid(input.idempotencyKey);
  if (input.confirmed !== true || !/^[a-f0-9]{64}$/.test(input.reviewToken)) throw new DigitalError("EXPRESS_CONFIRMATION_REQUIRED", 409);
  return prisma.$transaction(async db => {
    await requireDigitalExcerptAdmin(db, actor.id);
    // Same lifecycle lock order as Catalogue; cover replacement cannot race publication.
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-cover:${input.projectId}`})) IS NULL AS locked`;
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-project:${input.projectId}`})) IS NULL AS locked`;
    const key = `music-express-publish:${input.idempotencyKey}`, previous = await db.digitalEvent.findUnique({ where: { externalKey: key } });
    if (previous) {
      const details = previous.details as { projectId: string; reviewToken: string };
      if (previous.actorId !== actor.id || details.projectId !== input.projectId || details.reviewToken !== input.reviewToken) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409);
      return { ok: true, duplicate: true };
    }
    const prepared = await db.project.findUniqueOrThrow({ where: { id: input.projectId }, include });
    // Reserve offers before rights, then rights before tracks, matching the existing
    // offer/review/excerpt engines. Whole-group sorted locks prevent album deadlocks.
    for (const offerKey of prepared.digitalOffers.map(o => `digital-offer:${prepared.id}:${o.trackId ?? "album"}`).sort()) await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${offerKey})) IS NULL AS locked`;
    for (const id of prepared.tracks.flatMap(t => t.digitalMasters.map(m => m.id)).sort()) await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-rights-master:${id}`})) IS NULL AS locked`;
    for (const id of prepared.tracks.map(t => t.id).sort()) await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${id}`})) IS NULL AS locked`;
    const review = await loadExpressProject(input.projectId, db);
    if (review.reviewToken !== input.reviewToken) throw new DigitalError("EXPRESS_CHANGED", 409);
    if (review.blockers.length) throw new DigitalError("SALE_REQUIREMENTS", 409);
    // One explicit publication confirmation, not an approval on upload/read or a
    // blanket exemption for unknown files. Existing refusals/revocations stay blocked.
    const pendingRights = review.tracks.filter(t => t.review?.status !== "APPROVED");
    if (pendingRights.length) {
      if (input.rightsDeclaration !== OWNER_PUBLICATION_POLICY) throw new DigitalError("EXPRESS_RIGHTS_CONFIRMATION_REQUIRED", 409);
      const current = await loadGroupReview(actor, input.projectId, db);
      const tracks = current.tracks.filter(t => pendingRights.some(p => p.masterId === t.masterId));
      await mutateGroupReview(actor, { operation: "original-rights", projectId: input.projectId, masterIds: tracks.map(t => t.masterId),
        expectedBindings: tracks.map(t => ({ masterId: t.masterId, bindingHash: t.bindingHash })), expectedReviews: tracks.map(t => ({ masterId: t.masterId, reviewId: t.review?.reviewId ?? null })),
        facts: { policy: "OWNER_ORIGINAL_CONFIRMATION_V1", confirmed: true }, attested: true, idempotencyKey: input.idempotencyKey }, db);
    }
    await db.project.update({ where: { id: input.projectId }, data: { status: "PUBLISHED", publicVisible: true } });
    await db.track.updateMany({ where: { projectId: input.projectId }, data: { status: "RELEASED" } });
    const p = await db.project.findUniqueOrThrow({ where: { id: input.projectId }, include: { digitalOffers: true } });
    const ids = [];
    for (const offer of p.digitalOffers.filter(o => review.type === "ALBUM" || o.scope === "TRACK")) {
      if (offer.active && offer.rightsConfirmed) ids.push(offer.id);
      else ids.push(await saveOfferInTransaction(db, actor, { projectId: p.id, trackId: offer.trackId,
        priceCents: offer.priceCents, expectedVersion: offer.version, active: true, rightsConfirmed: true, distribution: offer.distribution }));
    }
    // Authoritative sales gates, including current versions/artistic approvals/live storage. All changes roll back on refusal.
    for (const id of ids) await selections([id], db);
    await db.digitalEvent.create({ data: { kind: "MUSIC_EXPRESS_PUBLISHED", actorId: actor.id, externalKey: key, details: { projectId: p.id, reviewToken: input.reviewToken, offerIds: ids, rightsDeclaration: pendingRights.length ? OWNER_PUBLICATION_POLICY : null } } });
    return { ok: true, duplicate: false };
  }, { timeout: 30_000 });
}
