import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { DigitalError, assertDigitalUuid, digitalPrice, normalizeDigitalCart, requireDigitalEnvironment, type DigitalSelection } from "./domain";
import { DIGITAL_ACTIVE_RIGHTS_ORDER_STATES } from "./library-policy";
import { applyDigitalCompletions } from "./completion";
import { digitalOwnsExactAlbum } from "./album-ownership-policy";
import { acquiredAlbumFormats, digitalCommercialAudioReady } from "./formats";
import { MP3_ONLY_SOURCE, MP3_ONLY_SOURCE_POLICY } from "./mp3-only-policy";
import { assertDigitalRightsReviews } from "./rights-review-service";
import { assertDigitalExcerptApprovals } from "./excerpt-commerce";
import {digitalRuntimeMode} from "./runtime-policy";
import {assertDigitalLiveObjectAssets} from "./live-media-policy";
import { digitalPublicPreviewAllowed } from "./public-preview";
type DB = Prisma.TransactionClient;
export function selectionFingerprint(offer:DigitalSelection){return createHash("sha256").update(JSON.stringify([offer.id,offer.scope,offer.title,offer.version,offer.priceCents,offer.tracks.map(t=>{
  const historical=[t.trackId,t.masterId,t.title,t.position,t.formats??null,t.wavAssetId??null,t.mp3AssetId??null];
  // Preserve the exact historical WAV fingerprint. Only the new discriminated format adds a binding.
  return t.formatPolicy===undefined?historical:[...historical,t.formatPolicy,t.sourceFormat??null,t.sourceSha256??null];
}),offer.completion??null])).digest("hex");}

