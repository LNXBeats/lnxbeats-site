import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { DigitalError, assertDigitalUuid, digitalPrice, normalizeDigitalCart, requireDigitalEnvironment, type DigitalSelection } from "./domain";
import { DIGITAL_ACTIVE_RIGHTS_ORDER_STATES } from "./library-policy";
import { applyDigitalCompletions } from "./completion";
import { digitalOwnsExactAlbum } from "./album-ownership-policy";
type DB = Prisma.TransactionClient;
export function selectionFingerprint(offer:DigitalSelection){return createHash("sha256").update(JSON.stringify([offer.id,offer.scope,offer.title,offer.version,offer.priceCents,offer.tracks.map(t=>[t.trackId,t.masterId,t.title,t.position,t.formats??null,t.wavAssetId??null,t.mp3AssetId??null]),offer.completion??null])).digest("hex");}

export async function selections(ids: string[], db: DB = prisma): Promise<DigitalSelection[]> {
  if (ids.length > 50 || new Set(ids).size !== ids.length) throw new DigitalError("INVALID_CART");
  ids.forEach(assertDigitalUuid);
  const offers = await db.digitalOffer.findMany({ where: { id: { in: ids } }, include: { project: { include: {
    tracks: { where: { status: "RELEASED" }, orderBy: [{ position: "asc" }, { id: "asc" }], include: {
      digitalMasters: { where: { status: "READY", previewAssetId: { not: null } }, orderBy: { version: "desc" }, take: 1, include: { masterAsset: true, previewAsset: true,mp3Asset:true } },
    } },
  } } } });
  if (offers.length !== ids.length) throw new DigitalError("OFFER_UNAVAILABLE", 409);
  return offers.map(offer => {
    if (!offer.active || !offer.rightsConfirmed || offer.project.status !== "PUBLISHED" || !offer.project.publicVisible) throw new DigitalError("OFFER_UNAVAILABLE", 409);
    const tracks = offer.scope === "ALBUM" ? offer.project.tracks : offer.project.tracks.filter(t => t.id === offer.trackId);
    if (!tracks.length || tracks.some(t => { const m = t.digitalMasters[0]; return !m || m.masterAsset.visibility !== "PRIVATE" || m.masterAsset.rightsStatus !== "CLEARED"
      || m.masterAsset.mimeType!=="audio/wav"||!m.masterAsset.checksumSha256||!m.mp3AssetId||m.mp3Asset?.visibility!=="PRIVATE"
      ||m.mp3Asset.rightsStatus!=="CLEARED"||m.mp3Asset.mimeType!=="audio/mpeg"||!/^[a-f0-9]{64}$/.test(m.mp3Asset.checksumSha256??"")
      || m.previewAsset?.visibility !== "PUBLIC" || m.previewAsset.rightsStatus !== "CLEARED" || !m.previewDurationMs || m.previewDurationMs > 60000; })) throw new DigitalError("NO_READY_MASTER", 409);
    return { id: offer.id, scope: offer.scope, title: offer.scope === "ALBUM" ? `${offer.project.title} — Album` : tracks[0].title,
      priceCents: digitalPrice(offer.priceCents), version: offer.version,
      tracks: tracks.map(t => ({ trackId: t.id, masterId: t.digitalMasters[0].id, title: t.title, position: t.position,
        formats:["WAV","MP3"] as ["WAV","MP3"],wavAssetId:t.digitalMasters[0].masterAssetId,mp3AssetId:t.digitalMasters[0].mp3AssetId! })) };
  });
}
export async function ownedTrackIds(userId: string, db: DB = prisma) {
  const rows = await db.digitalEntitlement.findMany({ where: { userId, status: "ACTIVE", line: { order: { status: { in: [...DIGITAL_ACTIVE_RIGHTS_ORDER_STATES] } } } }, select: { master: { select: { trackId: true } } } });
  return new Set(rows.map(r => r.master.trackId));
}
export async function quote(ids: string[], userId?: string) {
  requireDigitalEnvironment();
  const chosen=await selections(ids),owned=userId?await ownedTrackIds(userId):new Set<string>();
  return normalizeDigitalCart(userId?await applyDigitalCompletions(prisma,userId,chosen,owned):chosen,owned);
}
export function publicQuote(value: Awaited<ReturnType<typeof quote>>) {
  return { totalCents: value.totalCents, removed: value.removed, lines: value.lines.map(l => ({ id: l.id, scope: l.scope, title: l.title, priceCents: l.priceCents, version: l.version, trackCount: l.tracks.length,
    completion:l.completion?{basePriceCents:l.completion.basePriceCents,creditCents:l.completion.creditCents,creditedTrackCount:l.completion.sources.length}:null })) };
}
export async function publicDigitalProject(slug: string, userId?: string) {
  const project = await prisma.project.findFirst({ where: { slug, publicVisible: true, status: "PUBLISHED" }, select: {
    id: true, digitalOffers: { select: { id: true, scope: true, trackId: true } }, tracks: { where: { status: {in:["RELEASED","ANNOUNCED"]} }, orderBy: [{position:"asc"},{id:"asc"}], select: {
      id: true, title: true, position: true, status:true, durationSeconds: true, digitalMasters: { where: { status: "READY" }, orderBy: { version: "desc" }, take: 1, select: {
        previewDurationMs: true, masterAsset: { select: { durationMs: true } }, previewAsset: { select: { id: true, visibility: true, rightsStatus: true } },
      } },
    } },
  } });
  if (!project) return null;
  const offers: DigitalSelection[] = [];
  for (const entry of project.digitalOffers) { try { offers.push((await selections([entry.id]))[0]); } catch (e) { if (!(e instanceof DigitalError)) throw e; } }
  if(!offers.length&&!project.tracks.some(t=>t.status==="RELEASED"&&t.digitalMasters[0]?.previewAsset?.visibility==="PUBLIC"&&t.digitalMasters[0]?.previewAsset?.rightsStatus==="CLEARED"))return null;
  const album = offers.find(o => o.scope === "ALBUM");
  const owned = userId ? await ownedTrackIds(userId) : new Set<string>();
  const albumOwnedCount = album?.tracks.filter(t => owned.has(t.trackId)).length ?? 0;
  const ownsAlbum=!!album&&!!userId&&digitalOwnsExactAlbum(album,await prisma.digitalOrderLine.findMany({where:{offerId:album.id,scope:"ALBUM",order:{userId,status:{in:[...DIGITAL_ACTIVE_RIGHTS_ORDER_STATES]}}},
    include:{order:{select:{status:true}},entitlements:{where:{userId,status:"ACTIVE"},select:{masterId:true,status:true}}}}));
  let completion:null|{priceCents:number;basePriceCents:number;creditCents:number;creditedTrackCount:number;blockedReason:string|null}=null;
  if(album&&userId&&albumOwnedCount){try{const q=await applyDigitalCompletions(prisma,userId,[album],owned),c=q[0].completion;
    if(c)completion={priceCents:q[0].priceCents,basePriceCents:c.basePriceCents,creditCents:c.creditCents,creditedTrackCount:c.sources.length,blockedReason:null};
  }catch(e){if(!(e instanceof DigitalError))throw e;completion={priceCents:album.priceCents,basePriceCents:album.priceCents,creditCents:0,creditedTrackCount:0,blockedReason:e.code};}}
  return { album: album ? { id: album.id, priceCents: album.priceCents, version: album.version,trackCount:album.tracks.length,
    owned: ownsAlbum, partiallyOwned: albumOwnedCount > 0 && !ownsAlbum,completion } : null,
    tracks: project.tracks.map(t => { const media = t.digitalMasters[0], offer = offers.find(o => o.tracks.length === 1 && o.scope === "TRACK" && o.tracks[0].trackId === t.id);
      return { id: t.id, title: t.title, position: t.position, publication:t.status, previewUrl: t.status==="RELEASED"&&media?.previewAsset?.visibility === "PUBLIC" && media.previewAsset.rightsStatus === "CLEARED" ? `/media/digital/previews/${media.previewAsset.id}` : null,
        previewDurationMs: t.status==="RELEASED"?media?.previewDurationMs??null:null,
        fullDurationMs: media?.masterAsset.durationMs ?? (t.durationSeconds == null ? null : t.durationSeconds * 1000), owned: owned.has(t.id),
        offer: offer ? { id: offer.id, priceCents: offer.priceCents, version: offer.version } : null }; }) };
}

