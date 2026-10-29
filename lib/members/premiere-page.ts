import "server-only";
import { listPublicProjects } from "@/lib/catalog/queries";
import type { PublicProject } from "@/lib/catalog/types";
import { digitalEnabled } from "@/lib/digital/domain";
import { premiereMemberAllowed } from "./premiere-policy";
import { listMemberPremieres, listPublishedPremiereAnnouncements } from "./previews";

type Actor = Parameters<typeof premiereMemberAllowed>[0];
type MemberPremiere = Awaited<ReturnType<typeof listMemberPremieres>>[number];
type ApprovedAnnouncement = Awaited<ReturnType<typeof listPublishedPremiereAnnouncements>>[number];
type PublicPresentation = Pick<PublicProject, "slug" | "title" | "type" | "status" | "publicVisible" | "releaseDate" | "cover" | "shortDescription">;
export type PremierePageAnnouncement = {
  id: string; slug: string; title: string; type: "ALBUM" | "SINGLE";
  releaseDate: string; coverUrl: string; description: string; trackCount: number;
};
export type PremierePageData = { announcements: PremierePageAnnouncement[]; memberPremieres: MemberPremiere[] };
type Sources = {
  enabled: () => boolean;
  publicProjects: () => Promise<readonly PublicPresentation[]>;
  announcements: (now: Date) => Promise<readonly ApprovedAnnouncement[]>;
  members: (actor: Actor, now: Date) => Promise<readonly MemberPremiere[]>;
};
const sources: Sources = {
  enabled: digitalEnabled,
  publicProjects: listPublicProjects,
  announcements: now => listPublishedPremiereAnnouncements(undefined, now),
  members: (actor, now) => listMemberPremieres(actor, undefined, now),
};
const publicCover = /^\/media\/catalog\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const memberCover = /^\/media\/members-premieres\/covers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Read-only page data. Public announcements and member-only media are separate
 * projections of the same already-published version. An invalid/inactive actor
 * follows the anonymous branch and never invokes the member repository. */
export async function loadPremierePageData(actor: Actor, now = new Date(), dependencies: Sources = sources): Promise<PremierePageData> {
  if (!dependencies.enabled()) return { announcements: [], memberPremieres: [] };
  const memberAllowed = premiereMemberAllowed(actor);
  const [publicProjects, eligible] = await Promise.all([
    dependencies.publicProjects(),
    memberAllowed ? dependencies.members(actor, now) : dependencies.announcements(now),
  ]);
  const presentations = new Map(publicProjects.map(project => [project.slug, project]));
  const announcements: PremierePageAnnouncement[] = [];
  const memberPremieres: MemberPremiere[] = [];
  const counts = new Map<string, number>();
  for (const project of eligible) counts.set(project.slug, (counts.get(project.slug) ?? 0) + 1);
  for (const project of eligible) {
    const presentation = presentations.get(project.slug);
    const coverUrl = memberAllowed ? project.coverUrl.replace(memberCover, "/media/catalog/$1") : project.coverUrl;
    if (counts.get(project.slug) !== 1 || !presentation || presentation.status !== "published" || !presentation.publicVisible
      || !["ALBUM", "SINGLE"].includes(project.type) || presentation.type.toUpperCase() !== project.type
      || presentation.title !== project.title || presentation.releaseDate !== project.releaseDate
      || !publicCover.test(coverUrl) || presentation.cover !== coverUrl) continue;
    // Only this allowlist reaches the anonymous shell; no spreading repository
    // objects that may contain private proof, file or account fields.
    announcements.push({ id: project.id, slug: project.slug, title: project.title, type: project.type as "ALBUM" | "SINGLE",
      releaseDate: project.releaseDate, coverUrl, description: presentation.shortDescription,
      trackCount: "tracks" in project ? project.tracks.length : project.trackCount });
    if (memberAllowed && "tracks" in project) memberPremieres.push(project);
  }
  return { announcements, memberPremieres };
}
