import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { digitalCommercialAudioReady } from "./formats";
import { assessDigitalRightsReview, DIGITAL_RIGHTS_REVIEW_EVENT, digitalRightsReviewHash } from "./rights-review-policy";
import { ANNOUNCEMENT_EVENT, announcementAllowed } from "./announcement-policy";
import { digitalExcerptSelection, DIGITAL_EXCERPT_EVENT } from "./excerpt-policy";
import { assertDigitalExcerptApprovals } from "./excerpt-commerce";
import { independentlyValidatedMasters } from "./independent-artistic-reviews";
import { classifyDiscography, trackPreparationIssues, type PreparedTrack } from "./discography-preparation-policy";

/** Batched, read-only projection: no object keys, evidence contents or user credentials. */
export const loadDiscographyPreparation = cache(async () => {
  const projects = await prisma.project.findMany({ where: { type: { in: ["ALBUM", "SINGLE"] } }, orderBy: [{ catalogPosition: "asc" }, { id: "asc" }],
    include: { credits: true, digitalOffers: true, assets: { where: { role: "COVER" }, orderBy: [{ position: "asc" }, { createdAt: "desc" }], include: { asset: true } },
      tracks: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { credits: true, digitalMasters: { take: 1, orderBy: { version: "desc" }, include: { masterAsset: true, mp3Asset: true, previewAsset: true } } } } } });
  const ids = projects.flatMap(p => p.tracks.flatMap(t => t.digitalMasters.map(m => m.id)));
  const events = await prisma.digitalEvent.findMany({ where: { OR: [
    ...(ids.length ? [{ kind: { in: [DIGITAL_RIGHTS_REVIEW_EVENT, DIGITAL_EXCERPT_EVENT] }, OR: ids.map(id => ({ details: { path: ["binding", "masterId"], equals: id } })) }] : []),
    { kind: ANNOUNCEMENT_EVENT, OR: projects.map(p => ({ details: { path: ["binding", "projectId"], equals: p.id } })) },
  ] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, kind: true, details: true, actorId: true, createdAt: true } });
  const actorIds = [...new Set(events.flatMap(e => e.actorId ? [e.actorId] : []))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, role: true, status: true, emailVerified: true } }) : [];
  const latest = new Map<string, typeof events[number]>();
  for (const e of events) {
    const d = e.details as { binding?: { masterId?: string } } | null;
    if (typeof d?.binding?.masterId === "string") { const key = `${e.kind}:${d.binding.masterId}`; if (!latest.has(key)) latest.set(key, e); }
  }
  const claimed = projects.flatMap(p => p.tracks.flatMap(t => t.digitalMasters)).filter(m => {
    try { return digitalCommercialAudioReady(m) && digitalExcerptSelection(m, latest.get(`${DIGITAL_EXCERPT_EVENT}:${m.id}`) ?? null).status === "VALIDATED"; } catch { return false; }
  });
  const artistic = await independentlyValidatedMasters(claimed, masters => assertDigitalExcerptApprovals(prisma, masters));
  return projects.map(p => {
    const tracks = p.tracks.map(t => {
      const m = t.digitalMasters[0], offer = p.digitalOffers.find(o => o.scope === "TRACK" && o.trackId === t.id);
      const technicalReady = !!m && digitalCommercialAudioReady(m);
      const event = m ? latest.get(`${DIGITAL_RIGHTS_REVIEW_EVENT}:${m.id}`) ?? null : null;
      const rightsApproved = !!m && assessDigitalRightsReview(m, event, actors.find(a => a.id === event?.actorId) ?? null).status === "APPROVED";
      const mediaCleared = !!m && [m.masterAsset, m.mp3Asset, m.previewAsset].every(a => a?.rightsStatus === "CLEARED");
      const artisticValidated = !!m && artistic.has(m.id);
      const track: PreparedTrack = { id: t.id, title: t.title, position: t.position, released: t.status === "RELEASED", masterId: m?.id ?? null, version: m?.version ?? null,
        durationMs: m?.masterAsset.durationMs ?? null, technicalReady, rightsApproved, mediaCleared, artisticValidated,
        publicPreviewAllowed: technicalReady && rightsApproved && artisticValidated && m?.previewAsset?.rightsStatus === "CLEARED", priceCents: offer?.priceCents ?? null,
        composerDocumented: t.credits.some(c => c.role === "COMPOSER" && c.confidence !== "UNKNOWN" && c.confidence !== "PLACEHOLDER") };
      return { ...track, issues: trackPreparationIssues(track) };
    });
    const cover = p.assets[0]?.asset;
    const announcement = events.find(e => e.kind === ANNOUNCEMENT_EVENT && (e.details as { binding?: { projectId?: string } } | null)?.binding?.projectId === p.id);
    const metadataBinding = { projectId: p.id, slug: p.slug, title: p.title, coverId: cover?.id ?? null, coverSha256: cover?.checksumSha256 ?? null,
      editorialHash: digitalRightsReviewHash({ subtitle: p.subtitle, description: p.description, shortDescription: p.shortDescription, releaseDate: p.releaseDate?.toISOString() ?? null }),
      creditsHash: digitalRightsReviewHash(p.credits.map(c => ({ id: c.id, name: c.name, role: c.role, confidence: c.confidence, note: c.note })).sort((a, b) => a.id.localeCompare(b.id))),
      tracksHash: digitalRightsReviewHash(p.tracks.map(t => ({ id: t.id, title: t.title, position: t.position, masterId: t.digitalMasters[0]?.id ?? null, wavSha256: t.digitalMasters[0]?.masterAsset.checksumSha256 ?? null }))) };
    const input = { id: p.id, slug: p.slug, title: p.title, type: p.type, status: p.status, publicVisible: p.publicVisible,
      announcementAllowed: announcementAllowed(metadataBinding, announcement?.details ?? null),
      coverCleared: cover?.rightsStatus === "CLEARED", coverConflict: p.assets.length > 1, artistDocumented: p.credits.some(c => c.role === "ARTIST"),
      albumPriceCents: p.digitalOffers.find(o => o.scope === "ALBUM")?.priceCents ?? null, activeOffers: p.digitalOffers.filter(o => o.active).length, tracks };
    return { ...input, ...classifyDiscography(input), coverId: cover?.id ?? null, coverRights: cover?.rightsStatus ?? "MISSING" };
  });
});