export async function saveOffer(actor: OrderActor, input: { projectId: string; trackId?: string | null; priceCents: number | null; active: boolean; rightsConfirmed: boolean; expectedVersion: number; distribution: string }) {
  requireDigitalEnvironment();
  if (actor.role !== "ADMIN") throw new DigitalError("ADMIN_REQUIRED", 403);
  assertDigitalUuid(input.projectId); if (input.trackId) assertDigitalUuid(input.trackId);
  if (input.priceCents !== null) digitalPrice(input.priceCents);
  if (input.active && (!input.priceCents || !input.rightsConfirmed)) throw new DigitalError("SALE_REQUIREMENTS", 409);
  if (!["UNRELEASED", "DISTRIBUTED"].includes(input.distribution)) throw new DigitalError("INVALID_DISTRIBUTION");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-offer:${input.projectId}:${input.trackId ?? "album"}`})) IS NULL AS locked`;
    const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
    const track = input.trackId ? await tx.track.findFirst({ where: { id: input.trackId, projectId: input.projectId } }) : null;
    if (!project || input.trackId && !track) throw new DigitalError("NOT_FOUND", 404);
    const current = await tx.digitalOffer.findFirst({ where: { projectId: input.projectId, trackId: input.trackId ?? null } });
    if ((current?.version ?? 0) !== input.expectedVersion) throw new DigitalError("STALE_OFFER", 409);
    const data = { priceCents: input.priceCents, active: input.active, rightsConfirmed: input.rightsConfirmed, distribution: input.distribution, version: (current?.version ?? 0) + 1 };
    const offer = current ? await tx.digitalOffer.update({ where: { id: current.id }, data }) : await tx.digitalOffer.create({ data: { ...data, scope: input.trackId ? "TRACK" : "ALBUM", projectId: input.projectId, trackId: input.trackId ?? null } });
    // Upload alone grants no rights. This acknowledgement is explicit and audited.
    const masters = await tx.digitalMaster.findMany({ where: { status: "READY", track: { projectId: input.projectId, ...(input.trackId ? { id: input.trackId } : {}) } }, select: { masterAssetId: true, previewAssetId: true,mp3AssetId:true } });
    if (masters.length) await tx.asset.updateMany({ where: { id: { in: masters.flatMap(m => [m.masterAssetId, ...(m.previewAssetId ? [m.previewAssetId] : []),...(m.mp3AssetId?[m.mp3AssetId]:[])]) } }, data: { rightsStatus: input.rightsConfirmed ? "CLEARED" : "PENDING" } });
    await tx.digitalEvent.create({ data: { actorId: actor.id, kind: "OFFER_SAVED", details: { offerId: offer.id, version: offer.version, priceCents: offer.priceCents, active: offer.active, rightsConfirmed: offer.rightsConfirmed } } });
    return offer.id;
  });
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
