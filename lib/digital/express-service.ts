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
import { OWNER_EXCERPTS_AT_PUBLICATION_POLICY, OWNER_PUBLICATION_POLICY } from "./owner-declaration";
import { assertMemberPremiereReady, authorizeMemberPremiereExcerpts } from "@/lib/members/previews";
import { enqueueReleasePublication } from "@/lib/release-notifications/publications";
import { premiereVoteSummary } from "@/lib/members/votes";
import { memberPremiereBinding } from "@/lib/members/premiere-policy";
import { EXPRESS_OWNER_CREDIT_POLICY, expressHasCollaborationCredits, expressOwnerCreditPlan } from "./express-owner-defaults";
import { expressArtisticAtPublication } from "./express-artistic-publication";

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
  const latestDraft = await db.digitalEvent.findFirst({ where: { kind: "MUSIC_EXPRESS_DRAFT", AND: [{ details: { path: ["projectId"], equals: id } }, { OR: [{ details: { path: ["hasCollaborations"], equals: true } }, { details: { path: ["hasCollaborations"], equals: false } }] }] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { details: true } });
  const draftDetails = latestDraft?.details as { hasCollaborations?: boolean } | undefined;
  const hasCollaborations = draftDetails?.hasCollaborations === true || expressHasCollaborationCredits([...p.credits, ...p.tracks.flatMap(t => t.credits)]);
  const masters = p.tracks.flatMap(t => t.digitalMasters), reviews = await loadDigitalRightsReviews(db, masters);
  const tracks = [];
  for (const t of p.tracks) {
    const m = t.digitalMasters[0], offer = p.digitalOffers.find(o => o.trackId === t.id), excerpt = m ? await loadDigitalExcerptSelection(db, m).catch(() => null) : null;
    const review = reviews.find(r => r.masterId === m?.id) ?? null;
    const artisticAtPublication = expressArtisticAtPublication(m, excerpt, { reviewStatus: review?.status,
      assetRights: m ? [m.masterAsset, m.mp3Asset, m.previewAsset].flatMap(a => a ? [a.rightsStatus] : []) : [] });
    const rightsAtPublication = !hasCollaborations && !!m && digitalCommercialAudioReady(m) && !requiresParticularRightsCase([...p.credits, ...t.credits].map(c => c.role), [m.masterAsset, m.mp3Asset, m.previewAsset].flatMap(a => a ? [a.rightsStatus] : []), review ? [review.status] : []);
    tracks.push({ id: t.id, title: t.title, position: t.position, durationSeconds: t.durationSeconds, durationMs: m?.masterAsset.durationMs ?? null, publication: t.status,
      version: m?.version ?? 0, masterId: m?.id ?? null, previewStartMs: m?.previewStartMs ?? 0, previewDurationMs: m?.previewDurationMs ?? null,
      previewUrl: m?.previewAssetId ? `/api/admin/digital/previews/${m.previewAssetId}` : null, strictReady: !!m && digitalCommercialAudioReady(m),
      formats: !m ? "Aucun fichier" : m.codec === "mp3" ? digitalCommercialAudioReady(m) ? "MP3 uniquement — source compressée originale, sans WAV" : "MP3 source uniquement — brouillon privé non commercialisable" : m.mp3AssetId ? "WAV + MP3" : "WAV — MP3 à préparer",
      review, rightsAtPublication, artisticAtPublication, artisticStatus: excerpt?.status ?? "TO_LISTEN",
      offer: offer ? { id: offer.id, priceCents: offer.priceCents, version: offer.version, active: offer.active, rightsConfirmed: offer.rightsConfirmed, distribution: offer.distribution } : null });
  }
  const cover = p.assets[0]?.asset, album = p.digitalOffers.find(o => o.scope === "ALBUM");
  const blockers = [
    ...(p.status === "ARCHIVED" ? ["Projet archivé : revue préalable dans le Catalogue"] : []),
    ...(p.tracks.some(t => t.status === "UNLISTED") ? ["Pistes non listées : confirmez leur inclusion dans le Catalogue avant publication"] : []),
    ...(!cover ? ["Ajoutez une pochette"] : cover.rightsStatus !== "CLEARED" ? ["Droits de publication de la pochette à vérifier"] : []),
    ...tracks.flatMap(t => [!t.strictReady ? `${t.title} : fichiers audio et extrait contrôlés requis` : "", t.review?.status !== "APPROVED" && !t.rightsAtPublication ? `${t.title} : droits particuliers de cette version à vérifier` : "", t.artisticStatus !== "VALIDATED" && !t.artisticAtPublication ? `${t.title} : extrait à écouter et valider` : "", !t.offer?.priceCents ? `${t.title} : prix à renseigner` : ""].filter(Boolean)),
    ...(p.type === "ALBUM" && !album?.priceCents ? ["Prix de l’album à renseigner"] : []),
    ...(p.type !== "SINGLE" && p.type !== "ALBUM" ? ["Projet expert : publication depuis le Catalogue"] : []),
    ...(p.type === "SINGLE" && p.tracks.length !== 1 ? ["Le single doit contenir une seule piste"] : []),
  ];
  const result = { id: p.id, slug: p.slug, title: p.title, type: p.type, releaseDate: p.releaseDate?.toISOString().slice(0, 10) ?? null, membersPreviewEnabled: p.membersPreviewEnabled ?? false, updatedAt: p.updatedAt.toISOString(), status: p.status, publicVisible: p.publicVisible,
    cover: cover ? { id: cover.id, url: `/api/admin/digital/covers/${cover.id}`, alt: cover.alt ?? p.title } : null, hasCollaborations,
    tracks, credits: p.credits.map(c => ({ name: c.name, role: c.role })), albumOffer: album ? { id: album.id, priceCents: album.priceCents, version: album.version, active: album.active } : null, blockers };
  // Survey results never enter the legal/artistic review token: a visitor vote
  // cannot invalidate an Admin review or grant a publication right.
  const premiereVotes = p.membersPreviewEnabled ? await premiereVoteSummary(db, p.id, memberPremiereBinding(p)) : { up: 0, down: 0 };
  return { ...result, premiereVotes, reviewToken: hash(result) };
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
    // Enabling a private premiere cannot suspend or reinterpret existing sales.
    if (input.membersPreviewEnabled === true && !p.membersPreviewEnabled && p.digitalOffers.some(o => o.active)) throw new DigitalError("EXPRESS_ACTIVE_OFFER", 409);
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
    // A platform-release date is metadata only, never a publication schedule or
    // distributor instruction. Omitted input from older clients preserves it.
    const previousReleaseDate = p.releaseDate?.toISOString().slice(0, 10) ?? null, previousMembersPreviewEnabled = p.membersPreviewEnabled ?? false;
    // Only explicit saves of new/private Express drafts get future defaults.
    // Published identities, old catalogue entries and historical contracts are
    // never rewritten. The existing idempotency event covers the added rows too.
    const ownerCreditIds: string[] = [];
    const privateDraft = p.status === "DRAFT" && !p.publicVisible && !p.digitalOffers.some(o => o.active);
    const previousExpressDraft = input.projectId && privateDraft && input.hasCollaborations !== undefined
      ? await db.digitalEvent.findFirst({ where: { kind: "MUSIC_EXPRESS_DRAFT", details: { path: ["projectId"], equals: projectId } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { details: true } }) : null;
    const applyOwnerDefaults = !input.projectId || privateDraft && input.hasCollaborations !== undefined && !!previousExpressDraft;
    if (applyOwnerDefaults) {
      const existing = await db.credit.findMany({ where: { OR: [{ projectId }, { trackId: { in: ids } }] }, select: { name: true, role: true } });
      const collaborations = input.hasCollaborations === true || expressHasCollaborationCredits(existing);
      for (const credit of expressOwnerCreditPlan(existing, collaborations)) {
        const row = await addCatalogCreditInTransaction(db, projectId, { ...credit, role: credit.role.toLowerCase(), note: `Crédit déclaré par le propriétaire dans Admin Express (${EXPRESS_OWNER_CREDIT_POLICY}). Ne constitue pas une preuve indépendante des droits. Contributions tierces conservées ; aucun rôle de parolier, interprète ou producteur déduit.` });
        ownerCreditIds.push(row.id);
      }
    }
    await db.project.update({ where: { id: projectId }, data: { title: input.title, trackCount: ids.length,
      ...(input.releaseDate === undefined ? {} : { releaseDate: input.releaseDate === null ? null : new Date(`${input.releaseDate}T00:00:00.000Z`) }),
      ...(input.membersPreviewEnabled === undefined ? {} : { membersPreviewEnabled: input.membersPreviewEnabled }) } });
    await db.digitalEvent.create({ data: { actorId: actor.id, kind: "MUSIC_EXPRESS_DRAFT", externalKey, details: { projectId, requestHash, trackIds: ids,
      ...(!input.projectId || input.hasCollaborations !== undefined ? { hasCollaborations: input.hasCollaborations ?? false } : {}),
      ...(applyOwnerDefaults ? { ownerCredits: { policy: EXPRESS_OWNER_CREDIT_POLICY, creditIds: ownerCreditIds, independentRightsEvidence: false } } : {}),
      ...(input.releaseDate !== undefined && input.releaseDate !== previousReleaseDate ? { releaseDateChange: { from: previousReleaseDate, to: input.releaseDate, purpose: "PLATFORM_RELEASE_METADATA_ONLY" } } : {}),
      ...(input.membersPreviewEnabled !== undefined && input.membersPreviewEnabled !== previousMembersPreviewEnabled ? { membersPreviewChange: { from: previousMembersPreviewEnabled, to: input.membersPreviewEnabled, salesActivated: false } } : {}) } } });
    return { projectId, duplicate: false };
  }, { timeout: 30_000 });
}
export async function publishExpressProject(actor: OrderActor, input: { projectId: string; reviewToken: string; confirmed: boolean; idempotencyKey: string; rightsDeclaration?: string; artisticDeclaration?: string; publishMode?: "PREMIERE" | "SALE" }) {
  requireDigitalEnvironment(); assertDigitalUuid(input.projectId); assertDigitalUuid(input.idempotencyKey);
  if (input.publishMode !== undefined && !["PREMIERE", "SALE"].includes(input.publishMode)) throw new DigitalError("EXPRESS_INVALID");
  if (input.confirmed !== true || !/^[a-f0-9]{64}$/.test(input.reviewToken)) throw new DigitalError("EXPRESS_CONFIRMATION_REQUIRED", 409);
  const requestHash = hash({ projectId: input.projectId, reviewToken: input.reviewToken, confirmed: input.confirmed, idempotencyKey: input.idempotencyKey,
    rightsDeclaration: input.rightsDeclaration ?? null, artisticDeclaration: input.artisticDeclaration ?? null, publishMode: input.publishMode ?? null });
  return prisma.$transaction(async db => {
    await requireDigitalExcerptAdmin(db, actor.id);
    // Same lifecycle lock order as Catalogue; cover replacement cannot race publication.
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-cover:${input.projectId}`})) IS NULL AS locked`;
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-project:${input.projectId}`})) IS NULL AS locked`;
    const key = `music-express-publish:${input.idempotencyKey}`, previous = await db.digitalEvent.findUnique({ where: { externalKey: key } });
    if (previous) {
      const details = previous.details as { projectId: string; reviewToken: string; requestedMode?: string | null; artisticDeclaration?: string | null; requestHash?: string };
      if (previous.actorId !== actor.id || details.projectId !== input.projectId || details.reviewToken !== input.reviewToken || (details.requestedMode ?? null) !== (input.publishMode ?? null)
        || (details.artisticDeclaration ?? null) !== (input.artisticDeclaration ?? null)
        // Existing publication records remain replayable without fabricated fields.
        // New records bind every supplied declaration, including rights, exactly.
        || details.requestHash !== undefined && details.requestHash !== requestHash) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409);
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
    const pendingArtistic = review.tracks.filter(t => t.artisticStatus !== "VALIDATED");
    if (pendingArtistic.length && (input.artisticDeclaration !== OWNER_EXCERPTS_AT_PUBLICATION_POLICY || pendingArtistic.some(t => !t.artisticAtPublication)))
      throw new DigitalError("EXCERPT_ATTESTATION_REQUIRED", 409);
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
    if (pendingArtistic.length) {
      const current = await loadGroupReview(actor, input.projectId, db);
      const tracks = current.tracks.filter(t => pendingArtistic.some(p => p.masterId === t.masterId));
      if (tracks.length !== pendingArtistic.length) throw new DigitalError("EXPRESS_CHANGED", 409);
      await mutateGroupReview(actor, { operation: "artistic", projectId: input.projectId, masterIds: tracks.map(t => t.masterId),
        expectedBindings: tracks.map(t => ({ masterId: t.masterId, bindingHash: t.bindingHash })),
        expectedSelections: tracks.map(t => ({ masterId: t.masterId, revisionId: t.selection?.revisionId ?? null })),
        provenance: "OWNER_DECLARED", attested: true, idempotencyKey: input.idempotencyKey }, db);
    }
    if (input.publishMode === "PREMIERE" && !review.membersPreviewEnabled) throw new DigitalError("EXPRESS_INVALID");
    let premiere: { binding: string } | null = null;
    if (review.membersPreviewEnabled) {
      await authorizeMemberPremiereExcerpts(db, input.projectId, actor.id);
      premiere = await assertMemberPremiereReady(db, input.projectId);
    }
    if (review.membersPreviewEnabled && input.publishMode !== "SALE") {
      // A member premiere is a separate, explicit metadata/excerpt publication.
      // Its future date never activates offers or alters a track's existing state.
      await db.project.update({ where: { id: input.projectId }, data: { status: "PUBLISHED", publicVisible: true } });
      await db.digitalEvent.create({ data: { kind: "MUSIC_EXPRESS_PREMIERE_PUBLISHED", actorId: actor.id, externalKey: key,
        details: { projectId: input.projectId, reviewToken: input.reviewToken, requestedMode: input.publishMode ?? null, requestHash, premiereBinding: premiere!.binding, releaseDate: review.releaseDate, memberOnly: true,
          offerIds: [], salesActivated: false, rightsDeclaration: pendingRights.length ? OWNER_PUBLICATION_POLICY : null,
          artisticDeclaration: input.artisticDeclaration ?? null, artisticMasterIds: pendingArtistic.map(t => t.masterId), artisticProvenance: pendingArtistic.length ? "OWNER_DECLARED" : null } } });
      await enqueueReleasePublication(db, { kind: "MUSIC", resourceId: input.projectId });
      return { ok: true, duplicate: false, published: true, premiere: true };
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
    if (premiere) await db.digitalEvent.create({ data: { kind: "MUSIC_EXPRESS_PREMIERE_PUBLISHED", actorId: actor.id, externalKey: `${key}:premiere`,
      details: { projectId: p.id, premiereBinding: premiere.binding, releaseDate: review.releaseDate, memberOnly: true, salesActivated: true,
        workflow: "EXPLICIT_SALE_WITH_MEMBER_EXCERPTS", offerIds: ids, delivery: "IMMEDIATE_AFTER_CONFIRMED_PAYMENT" } } });
    await enqueueReleasePublication(db, { kind: "MUSIC", resourceId: p.id });
    await db.digitalEvent.create({ data: { kind: "MUSIC_EXPRESS_PUBLISHED", actorId: actor.id, externalKey: key, details: { projectId: p.id, reviewToken: input.reviewToken, requestedMode: input.publishMode ?? null, requestHash, offerIds: ids,
      delivery: "IMMEDIATE_AFTER_CONFIRMED_PAYMENT", rightsDeclaration: pendingRights.length ? OWNER_PUBLICATION_POLICY : null,
      artisticDeclaration: input.artisticDeclaration ?? null, artisticMasterIds: pendingArtistic.map(t => t.masterId), artisticProvenance: pendingArtistic.length ? "OWNER_DECLARED" : null } } });
    return { ok: true, duplicate: false };
  }, { timeout: 30_000 });
}
