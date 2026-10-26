import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DigitalError, digitalUuid, type DigitalSelection } from "./domain";
import { digitalSelectionFromOffer, type DigitalSelectionOffer, type publicDigitalProject } from "./catalog";
import { acquiredAlbumFormats, digitalCommercialAudioReady } from "./formats";
import { DIGITAL_EXCERPT_EVENT, type DigitalExcerptEvent } from "./excerpt-policy";
import { digitalExcerptApprovalMatches } from "./excerpt-approval-policy";
import {
  DIGITAL_RIGHTS_REVIEW_EVENT, assessDigitalRightsReview,
  type DigitalRightsReviewEvent,
} from "./rights-review-policy";

type PublicView = Awaited<ReturnType<typeof publicDigitalProject>>;
type ApprovalEvent = DigitalRightsReviewEvent & DigitalExcerptEvent & { masterId: string };

/** Request-fresh anonymous catalogue, not checkout and not an authorization
 * cache. A constant number of batched SELECTs replaces one full checkout-style
 * read per offer and per excerpt. Purchase and media endpoints keep their own
 * fresh, exact-version gates. No private object key reaches this projection. */
export async function publicDigitalProjects(slugs: readonly string[], db: Prisma.TransactionClient = prisma): Promise<Map<string, PublicView>> {
  const unique = [...new Set(slugs)];
  if (unique.length > 1000) throw new DigitalError("INVALID_CATALOGUE");
  if (!unique.length) return new Map();
  const projects = await db.project.findMany({
    where: { slug: { in: unique }, publicVisible: true, status: "PUBLISHED" },
    include: {
      digitalOffers: true,
      // Do not omit blocked/unlisted tracks: a partial album must never become
      // saleable just because an unavailable track was filtered from the read.
      tracks: { orderBy: [{ position: "asc" }, { id: "asc" }], include: {
        digitalMasters: { orderBy: [{ version: "desc" }, { id: "desc" }], take: 1,
          include: { masterAsset: true, mp3Asset: true, previewAsset: true } },
      } },
    },
  });
  const masters = projects.flatMap(project => project.tracks.flatMap(track => track.digitalMasters));
  const ids = masters.map(master => master.id);
  if (ids.length > 5000) throw new DigitalError("INVALID_CATALOGUE");
  const events = ids.length ? await db.$queryRaw<ApprovalEvent[]>`/* dcn-public-catalogue-latest-proofs */
    SELECT DISTINCT ON (kind, details #>> '{binding,masterId}')
      id, kind, "actorId", details, "createdAt", details #>> '{binding,masterId}' AS "masterId"
    FROM digital_events
    WHERE kind = ANY(${[DIGITAL_RIGHTS_REVIEW_EVENT, DIGITAL_EXCERPT_EVENT]}::text[])
      AND details #>> '{binding,masterId}' = ANY(${ids}::text[])
    ORDER BY kind, details #>> '{binding,masterId}', "createdAt" DESC, id DESC` : [];
  const actorIds = [...new Set(events.flatMap(event => event.actorId ? [event.actorId] : []))];
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } },
    select: { id: true, role: true, status: true, emailVerified: true } }) : [];
  const byActor = new Map(actors.map(actor => [actor.id, actor]));
  const rightsEvents = new Map(events.filter(event => event.kind === DIGITAL_RIGHTS_REVIEW_EVENT).map(event => [event.masterId, event]));
  const excerptEvents = new Map(events.filter(event => event.kind === DIGITAL_EXCERPT_EVENT).map(event => [event.masterId, event]));
  const candidateIds = [...new Set(events.filter(event => event.kind === DIGITAL_EXCERPT_EVENT).flatMap(event => {
    const details = event.details as { candidateOrigin?: unknown; candidateAssetId?: unknown } | null;
    return details?.candidateOrigin !== "EXISTING_PROVISIONAL" && typeof details?.candidateAssetId === "string"
      && digitalUuid(details.candidateAssetId) ? [details.candidateAssetId] : [];
  }))];
  const candidates = candidateIds.length ? await db.asset.findMany({ where: { id: { in: candidateIds } } }) : [];
  const byCandidate = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const approved = new Set(masters.filter(master => {
    const rights = rightsEvents.get(master.id), excerpt = excerptEvents.get(master.id);
    return assessDigitalRightsReview(master, rights ?? null, rights?.actorId ? byActor.get(rights.actorId) ?? null : null).status === "APPROVED"
      && digitalExcerptApprovalMatches(master, excerpt, excerpt?.actorId ? byActor.get(excerpt.actorId) : undefined, byCandidate);
  }).map(master => master.id));

  return new Map(projects.map(project => {
    const offers: DigitalSelection[] = [];
    for (const offer of project.digitalOffers) {
      try {
        const selection = digitalSelectionFromOffer({ ...offer, project } as DigitalSelectionOffer);
        if (selection.tracks.every(track => approved.has(track.masterId))) offers.push(selection);
      } catch (error) { if (!(error instanceof DigitalError)) throw error; }
    }
    const visibleTracks = project.tracks.filter(track => track.status === "RELEASED" || track.status === "ANNOUNCED");
    const previews = new Set(visibleTracks.filter(track => {
      const master = track.digitalMasters[0];
      return !project.membersPreviewEnabled && track.status === "RELEASED" && !!master
        && master.previewAsset?.rightsStatus === "CLEARED" && digitalCommercialAudioReady(master) && approved.has(master.id);
    }).map(track => track.id));
    if (!offers.length && !previews.size) return [project.slug, null] as const;
    const album = offers.find(offer => offer.scope === "ALBUM");
    const view: PublicView = {
      membersPreviewOnly: !!project.membersPreviewEnabled,
      album: album ? { id: album.id, priceCents: album.priceCents, version: album.version, trackCount: album.tracks.length,
        formats: acquiredAlbumFormats(album.tracks), owned: false, partiallyOwned: false, completion: null } : null,
      tracks: visibleTracks.map(track => {
        const master = track.digitalMasters[0];
        const offer = offers.find(offer => offer.scope === "TRACK" && offer.tracks.length === 1 && offer.tracks[0].trackId === track.id);
        return { id: track.id, title: track.title, position: track.position, publication: track.status,
          previewUrl: previews.has(track.id) && master?.previewAsset ? `/media/digital/previews/${master.previewAsset.id}` : null,
          previewDurationMs: track.status === "RELEASED" ? master?.previewDurationMs ?? null : null,
          fullDurationMs: master?.masterAsset.durationMs ?? (track.durationSeconds == null ? null : track.durationSeconds * 1000), owned: false,
          offer: offer ? { id: offer.id, priceCents: offer.priceCents, version: offer.version, formats: acquiredAlbumFormats(offer.tracks) } : null };
      }),
    };
    return [project.slug, view] as const;
  }));
}
