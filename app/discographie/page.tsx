
import { T } from "@/components/site-language";
import { OriginalName } from "@/components/original-name";
import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/container";
import { ProjectJukebox, type JukeboxProject } from "@/components/home-jukebox";
import { listDiscographyProjects } from "@/lib/catalog/queries";
import { DEFAULT_DISCOGRAPHY_SORT, visibleDiscographyProjects } from "@/lib/catalog/jukebox";
import { jukeboxPublicPreview } from "@/lib/catalog/jukebox-preview";
import { createPublicPageMetadata } from "@/lib/seo/metadata";
import { digitalEnabled } from "@/lib/digital/domain";
import { digitalRuntimeMode } from "@/lib/digital/runtime-policy";
import { publicDigitalProject } from "@/lib/digital/catalog";
import { publicDigitalProjects } from "@/lib/digital/public-catalog";
import { digitalCardOffer } from "@/lib/digital/catalog-card";
import { AddDigitalOffer } from "@/components/digital-catalog";
import { DigitalCartNavigation, DigitalDemoBanner } from "@/components/digital-navigation";
import { ProjectArtwork } from "@/components/project-artwork";
import digitalStyles from "@/components/digital.module.css";
import { loadDiscographyPreparation } from "@/lib/digital/discography-preparation";
import { discographyPreparationEnabled } from "@/lib/digital/discography-preparation-policy";
import "../v064-discography.css";
import { getSiteLocale, serverT } from "@/lib/i18n/server";
import { getAuthSession } from "@/lib/auth/session";
import { listMemberPremieres } from "@/lib/members/previews";
import { jukeboxMemberPremierePreview } from "@/lib/members/premiere-presentation";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getSiteLocale();
  return createPublicPageMetadata({
  title: serverT(locale, "Discographie et albums"),
  description: serverT(locale, "Albums, singles et projets en développement de LNX Beats, avec des fiches qui distinguent les informations confirmées de celles encore inconnues."),
  imageAlt: serverT(locale, "LNX Beats — Chaque histoire mérite sa musique."),
  pathname: "/discographie",
  });
}

export const dynamic = "force-dynamic";

function discographyView(
  projects: Awaited<ReturnType<typeof listDiscographyProjects>>["projects"],
  digitalViews: ReadonlyMap<string, Awaited<ReturnType<typeof publicDigitalProject>>>,
  actor: Parameters<typeof listMemberPremieres>[0],
  premieres: Awaited<ReturnType<typeof listMemberPremieres>>,
): JukeboxProject[] {
  return projects.map((project) => ({
    slug: project.slug,
    title: project.title,
    type: project.type,
    status: project.status,
    year: project.year,
    releaseDate: project.releaseDate,
    cover: project.cover,
    coverAlt: project.coverAlt,
    artworkTone: project.artworkTone,
    audioPreview: jukeboxPublicPreview(project, digitalViews.get(project.slug) ?? null)
      ?? jukeboxMemberPremierePreview(actor, project.slug, premieres),
    membersPreviewOnly: digitalViews.get(project.slug)?.membersPreviewOnly ?? false,
    featured: project.featured,
    catalogPosition: project.catalogPosition,
    jukeboxPosition: project.jukeboxPosition,
  }));
}

