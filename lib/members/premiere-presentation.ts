import { premiereMemberAllowed } from "./premiere-policy";

type Member = Parameters<typeof premiereMemberAllowed>[0];
type Premiere = {
  slug: string;
  tracks: readonly { id: string; previewUrl: string; durationMs: number | null }[];
};
type PreviewTrack = { id: string; previewUrl: string | null; previewDurationMs: number | null };
type MemberPreviewTrack = { id: string; previewUrl: string; previewDurationMs: number };
type DigitalPreviewView = { membersPreviewOnly?: boolean; tracks: PreviewTrack[] };
export type MemberPreviewAccess = "sign-in" | "verify-email" | "available" | "unavailable";

const memberExcerptUrl = /^\/media\/members-premieres\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Presentation only: premieres must come from listMemberPremieres, which checks
 * the exact publication, source, rights and listening approvals. The protected
 * media route repeats those checks on every request; no public URL is created. */
export function memberPremiereTracks(actor: Member, slug: string, premieres: readonly Premiere[]): MemberPreviewTrack[] {
  if (!premiereMemberAllowed(actor)) return [];
  const matching = premieres.filter(project => project.slug === slug);
  if (matching.length !== 1) return [];
  const tracks = matching[0].tracks;
  const counts = new Map<string, number>();
  for (const track of tracks) counts.set(track.id, (counts.get(track.id) ?? 0) + 1);
  return tracks.filter(track => counts.get(track.id) === 1 && memberExcerptUrl.test(track.previewUrl)
    && track.durationMs !== null && Number.isSafeInteger(track.durationMs) && track.durationMs > 0 && track.durationMs <= 60_000)
    .map(track => ({ id: track.id, previewUrl: track.previewUrl, previewDurationMs: track.durationMs! }));
}

/** Authenticated fallback only; the public-jukebox URL policy is not widened. */
export function jukeboxMemberPremierePreview(actor: Member, slug: string, premieres: readonly Premiere[]): { url: string; durationMs: number } | null {
  const track = memberPremiereTracks(actor, slug, premieres)[0];
  return track ? { url: track.previewUrl, durationMs: track.previewDurationMs } : null;
}

/** Only the listening projection changes. Offer identity, amount, ownership and
 * commercial rules remain the exact values returned by publicDigitalProject. */
export function withMemberPremierePreviews<T extends DigitalPreviewView>(actor: Member, slug: string, view: T, premieres: readonly Premiere[]): T & { memberPreviewAccess?: MemberPreviewAccess } {
  if (!view.membersPreviewOnly) return view;
  const previews = new Map(memberPremiereTracks(actor, slug, premieres).map(track => [track.id, track]));
  const tracks = view.tracks.map(track => {
    const preview = previews.get(track.id);
    return !track.previewUrl && preview ? { ...track, previewUrl: preview.previewUrl, previewDurationMs: preview.previewDurationMs } : track;
  });
  const memberPreviewAccess: MemberPreviewAccess = !actor || actor.status !== "ACTIVE" ? "sign-in"
    : !actor.emailVerified ? "verify-email"
      : tracks.some(track => track.previewUrl) ? "available" : "unavailable";
  return { ...view, tracks, memberPreviewAccess };
}
