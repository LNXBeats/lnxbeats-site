import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/container";
import { ProjectJukebox, type JukeboxProject } from "@/components/home-jukebox";
import { listDiscographyProjects } from "@/lib/catalog/queries";
import { createPublicPageMetadata } from "@/lib/seo/metadata";
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
  }));
}

export default async function DiscographyPage() {
  const { projects } = await listDiscographyProjects();
  const sceneProjects = discographyView(projects);

  return (
    <section className="v064-discography-stage" aria-label="Discographie">
      <Container className="v064-discography-container">
        <ProjectJukebox
          projects={sceneProjects}
          initialIndex={0}
          eyebrow="LNX Beats · Discographie"
          heading="Chaque projet, une histoire."
          eager
        />
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
