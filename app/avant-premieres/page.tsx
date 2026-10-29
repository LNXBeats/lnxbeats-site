import type { Metadata } from "next";
import { getAuthSession } from "@/lib/auth/session";
import { getSiteLocale, serverT } from "@/lib/i18n/server";
import { loadPremierePageData } from "@/lib/members/premiere-page";
import { premiereMemberAllowed } from "@/lib/members/premiere-policy";
import { withMemberPremierePreviews } from "@/lib/members/premiere-presentation";
import { PremiereExperience, type PremiereShowcaseProject } from "@/components/premiere-experience";
import { publicDigitalProject } from "@/lib/digital/catalog";
import { publicDigitalProjects } from "@/lib/digital/public-catalog";
import { digitalRuntimeMode } from "@/lib/digital/runtime-policy";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getSiteLocale();
  return { title: serverT(locale, "Avant-premières"), alternates: { canonical: "/avant-premieres" }, robots: { index: false, follow: false } };
}
export default async function MemberPremieresPage() {
  const now = new Date(), session = await getAuthSession();
  const member = premiereMemberAllowed(session?.user);
  const { announcements, memberPremieres } = await loadPremierePageData(session?.user, now);
  const purchases: Awaited<ReturnType<typeof publicDigitalProjects>> = member
    ? new Map() : await publicDigitalProjects(announcements.map(project => project.slug));
  // Reuse the existing account-aware projection without a fan-out across the
  // database pool. No offer, consent, publication or notification is written.
  if (member && session) for (const project of announcements) purchases.set(project.slug, await publicDigitalProject(project.slug, session.user.id));
  const projects: PremiereShowcaseProject[] = announcements.map(project => {
    const premiere = memberPremieres.find(item => item.id === project.id);
    const purchase = purchases.get(project.slug);
    const view = purchase ?? (premiere ? { membersPreviewOnly: true, album: null, tracks: premiere.tracks.map(track => ({
      id: track.id, title: track.title, position: track.position, publication: "ANNOUNCED", previewUrl: null,
      previewDurationMs: null, offer: null,
    })) } : null);
    return { ...project, digital: view ? withMemberPremierePreviews(session?.user, project.slug, view, memberPremieres) : null,
      ...(member && premiere ? { voteBinding: premiere.binding } : {}) };
  });
  const access = member ? "member" : session?.user.status === "ACTIVE" && !session.user.emailVerified ? "verify-email" : "guest";
  return <PremiereExperience projects={projects} access={access} initialNow={now.getTime()} mode={digitalRuntimeMode() ?? "TEST"} />;
}
