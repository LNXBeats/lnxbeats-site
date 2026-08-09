import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/container";
import { ProjectArtwork } from "@/components/project-artwork";
import { ProjectPlatforms } from "@/components/project-platforms";
import { Tracklist } from "@/components/tracklist";
import {
  getProjectBySlug,
  getProjectKindLabel,
  getProjectStatusLabel,
  projects,
} from "@/data/discography";

type AlbumPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return projects.map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({ params }: AlbumPageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = getProjectBySlug(slug);

  if (!project) return {};

  const canonical = `/album/${project.slug}`;
  const title = project.seo.title ?? project.title;

  return {
    title,
    description: project.seo.description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
      title: `${title} — LNX Beats`,
      description: project.seo.description,
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "LNX Beats — Chaque histoire mérite sa musique." }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} — LNX Beats`,
      description: project.seo.description,
      images: ["/og.png"],
    },
  };
}

export default async function AlbumPage({ params }: AlbumPageProps) {
  const { slug } = await params;
  const project = getProjectBySlug(slug);

  if (!project) notFound();

  const kind = getProjectKindLabel(project.type);
  const status = getProjectStatusLabel(project.status);

  return (
    <>
      <header className="album-hero">
        <Container>
          <Link className="back-link" href="/discographie"><span aria-hidden="true">←</span> Retour à la discographie</Link>
          <div className="album-hero__grid">
            <ProjectArtwork project={project} priority sizes="(max-width: 820px) 100vw, 48vw" className="album-hero__art" />
            <div className="album-hero__content">
              <p className="album-status"><span>{kind}</span><span>{status}</span></p>
              <h1>{project.title}</h1>
              {project.subtitle ? <p className="album-hero__subtitle">{project.subtitle}</p> : null}
              <p className="album-hero__description">{project.description}</p>
              <dl className="album-facts">
                <div><dt>Type</dt><dd>{kind}</dd></div>
                <div><dt>Année</dt><dd>{project.year ?? "À confirmer"}</dd></div>
                <div><dt>Statut</dt><dd>{status}</dd></div>
                {project.genres.length > 0 ? <div><dt>Genres</dt><dd>{project.genres.join(" · ")}</dd></div> : null}
              </dl>
              <ProjectPlatforms platforms={project.platforms} />
            </div>
          </div>
        </Container>
      </header>

      <section className="section album-details">
        <Container className="album-details__grid">
          <Tracklist project={project} />
          <aside className="album-editorial-note">
            <p className="eyebrow">À propos de cette fiche</p>
            <h2>Une information vérifiable.</h2>
            <p>Les pochettes, dates, genres, durées et liens propres à cette parution seront ajoutés ici dès qu’ils pourront être confirmés. Les liens marqués « profil » mènent au profil officiel de LNX Beats, pas à une page d’album supposée.</p>
          </aside>
        </Container>
      </section>
    </>
  );
}
