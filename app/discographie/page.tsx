import type { Metadata } from "next";
import Link from "next/link";
import { AlbumCard } from "@/components/album-card";
import { Container } from "@/components/container";
import { PlatformLink } from "@/components/platform-link";
import { ProjectArtwork } from "@/components/project-artwork";
import { featuredProjects, projectsInDevelopment, publishedProjects } from "@/data/discography";
import { siteConfig } from "@/data/site";

export const metadata: Metadata = {
  title: "Discographie",
  description: "Explorez les albums, singles et projets artistiques publiés ou en développement dans l’univers de LNX Beats.",
  alternates: { canonical: "/discographie" },
};

const featuredSlugs = new Set(featuredProjects.map((project) => project.slug));
const otherProjects = publishedProjects.filter((project) => !featuredSlugs.has(project.slug));

export default function DiscographyPage() {
  return (
    <>
      <header className="page-hero page-hero--catalog">
        <Container className="page-hero__grid">
          <div>
            <p className="eyebrow">Écouter · Explorer</p>
            <h1>Discographie</h1>
          </div>
          <div>
            <p className="page-hero__intro">Albums, singles, récits et projets en devenir. Chaque fiche distingue clairement ce qui est publié de ce qui reste en développement.</p>
            <div className="page-hero__meta">
              <span>{publishedProjects.length} parutions</span>
              <span>{projectsInDevelopment.length} projets en développement</span>
            </div>
          </div>
        </Container>
      </header>

      <div className="platform-strip" aria-label="Plateformes d’écoute">
        <Container className="platform-strip__inner">
          {siteConfig.platforms.map((platform) => <PlatformLink key={platform.name} {...platform} />)}
        </Container>
      </div>

      <section className="section catalog-section" aria-labelledby="selection-title">
        <Container>
          <div className="catalog-header catalog-header--large">
            <div>
              <p className="eyebrow">Sélection éditoriale</p>
              <h2 id="selection-title">Projets à la une</h2>
            </div>
            <p>Quelques portes d’entrée dans les différents univers LNX Beats.</p>
          </div>
          <div className="catalog-feature-list">
            {featuredProjects.map((project, index) => (
              <article className="catalog-feature" key={project.slug}>
                <Link className="catalog-feature__art" href={`/album/${project.slug}`}>
                  <ProjectArtwork project={project} priority={index === 0} sizes="(max-width: 820px) 100vw, 42vw" />
                </Link>
                <div className="catalog-feature__copy">
                  <p className="release-card__meta">{project.type === "album" ? "Album" : "Single"}{project.year ? ` · ${project.year}` : ""}</p>
                  <h3><Link href={`/album/${project.slug}`}>{project.title}</Link></h3>
                  <p>{project.shortDescription}</p>
                  <Link className="text-link" href={`/album/${project.slug}`}>Découvrir le projet <span aria-hidden="true">→</span></Link>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>

      <section className="section section--soft catalog-section" aria-labelledby="catalog-title">
        <Container>
          <div className="catalog-header">
            <h2 id="catalog-title">Autres parutions</h2>
            <span>{otherProjects.length} projets</span>
          </div>
          <div className="release-grid">
            {otherProjects.map((project) => <AlbumCard key={project.slug} project={project} />)}
          </div>
        </Container>
      </section>

      <section className="section catalog-section" aria-labelledby="development-title">
        <Container>
          <div className="catalog-header catalog-header--large">
            <div>
              <p className="eyebrow">En chantier</p>
              <h2 id="development-title">Projets en développement</h2>
            </div>
            <p>Ces noms sont intégrés à la structure du catalogue sans inventer de date, de tracklist ou de disponibilité.</p>
          </div>
          <div className="release-grid">
            {projectsInDevelopment.map((project) => <AlbumCard key={project.slug} project={project} />)}
          </div>
        </Container>
      </section>
    </>
  );
}
