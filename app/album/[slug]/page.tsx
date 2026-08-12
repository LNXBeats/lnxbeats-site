import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/container";
import { AudioPreviewPlayer } from "@/components/audio-preview-player";
import { ProjectArtwork } from "@/components/project-artwork";
import { ProjectPlatforms } from "@/components/project-platforms";
import { Tracklist } from "@/components/tracklist";
import { resolveCatalogCoverAlt } from "@/lib/catalog/cover-alt";
import {
  getProjectConfidenceLabel,
  getCreditRoleLabel,
  getProjectKindLabel,
  getProjectStatusLabel,
} from "@/lib/catalog/types";
import { getPublicProjectBySlug } from "@/lib/catalog/queries";

type AlbumPageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: AlbumPageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = await getPublicProjectBySlug(slug);

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
      images: [{ url: project.cover ?? "/og.png", width: 1200, height: 630, alt: resolveCatalogCoverAlt(project.title, project.coverAlt) }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} — LNX Beats`,
      description: project.seo.description,
      images: [project.cover ?? "/og.png"],
    },
  };
}

export default async function AlbumPage({ params }: AlbumPageProps) {
  const { slug } = await params;
  const project = await getPublicProjectBySlug(slug);

  if (!project) notFound();

  const kind = getProjectKindLabel(project.type);
  const status = getProjectStatusLabel(project.status);
  const confidence = getProjectConfidenceLabel(project.dataConfidence.overall);
  const documentedDate = project.releaseDate
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${project.releaseDate}T00:00:00.000Z`))
    : project.year;

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
                <div><dt>Date</dt><dd>{documentedDate ?? "Non documentée"}</dd></div>
                <div><dt>Statut</dt><dd>{status}</dd></div>
                <div><dt>Données</dt><dd>{confidence}</dd></div>
                {project.genres.length > 0 ? <div><dt>Genres</dt><dd>{project.genres.join(" · ")}</dd></div> : null}
                {project.credits.length > 0 ? (
                  <div>
                    <dt>Crédits confirmés</dt>
                    <dd>{project.credits.map((credit) => `${getCreditRoleLabel(credit.role)} : ${credit.name}${credit.detail ? ` (${credit.detail})` : ""}`).join(" · ")}</dd>
                  </div>
                ) : null}
              </dl>
              {project.audioPreview ? <div className="album-audio-preview">
                <AudioPreviewPlayer
                  src={project.audioPreview.url}
                  title={project.title}
                  durationMs={project.audioPreview.durationMs}
                />
                {project.platforms.length ? <p>Écouter le titre complet</p> : null}
              </div> : null}
              <ProjectPlatforms platforms={project.platforms} />
            </div>
          </div>
        </Container>
      </header>

      <section className="section album-details">
        <Container className="album-details__grid motion-reveal motion-reveal--soft">
          <Tracklist project={project} />
          <aside className="album-editorial-note">
            <p className="eyebrow">Ce qui reste dans l’ombre</p>
            <h2>Le récit grandira ici.</h2>
            <p>Cette fiche distingue les informations confirmées, partielles et non documentées. Pochette, dates, crédits, durées et liens directs restent absents tant qu’ils n’ont pas été confirmés dans le catalogue.</p>
          </aside>
        </Container>
      </section>
    </>
  );
}