export default async function DiscographyPage() {
  const locale = await getSiteLocale();
  const digitalMode = digitalRuntimeMode() ?? "TEST";
  const { projects: publicProjects } = await listDiscographyProjects();
  const projects = visibleDiscographyProjects(publicProjects, "all", DEFAULT_DISCOGRAPHY_SORT);
  const preparation = discographyPreparationEnabled() ? await loadDiscographyPreparation() : [];
  const soon = new Set(preparation.filter(p => p.metadataPublicAllowed && p.activeOffers === 0).map(p => p.slug));
  const candidates = digitalEnabled() ? projects.filter(p => p.status === "published" || soon.has(p.slug)) : [];
  const digitalViews = await publicDigitalProjects(candidates.map(project => project.slug));
  const digitalProjects = candidates.map(project => ({ project, view: digitalViews.get(project.slug) ?? null }));
  const session = digitalEnabled() ? await getAuthSession() : null;
  const premieres = session ? await listMemberPremieres(session.user) : [];
  const sceneProjects = discographyView(projects, digitalViews, session?.user, premieres);

  return (
    <section className="v064-discography-stage" aria-label={serverT(locale, "Discographie")}>
      <Container className="v064-discography-container">
        {digitalEnabled() ? <><DigitalCartNavigation/><DigitalDemoBanner mode={digitalMode}/></> : null}
        <ProjectJukebox
          projects={sceneProjects}
          initialIndex={0}
          eyebrow="LNX Beats · Discographie"
          heading="Discographie"
          eager
        />
        {digitalEnabled() ? <section className={digitalStyles.panel} aria-labelledby="digital-catalogue-title">
          <div className={digitalStyles.heading}><div><p className="eyebrow"><T text={digitalMode==="LIVE"?"LNX Beats · Musique à télécharger":"DCN-1.0 · revue locale"}/></p><h2 id="digital-catalogue-title"><T text="La musique vous accompagne."/></h2></div>
            <nav className={digitalStyles.tabs} aria-label={serverT(locale, "Achats numériques")}><Link className="text-link" href="/musique/panier"><T text="Panier numérique"/></Link><Link className="text-link" href="/compte/musique"><T text="Ma musique"/></Link></nav></div>
          <p className={digitalStyles.note}><T text={digitalMode==="LIVE"?"Albums et titres à télécharger · formats indiqués sur chaque fiche · usage privé.":"Albums et pistes à télécharger · tarifs QA uniquement · aucune vente LIVE."}/></p>
          <div className={digitalStyles.catalogueGrid}>{digitalProjects.filter(p => soon.has(p.project.slug) || p.view?.album || p.view?.tracks.some(t=>t.offer)).map(({project,view}) => <article className={digitalStyles.panel} key={project.slug}>
            <Link href={`/album/${project.slug}`} className={digitalStyles.coverLink}><ProjectArtwork project={project} sizes="(max-width: 768px) 45vw, 25vw" /><h3><OriginalName>{project.title}</OriginalName></h3></Link>
            {soon.has(project.slug) ? <p role="status"><T text="Arrive bientôt · vente et téléchargements indisponibles."/></p> : <><p className={digitalStyles.muted}><T text={view?.tracks.length === 1 ? "{count} piste · extraits de 60 secondes maximum" : "{count} pistes · extraits de 60 secondes maximum"} values={{count:view?.tracks.length ?? 0}}/></p>
            {(() => { const offer = digitalCardOffer(project.type, view); return offer ? <AddDigitalOffer id={offer.id} priceCents={offer.priceCents} label={offer.label} formats={offer.formats} /> : <Link className="text-link" href={`/album/${project.slug}`}><T text="Choisir les pistes"/></Link>; })()}</>}
          </article>)}</div>
        </section> : null}
        <details className="discography-directory">
          <summary>
            <span><T text="Accès direct aux projets"/></span>
            <small><T text={sceneProjects.length === 1 ? "{count} fiche" : "{count} fiches"} values={{count:sceneProjects.length}}/></small>
          </summary>
          <nav aria-label={serverT(locale, "Toutes les fiches de la discographie")}>
            <ul>
              {sceneProjects.map((project) => (
                <li key={project.slug}>
                  <Link href={`/album/${project.slug}`}>
                    <OriginalName>{project.title}</OriginalName>
                    <small><T text={project.type === "album" ? "Album" : project.type === "single" ? "Single" : "Projet"}/>{project.year ? ` · ${project.year}` : ""}</small>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </details>
      </Container>
    </section>
  );
}
