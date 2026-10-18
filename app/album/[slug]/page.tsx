import type { Metadata } from "next";
import { EditorialAdSlot } from "@/components/editorial-ad-slot";
import Link from "next/link";
import { UiIcon } from "@/components/ui-icon";
import { notFound, permanentRedirect } from "next/navigation";
import { Container } from "@/components/container";
import { AudioPreviewPlayer } from "@/components/audio-preview-player";
import { JsonLd } from "@/components/json-ld";
import { ProjectArtwork } from "@/components/project-artwork";
import { ProjectPlatforms } from "@/components/project-platforms";
import { Tracklist } from "@/components/tracklist";
import { DigitalAlbumOffer, DigitalTracklist } from "@/components/digital-catalog";
import { DigitalCartNavigation, DigitalDemoBanner } from "@/components/digital-navigation";
import { getAuthSession } from "@/lib/auth/session";
import digitalStyles from "@/components/digital.module.css";
import { publicDigitalProject } from "@/lib/digital/catalog";
import { digitalEnabled } from "@/lib/digital/domain";
import { digitalRuntimeMode } from "@/lib/digital/runtime-policy";
import { resolveCatalogCoverAlt } from "@/lib/catalog/cover-alt";
import {
  getProjectConfidenceLabel,
  getCreditRoleLabel,
  getProjectKindLabel,
  getProjectStatusLabel,
} from "@/lib/catalog/types";
import { getPublicProjectBySlug } from "@/lib/catalog/queries";
import { createPublicPageMetadata } from "@/lib/seo/metadata";
import { buildProjectStructuredData } from "@/lib/seo/structured-data";
import { resolveLegacyPublicSlug } from "@/lib/seo/legacy-slugs";
import { loadDiscographyPreparation } from "@/lib/digital/discography-preparation";
import { discographyPreparationEnabled } from "@/lib/digital/discography-preparation-policy";

type AlbumPageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: AlbumPageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = await getPublicProjectBySlug(slug);

  if (!project) return { title: "Projet introuvable", robots: { index: false, follow: false }, alternates: { canonical: null } };

  const canonical = `/album/${project.slug}`;
  const title = project.seo.title?.trim() || `${project.title} · ${getProjectKindLabel(project.type)}`;

  return createPublicPageMetadata({
    title,
    description: project.seo.description,
    pathname: canonical,
    image: project.cover ?? "/og.png",
    imageAlt: resolveCatalogCoverAlt(project.title, project.coverAlt),
  });
}

export default async function AlbumPage({ params }: AlbumPageProps) {
  const { slug } = await params;
  const project = await getPublicProjectBySlug(slug);

  if (!project) {
    const replacement = await resolveLegacyPublicSlug("album", slug);
    if (replacement) permanentRedirect(`/album/${replacement}`);
    notFound();
  }

  const kind = getProjectKindLabel(project.type);
  const preparation = discographyPreparationEnabled() ? (await loadDiscographyPreparation()).find(p => p.slug === project.slug) : null;
  const comingSoon = !!preparation && preparation.metadataPublicAllowed && preparation.activeOffers === 0;
  const session = digitalEnabled() ? await getAuthSession() : null;
  const digital = digitalEnabled() ? await publicDigitalProject(project.slug, session?.user.status === "ACTIVE" && session.user.emailVerified ? session.user.id : undefined) : null;
  const digitalMode = digitalRuntimeMode() ?? "TEST";
  const status = getProjectStatusLabel(project.status);
  const confidence = getProjectConfidenceLabel(project.dataConfidence.overall);
  const documentedDate = project.releaseDate
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${project.releaseDate}T00:00:00.000Z`))
    : project.year;

  return (
    <>
      <JsonLd id="lnx-project-structured-data" data={buildProjectStructuredData(project)} />
      <header className={`album-hero${digital ? ` ${digitalStyles.albumHero}` : ""}`} data-motion-scene="album">
        <div className="album-hero__backdrop" aria-hidden="true" />
        <Container className="album-hero__inner">
          <Link className="back-link" href="/discographie"><span aria-hidden="true"><UiIcon name="arrow-left" /></span> Retour à la discographie</Link>
          {digital ? <><DigitalDemoBanner mode={digitalMode}/><DigitalCartNavigation/></> : null}
          <div className={`album-hero__grid${digital ? ` ${digitalStyles.albumHeroGrid}` : ""}`}>
            <div data-motion-layer="media"><ProjectArtwork project={project} priority sizes={digital ? "(max-width: 620px) 60vw, 280px" : "(max-width: 820px) 100vw, 48vw"} className="album-hero__art" /></div>
            <div className="album-hero__content" data-motion-layer="copy">
              <p className="album-status"><span>{kind}</span><span>{status}</span></p>
              <h1>{project.title}</h1>
              {project.primaryArtist ? <p className="eyebrow">Artiste principal · {project.primaryArtist}</p> : null}
              {comingSoon ? <p role="status">Arrive bientôt. Cette fiche présente la sortie ; la vente et les téléchargements ne sont pas encore disponibles.</p> : null}
              {project.subtitle ? <p className="album-hero__subtitle">{project.subtitle}</p> : null}
              {digital ? project.shortDescription ? <p className="album-hero__description">{project.shortDescription}</p> : null : <p className="album-hero__description">{project.shortDescription || project.description}</p>}
              {digital ? <DigitalAlbumOffer album={digital.album}/> : null}
              <dl className={`album-facts${digital ? ` ${digitalStyles.albumFacts}` : ""}`}>
                <div><dt>Type</dt><dd>{kind}</dd></div>
                <div><dt>Date</dt><dd>{documentedDate ?? "Non documentée"}</dd></div>
                <div><dt>Statut</dt><dd>{status}</dd></div>
                <div><dt>Données</dt><dd>{confidence}</dd></div>
                {project.genres.length > 0 ? <div><dt>Genres</dt><dd>{project.genres.join(" · ")}</dd></div> : null}
                {project.credits.length > 0 ? (
                  <div>
                    <dt>Crédits documentés</dt>
                    <dd>{project.credits.map((credit) => `${getCreditRoleLabel(credit.role)} : ${credit.name}${credit.detail ? ` (${credit.detail})` : ""}`).join(" · ")}</dd>
                  </div>
                ) : null}
              </dl>
              {project.audioPreview && !digital?.tracks.some(t => t.previewUrl) ? <div className="album-audio-preview">
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
        <Container className={`${digital ? digitalStyles.albumDetails : "album-details__grid"} motion-reveal motion-reveal--soft`}>
          {digital ? <DigitalTracklist view={digital} mode={digitalMode} /> : null}
          <aside className={`album-editorial-note${digital ? ` ${digitalStyles.albumEditorial}` : ""}`}>
            <p className="eyebrow">Derrière le projet</p>
            <h2>{project.description ? "L’histoire qui ouvre la musique." : "Le récit viendra trouver sa place."}</h2>
            <p>{project.description || "Aucun récit éditorial n’est publié pour ce projet à ce jour."}</p>
          </aside>
          {!digital ? <Tracklist project={project} /> : null}
        </Container>
      </section>
      <EditorialAdSlot pathname={`/album/${project.slug}`} slot="content" />
    </>
  );
}
