import type { Metadata } from "next";
import { Container } from "@/components/container";
import { ProjectJukebox, type JukeboxProject } from "@/components/home-jukebox";
import { listDiscographyProjects } from "@/lib/catalog/queries";
import { jukeboxInitialIndex } from "@/lib/catalog/jukebox";
import "../v064-discography.css";

export const metadata: Metadata = {
  title: "Discographie",
  description: "Albums, singles et projets en développement de LNX Beats, avec des fiches qui distinguent les informations confirmées de celles encore inconnues.",
  alternates: { canonical: "/discographie" },
};

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
  }));
}

export default async function DiscographyPage() {
  const { projects, publishedProjects, projectsInDevelopment } = await listDiscographyProjects();
  const sceneProjects = discographyView(projects);

  return (
    <>
      <header className="page-hero page-hero--catalog v064-discography-hero">
        <Container className="page-hero__grid">
          <div>
            <p className="eyebrow">Des récits mis en musique</p>
            <h1>Discographie</h1>
          </div>
          <div>
            <p className="page-hero__intro">Des projets publiés, des récits en cours, et une entrée directe dans leur écoute.</p>
            <div className="page-hero__meta">
              <span>{publishedProjects.length} parutions</span>
              <span>{projectsInDevelopment.length} projets en développement</span>
            </div>
          </div>
          <div className="page-hero__visual page-hero__visual--record" aria-hidden="true">
            <span>LNX</span>
          </div>
        </Container>
      </header>

      <section className="v064-discography-stage" aria-label="Catalogue LNX Beats">
        <Container className="v064-discography-container">
          <ProjectJukebox
            projects={sceneProjects}
            initialIndex={jukeboxInitialIndex(sceneProjects, 2)}
            eyebrow="Catalogue"
            heading="Tous les projets."
            eager
          />
        </Container>
      </section>
    </>
  );
}
