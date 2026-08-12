import type { Metadata } from "next";
import { CompactProjectCatalog } from "@/components/compact-project-catalog";
import { Container } from "@/components/container";
import { ProjectJukebox, type JukeboxProject } from "@/components/home-jukebox";
import { listDiscographyProjects } from "@/lib/catalog/queries";
import { jukeboxInitialIndex } from "@/lib/catalog/jukebox";

export const metadata: Metadata = {
  title: "Discographie",
  description: "Albums, singles et projets en développement de LNX Beats, avec des fiches qui distinguent les informations confirmées de celles encore inconnues.",
  alternates: { canonical: "/discographie" },
};

export const dynamic = "force-dynamic";

function jukeboxView(projects: Awaited<ReturnType<typeof listDiscographyProjects>>["publishedJukeboxProjects"]): JukeboxProject[] {
  return projects.map((project) => ({
    slug: project.slug,
    title: project.title,
    year: project.year,
    cover: project.cover!,
    coverAlt: project.coverAlt ?? `Pochette de « ${project.title} » — LNX Beats`,
    audioPreview: project.audioPreview ? { url: project.audioPreview.url, durationMs: project.audioPreview.durationMs } : null,
  }));
}

export default async function DiscographyPage() {
  const { publishedProjects, projectsInDevelopment, publishedJukeboxProjects, developmentJukeboxProjects } = await listDiscographyProjects();
  const publishedJukebox = jukeboxView(publishedJukeboxProjects);
  const developmentJukebox = jukeboxView(developmentJukeboxProjects);
  return (
    <>
      <header className="page-hero page-hero--catalog">
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

      {publishedJukebox.length ? <div id="jukebox"><Container><ProjectJukebox projects={publishedJukebox} initialIndex={jukeboxInitialIndex(publishedJukeboxProjects)} eyebrow="Écouter la discographie" heading="Des covers, puis une histoire." variant="published" eager /></Container></div> : null}

      <section className="section section--soft catalog-section catalog-section--compact" aria-labelledby="catalog-title">
        <Container>
          <div className="catalog-header catalog-header--large motion-reveal">
            <div><p className="eyebrow">Catalogue</p><h2 id="catalog-title">Tous les projets.</h2></div>
            <div className="catalog-header__summary"><p>Retrouvez tous les projets LNX Beats.</p><span>{publishedProjects.length} projets publiés</span></div>
          </div>
          <CompactProjectCatalog projects={publishedProjects} />
        </Container>
      </section>

      {developmentJukebox.length ? <div className="development-jukebox-section"><Container><ProjectJukebox projects={developmentJukebox} initialIndex={jukeboxInitialIndex(developmentJukeboxProjects)} eyebrow="En cours de création" heading="Dans les coulisses de LNX Beats." variant="development" /></Container></div> : null}

    </>
  );
}
