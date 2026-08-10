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
  description: "Albums, singles et projets en développement de LNX Beats, avec des fiches qui distinguent les informations confirmées de celles encore inconnues.",
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
            <p className="eyebrow">Des récits mis en musique</p>
            <h1>Discographie</h1>
          </div>
          <div>
            <p className="page-hero__intro">Le catalogue réunit les albums, les singles et les projets en développement de LNX Beats. Chaque fiche indique clairement ce qui est publié, confirmé ou encore non documenté.</p>
            <div className="page-hero__meta">
              <span>{publishedProjects.length} parutions</span>
              <span>{projectsInDevelopment.length} projets en développement</span>
            </div>
          </div>
        </Container>
      </header>

      <div className="platform-strip" aria-label="Plateformes d’écoute">
        <Container className="platform-strip__inner motion-reveal motion-reveal--soft">
          {siteConfig.platforms.map((platform) => <PlatformLink key={platform.name} {...platform} />)}
        </Container>
      </div>

      <section className="section catalog-section" aria-labelledby="selection-title">
        <Container>
          <div className="catalog-header catalog-header--large motion-reveal">
            <div>
              <p className="eyebrow">Sélection d’entrée</p>
              <h2 id="selection-title">Trois récits pour commencer.</h2>
            </div>
            <p>Trois projets publiés pour rencontrer les voix, les personnages et les contrastes du catalogue.</p>
          </div>
          <div className="catalog-feature-list motion-reveal motion-reveal--soft">
            {featuredProjects.map((project, index) => (
              <article className="catalog-feature" key={project.slug}>
                <Link className="catalog-feature__art" href={`/album/${project.slug}`}>
                  <ProjectArtwork project={project} priority={index === 0} sizes="(max-width: 820px) 100vw, 42vw" />
                </Link>
                <div className="catalog-feature__copy">
                  <p className="release-card__meta">{project.type === "album" ? "Album" : "Single"}{project.year ? ` · ${project.year}` : ""}</p>
                  <h3><Link href={`/album/${project.slug}`}>{project.title}</Link></h3>
                  <p>{project.shortDescription}</p>
                  <Link className="text-link" href={`/album/${project.slug}`}>Voir la fiche du projet <span aria-hidden="true">→</span></Link>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>

      <section className="section section--soft catalog-section" aria-labelledby="catalog-title">
        <Container>
          <div className="catalog-header motion-reveal">
            <h2 id="catalog-title">Parutions publiées.</h2>
            <span>{otherProjects.length} projets</span>
          </div>
          <div className="release-grid motion-reveal motion-reveal--soft">
            {otherProjects.map((project) => <AlbumCard key={project.slug} project={project} />)}
          </div>
        </Container>
      </section>

      <section className="section catalog-section" aria-labelledby="development-title">
        <Container>
          <div className="catalog-header catalog-header--large motion-reveal">
            <div>
              <p className="eyebrow">Projets en développement</p>
              <h2 id="development-title">Les titres sont posés. Rien de plus n’est inventé.</h2>
            </div>
            <p>Ces projets n’ont pas encore de date, de pochette ou de forme officiellement documentée. Les fiches resteront incomplètes jusqu’à confirmation.</p>
          </div>
          <div className="release-grid motion-reveal motion-reveal--soft">
            {projectsInDevelopment.map((project) => <AlbumCard key={project.slug} project={project} />)}
          </div>
        </Container>
      </section>
    </>
  );
}