export async function selections(ids: string[], db: DB = prisma): Promise<DigitalSelection[]> {
  if (ids.length > 50 || new Set(ids).size !== ids.length) throw new DigitalError("INVALID_CART");
  ids.forEach(assertDigitalUuid);
  const offers = await db.digitalOffer.findMany({ where: { id: { in: ids } }, include: { project: { include: {
    tracks: { orderBy: [{ position: "asc" }, { id: "asc" }], include: {
      digitalMasters: { orderBy: { version: "desc" }, take: 1, include: { masterAsset: true, previewAsset: true,mp3Asset:true } },
    } },
  } } } });
  if (offers.length !== ids.length) throw new DigitalError("OFFER_UNAVAILABLE", 409);
  const selected = offers.map(offer => {
    if (!offer.active || !offer.rightsConfirmed || offer.project.status !== "PUBLISHED" || !offer.project.publicVisible) throw new DigitalError("OFFER_UNAVAILABLE", 409);
    const tracks = offer.scope === "ALBUM" ? offer.project.tracks : offer.project.tracks.filter(t => t.id === offer.trackId);
    if (!tracks.length || tracks.some(t => { const m = t.digitalMasters[0]; return t.status !== "RELEASED" || !m || !digitalCommercialAudioReady(m) || m.masterAsset.visibility !== "PRIVATE" || m.masterAsset.rightsStatus !== "CLEARED"
      || (m.codec==="mp3" ? offer.scope!=="TRACK"||offer.project.type!=="SINGLE"||offer.project.id!==MP3_ONLY_SOURCE.projectId
        ||t.id!==MP3_ONLY_SOURCE.trackId||offer.project.tracks.length!==1
        : m.masterAsset.mimeType!=="audio/wav"||!m.masterAsset.checksumSha256||!m.mp3AssetId||m.mp3Asset?.visibility!=="PRIVATE"
          ||m.mp3Asset.rightsStatus!=="CLEARED"||m.mp3Asset.mimeType!=="audio/mpeg"||!/^[a-f0-9]{64}$/.test(m.mp3Asset.checksumSha256??""))
      || m.previewAsset?.visibility !== "PUBLIC" || m.previewAsset.rightsStatus !== "CLEARED" || !m.previewDurationMs || m.previewDurationMs > 60000; })) throw new DigitalError("NO_READY_MASTER", 409);
    assertDigitalLiveObjectAssets(digitalRuntimeMode(),tracks.flatMap(t=>{const m=t.digitalMasters[0];return m.codec==="mp3"?[m.masterAsset,m.previewAsset]:[m.masterAsset,m.mp3Asset,m.previewAsset];}));
    return { id: offer.id, scope: offer.scope, title: offer.scope === "ALBUM" ? `${offer.project.title} — Album` : tracks[0].title,
      priceCents: digitalPrice(offer.priceCents), version: offer.version,
      tracks: tracks.map((t):DigitalSelection["tracks"][number] => {const m=t.digitalMasters[0];return { trackId: t.id, masterId: m.id, title: t.title, position: t.position,
        ...(m.codec==="mp3"?{formats:["MP3"] as ["MP3"],mp3AssetId:m.masterAssetId,sourceSha256:m.masterAsset.checksumSha256!,sourceFormat:"MP3_LOSSY" as const,formatPolicy:MP3_ONLY_SOURCE_POLICY}
          :{formats:["WAV","MP3"] as ["WAV","MP3"],wavAssetId:m.masterAssetId,mp3AssetId:m.mp3AssetId!}) };}) };
  });
  if(selected.length) {
    await assertDigitalRightsReviews(db, selected.flatMap(selection => selection.tracks.map(track => track.masterId)));
    const masterIds = new Set(selected.flatMap(selection => selection.tracks.map(track => track.masterId)));
    await assertDigitalExcerptApprovals(db, offers.flatMap(offer => offer.project.tracks.flatMap(track => track.digitalMasters)).filter(master => masterIds.has(master.id)));
  }
  return selected;
}
export async function ownedTrackIds(userId: string, db: DB = prisma) {
  const mode = requireDigitalEnvironment();
  const rows = await db.digitalEntitlement.findMany({ where: { userId, status: "ACTIVE", line: { order: { mode, status: { in: [...DIGITAL_ACTIVE_RIGHTS_ORDER_STATES] } } } }, select: { master: { select: { trackId: true } } } });
  return new Set(rows.map(r => r.master.trackId));
}
export async function quote(ids: string[], userId?: string) {
  requireDigitalEnvironment();
  const chosen=await selections(ids),owned=userId?await ownedTrackIds(userId):new Set<string>();
  return normalizeDigitalCart(userId?await applyDigitalCompletions(prisma,userId,chosen,owned):chosen,owned);
}
export function publicQuote(value: Awaited<ReturnType<typeof quote>>) {
  return { totalCents: value.totalCents, removed: value.removed, lines: value.lines.map(l => ({ id: l.id, scope: l.scope, title: l.title, priceCents: l.priceCents, version: l.version, trackCount: l.tracks.length,
    formats:acquiredAlbumFormats(l.tracks),
    completion:l.completion?{basePriceCents:l.completion.basePriceCents,creditCents:l.completion.creditCents,creditedTrackCount:l.completion.sources.length}:null })) };
}
export async function publicDigitalProject(slug: string, userId?: string) {
  const project = await prisma.project.findFirst({ where: { slug, publicVisible: true, status: "PUBLISHED" }, select: {
    id: true, digitalOffers: { select: { id: true, scope: true, trackId: true } }, tracks: { where: { status: {in:["RELEASED","ANNOUNCED"]} }, orderBy: [{position:"asc"},{id:"asc"}], select: {
      id: true, title: true, position: true, status:true, durationSeconds: true, digitalMasters: { orderBy: { version: "desc" }, take: 1,
        include: { masterAsset: true, mp3Asset: true, previewAsset: true } },
    } },
  } });
  if (!project) return null;
  const offers: DigitalSelection[] = [];
  for (const entry of project.digitalOffers) { try { offers.push((await selections([entry.id]))[0]); } catch (e) { if (!(e instanceof DigitalError)) throw e; } }
  const publicPreviews = new Set<string>();
  for (const track of project.tracks) if (track.status === "RELEASED" && await digitalPublicPreviewAllowed(prisma, track.digitalMasters[0])) publicPreviews.add(track.id);
  if(!offers.length&&!publicPreviews.size)return null;
  const album = offers.find(o => o.scope === "ALBUM");
  const owned = userId ? await ownedTrackIds(userId) : new Set<string>();
  const albumOwnedCount = album?.tracks.filter(t => owned.has(t.trackId)).length ?? 0;
  const ownsAlbum=!!album&&!!userId&&digitalOwnsExactAlbum(album,await prisma.digitalOrderLine.findMany({where:{offerId:album.id,scope:"ALBUM",order:{userId,mode:requireDigitalEnvironment(),status:{in:[...DIGITAL_ACTIVE_RIGHTS_ORDER_STATES]}}},
    include:{order:{select:{status:true}},entitlements:{where:{userId,status:"ACTIVE"},select:{masterId:true,status:true}}}}));
  let completion:null|{priceCents:number;basePriceCents:number;creditCents:number;creditedTrackCount:number;blockedReason:string|null}=null;
  if(album&&userId&&albumOwnedCount){try{const q=await applyDigitalCompletions(prisma,userId,[album],owned),c=q[0].completion;
    if(c)completion={priceCents:q[0].priceCents,basePriceCents:c.basePriceCents,creditCents:c.creditCents,creditedTrackCount:c.sources.length,blockedReason:null};
  }catch(e){if(!(e instanceof DigitalError))throw e;completion={priceCents:album.priceCents,basePriceCents:album.priceCents,creditCents:0,creditedTrackCount:0,blockedReason:e.code};}}
  return { album: album ? { id: album.id, priceCents: album.priceCents, version: album.version,trackCount:album.tracks.length,
    formats:acquiredAlbumFormats(album.tracks),
    owned: ownsAlbum, partiallyOwned: albumOwnedCount > 0 && !ownsAlbum,completion } : null,
    tracks: project.tracks.map(t => { const media = t.digitalMasters[0], offer = offers.find(o => o.tracks.length === 1 && o.scope === "TRACK" && o.tracks[0].trackId === t.id);
      return { id: t.id, title: t.title, position: t.position, publication:t.status, previewUrl: publicPreviews.has(t.id) && media?.previewAsset ? `/media/digital/previews/${media.previewAsset.id}` : null,
        previewDurationMs: t.status==="RELEASED"?media?.previewDurationMs??null:null,
        fullDurationMs: media?.masterAsset.durationMs ?? (t.durationSeconds == null ? null : t.durationSeconds * 1000), owned: owned.has(t.id),
        offer: offer ? { id: offer.id, priceCents: offer.priceCents, version: offer.version,formats:acquiredAlbumFormats(offer.tracks) } : null }; }) };
}

