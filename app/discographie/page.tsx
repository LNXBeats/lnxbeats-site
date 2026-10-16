import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/container";
import { ProjectJukebox, type JukeboxProject } from "@/components/home-jukebox";
import { listDiscographyProjects } from "@/lib/catalog/queries";
import { visibleDiscographyProjects } from "@/lib/catalog/jukebox";
import { createPublicPageMetadata } from "@/lib/seo/metadata";
import { digitalEnabled } from "@/lib/digital/domain";
import { digitalRuntimeMode } from "@/lib/digital/runtime-policy";
import { publicDigitalProject } from "@/lib/digital/catalog";
import { AddDigitalOffer } from "@/components/digital-catalog";
import { DigitalCartNavigation, DigitalDemoBanner } from "@/components/digital-navigation";
import { ProjectArtwork } from "@/components/project-artwork";
import digitalStyles from "@/components/digital.module.css";
import "../v064-discography.css";

export const metadata: Metadata = createPublicPageMetadata({
  title: "Discographie et albums",
  description: "Albums, singles et projets en développement de LNX Beats, avec des fiches qui distinguent les informations confirmées de celles encore inconnues.",
  pathname: "/discographie",
});

export const dynamic = "force-dynamic";

function discographyView(projects: Awaited<ReturnType<typeof listDiscographyProjects>>["projects"]): JukeboxProject[] {
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
    audioPreview: project.audioPreview
      ? { url: project.audioPreview.url, durationMs: project.audioPreview.durationMs }
      : null,
    featured: project.featured,
    catalogPosition: project.catalogPosition,
    jukeboxPosition: project.jukeboxPosition,
  }));
}

export default async function DiscographyPage() {
  const digitalMode = digitalRuntimeMode() ?? "TEST";
  const { projects } = await listDiscographyProjects();
  const sceneProjects = visibleDiscographyProjects(discographyView(projects), "all", "editorial");
  const digitalProjects = digitalEnabled() ? await Promise.all(projects.filter(p => p.status === "published")
    .map(async project => ({ project, view: await publicDigitalProject(project.slug) }))) : [];

  return (
    <section className="v064-discography-stage" aria-label="Discographie">
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
          <div className={digitalStyles.heading}><div><p className="eyebrow">{digitalMode==="LIVE"?"LNX Beats · Musique à télécharger":"DCN-1.0 · revue locale"}</p><h2 id="digital-catalogue-title">La musique vous accompagne.</h2></div>
            <nav className={digitalStyles.tabs} aria-label="Achats numériques"><Link className="text-link" href="/musique/panier">Panier numérique</Link><Link className="text-link" href="/compte/musique">Ma musique</Link></nav></div>
          <p className={digitalStyles.note}>{digitalMode==="LIVE"?"Albums et titres à télécharger · WAV + MP3 inclus · usage privé.":"Albums et pistes à télécharger · tarifs QA uniquement · aucune vente LIVE."}</p>
          <div className={digitalStyles.catalogueGrid}>{digitalProjects.filter(p => p.view?.album || p.view?.tracks.some(t=>t.offer)).map(({project,view}) => <article className={digitalStyles.panel} key={project.slug}>
            <Link href={`/album/${project.slug}`} className={digitalStyles.coverLink}><ProjectArtwork project={project} sizes="(max-width: 768px) 45vw, 25vw" /><h3>{project.title}</h3></Link>
            <p className={digitalStyles.muted}>{view?.tracks.length} pistes · extraits de 60 secondes maximum</p>
            {view?.album ? <AddDigitalOffer id={view.album.id} priceCents={view.album.priceCents} label="Ajouter l’album" /> : <Link className="text-link" href={`/album/${project.slug}`}>Choisir les pistes</Link>}
          </article>)}</div>
        </section> : null}
        <details className="discography-directory">
          <summary>
            <span>Accès direct aux projets</span>
            <small>{sceneProjects.length} fiche{sceneProjects.length > 1 ? "s" : ""}</small>
          </summary>
          <nav aria-label="Toutes les fiches de la discographie">
            <ul>
              {sceneProjects.map((project) => (
                <li key={project.slug}>
                  <Link href={`/album/${project.slug}`}>
                    <span>{project.title}</span>
                    <small>{project.type === "album" ? "Album" : project.type === "single" ? "Single" : "Projet"}{project.year ? ` · ${project.year}` : ""}</small>
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