export async function saveOffer(actor: OrderActor, input: { projectId: string; trackId?: string | null; priceCents: number | null; active: boolean; rightsConfirmed: boolean; expectedVersion: number; distribution: string }) {
  return prisma.$transaction(tx => saveOfferInTransaction(tx, actor, input));
}

/** Same offer engine; Express drafts never rewrite media-rights or activate a sale. */
export async function saveOfferInTransaction(tx: DB, actor: OrderActor, input: { projectId: string; trackId?: string | null; priceCents: number | null; active: boolean; rightsConfirmed: boolean; expectedVersion: number; distribution: string }, draftOnly = false) {
  requireDigitalEnvironment();
  if (actor.role !== "ADMIN") throw new DigitalError("ADMIN_REQUIRED", 403);
  assertDigitalUuid(input.projectId); if (input.trackId) assertDigitalUuid(input.trackId);
  if (input.priceCents !== null) digitalPrice(input.priceCents);
  if (input.active && (!input.priceCents || !input.rightsConfirmed)) throw new DigitalError("SALE_REQUIREMENTS", 409);
  if (!["UNRELEASED", "DISTRIBUTED"].includes(input.distribution)) throw new DigitalError("INVALID_DISTRIBUTION");
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-offer:${input.projectId}:${input.trackId ?? "album"}`})) IS NULL AS locked`;
    const project = await tx.project.findUnique({ where: { id: input.projectId }, include: { tracks: { where: {...(input.trackId?{id:input.trackId}:{})},include:{digitalMasters:{orderBy:{version:"desc"},take:1,include:{masterAsset:true,mp3Asset:true,previewAsset:true}}} } } });
    const track = input.trackId ? await tx.track.findFirst({ where: { id: input.trackId, projectId: input.projectId } }) : null;
    if (!project || input.trackId && !track) throw new DigitalError("NOT_FOUND", 404);
    if(input.active && !draftOnly && project.tracks.some(t=>t.digitalMasters[0]?.codec==="mp3")){
      // This query's tracks are filtered to input.trackId. Count the actual edition,
      // not that filtered projection, before opening the one authorized single.
      if(!input.trackId||project.type!=="SINGLE"||project.id!==MP3_ONLY_SOURCE.projectId||input.trackId!==MP3_ONLY_SOURCE.trackId
        ||await tx.track.count({where:{projectId:project.id}})!==1)throw new DigitalError("NO_READY_MASTER",409);
    }
    // Draft prices may be prepared without media. Opening a sale requires the actual
    // strict ingestion proof; an extension, MIME label or old READY flag is insufficient.
    if(input.active && !draftOnly && (project.status!=="PUBLISHED"||!project.publicVisible||!project.tracks.length
      ||project.tracks.some(t=>t.status!=="RELEASED"||!t.digitalMasters[0]||!digitalCommercialAudioReady(t.digitalMasters[0]))))throw new DigitalError("NO_READY_MASTER",409);
    if(input.active && !draftOnly){
      await assertDigitalRightsReviews(tx,project.tracks.map(track=>track.digitalMasters[0].id));
      await assertDigitalExcerptApprovals(tx,project.tracks.map(track=>track.digitalMasters[0]));
    }
    const current = await tx.digitalOffer.findFirst({ where: { projectId: input.projectId, trackId: input.trackId ?? null } });
    if (draftOnly && (input.active !== (current?.active ?? false) || input.rightsConfirmed !== (current?.rightsConfirmed ?? false) || input.distribution !== (current?.distribution ?? "UNRELEASED"))) throw new DigitalError("SALE_REQUIREMENTS", 409);
    if ((current?.version ?? 0) !== input.expectedVersion) throw new DigitalError("STALE_OFFER", 409);
    if (current && current.priceCents === input.priceCents && current.active === input.active && current.rightsConfirmed === input.rightsConfirmed && current.distribution === input.distribution) return current.id;
    const data = { priceCents: input.priceCents, active: input.active, rightsConfirmed: input.rightsConfirmed, distribution: input.distribution, version: (current?.version ?? 0) + 1 };
    const offer = current ? await tx.digitalOffer.update({ where: { id: current.id }, data }) : await tx.digitalOffer.create({ data: { ...data, scope: input.trackId ? "TRACK" : "ALBUM", projectId: input.projectId, trackId: input.trackId ?? null } });
    // Upload alone grants no rights. This acknowledgement is explicit and audited.
    // Do not rewrite rights on older acquired editions while preparing a new offer.
    const masters = project.tracks.flatMap(track=>track.digitalMasters.slice(0,1)).filter(digitalCommercialAudioReady);
    if (!draftOnly && masters.length) await tx.asset.updateMany({ where: { id: { in: masters.flatMap(m => [m.masterAssetId, ...(m.previewAssetId ? [m.previewAssetId] : []),...(m.mp3AssetId?[m.mp3AssetId]:[])]) } }, data: { rightsStatus: input.rightsConfirmed ? "CLEARED" : "PENDING" } });
    await tx.digitalEvent.create({ data: { actorId: actor.id, kind: "OFFER_SAVED", details: { offerId: offer.id, version: offer.version, priceCents: offer.priceCents, active: offer.active, rightsConfirmed: offer.rightsConfirmed } } });
    return offer.id;
}
export async function syncCart(userId: string, ids: string[], expectedRevision: number) {
  requireDigitalEnvironment(); assertDigitalUuid(userId);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-user:${userId}`})) IS NULL AS locked`;
    const cart = await tx.digitalCart.upsert({ where: { userId }, create: { userId }, update: {} });
    if (cart.revision !== expectedRevision) throw new DigitalError("STALE_CART", 409);
    const pending = await tx.digitalOrder.findFirst({ where: { userId, status: { in: ["PENDING", "REQUIRES_REVIEW"] } } });
    if (pending) throw new DigitalError("PAYMENT_ALREADY_ENGAGED", 409);
    const owned=await ownedTrackIds(userId,tx);
    const result = normalizeDigitalCart(await applyDigitalCompletions(tx,userId,await selections(ids, tx),owned),owned);
    await tx.digitalCartLine.updateMany({ where: { cartId: cart.id }, data: { removed: true } });
    for (const line of result.lines) await tx.digitalCartLine.upsert({ where: { cartId_offerId: { cartId: cart.id, offerId: line.id } }, create: {
      cartId: cart.id, offerId: line.id, offerVersion: line.version, priceCents: line.priceCents,selectionHash:selectionFingerprint(line) }, update: { offerVersion: line.version, priceCents: line.priceCents,selectionHash:selectionFingerprint(line), removed: false } });
    const updated = await tx.digitalCart.update({ where: { id: cart.id }, data: { revision: { increment: 1 } } });
    return { ...publicQuote(result), revision: updated.revision };
  });
}
