
import { T } from "@/components/site-language";
import { OriginalName } from "@/components/original-name";
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
import { LocalizedEditorial } from "@/components/localized-editorial";
import { getSiteLocale } from "@/lib/i18n/server";
import { localeIntl } from "@/lib/i18n/config";
import { listMemberPremieres } from "@/lib/members/previews";
import { withMemberPremierePreviews } from "@/lib/members/premiere-presentation";

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
  const locale = await getSiteLocale();
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
  const publicDigital = digitalEnabled() ? await publicDigitalProject(project.slug, session?.user.status === "ACTIVE" && session.user.emailVerified ? session.user.id : undefined) : null;
  const premieres = publicDigital?.membersPreviewOnly ? await listMemberPremieres(session?.user, undefined, undefined, { slug: project.slug }) : [];
  const digital = publicDigital ? withMemberPremierePreviews(session?.user, project.slug, publicDigital, premieres) : null;
  const digitalMode = digitalRuntimeMode() ?? "TEST";
  const status = getProjectStatusLabel(project.status);
  const confidence = getProjectConfidenceLabel(project.dataConfidence.overall);
  const documentedDate = project.releaseDate
    ? new Intl.DateTimeFormat(localeIntl(locale), { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${project.releaseDate}T00:00:00.000Z`))
    : project.year;

  return (
    <>
      <JsonLd id="lnx-project-structured-data" data={buildProjectStructuredData(project)} />
      <header className={`album-hero${digital ? ` ${digitalStyles.albumHero}` : ""}`} data-motion-scene="album">
        <div className="album-hero__backdrop" aria-hidden="true" />
        <Container className="album-hero__inner">
          <Link className="back-link" href="/discographie"><span aria-hidden="true"><UiIcon name="arrow-left" /></span>  <T text="Retour à la discographie"/></Link>
          {digital ? <><DigitalDemoBanner mode={digitalMode}/><DigitalCartNavigation/></> : null}
          <div className={`album-hero__grid${digital ? ` ${digitalStyles.albumHeroGrid}` : ""}`}>
            <div data-motion-layer="media"><ProjectArtwork project={project} priority sizes={digital ? "(max-width: 620px) 60vw, 280px" : "(max-width: 820px) 100vw, 48vw"} className="album-hero__art" /></div>
            <div className="album-hero__content" data-motion-layer="copy">
              <p className="album-status"><T text={kind}/><T text={status}/></p>
              <h1><OriginalName>{project.title}</OriginalName></h1>
              {project.primaryArtist ? <p className="eyebrow"><T text="Artiste principal"/> · <OriginalName>{project.primaryArtist}</OriginalName></p> : null}
              {comingSoon ? <p role="status"><T text="Arrive bientôt. Cette fiche présente la sortie ; la vente et les téléchargements ne sont pas encore disponibles."/></p> : null}
              {project.subtitle ? <p className="album-hero__subtitle"><LocalizedEditorial text={project.subtitle} names={[project.title]}/></p> : null}
              {digital ? project.shortDescription ? <p className="album-hero__description"><LocalizedEditorial text={project.shortDescription} names={[project.title]}/></p> : null : <p className="album-hero__description"><LocalizedEditorial text={project.shortDescription || project.description} names={[project.title]}/></p>}
              {digital ? <DigitalAlbumOffer album={digital.album}/> : null}
              <dl className={`album-facts${digital ? ` ${digitalStyles.albumFacts}` : ""}`}>
                <div><dt><T text="Type"/></dt><dd><T text={kind}/></dd></div>
                <div><dt><T text="Date"/></dt><dd>{documentedDate ?? <T text="Non documentée"/>}</dd></div>
                <div><dt><T text="Statut"/></dt><dd><T text={status}/></dd></div>
                <div><dt><T text="Données"/></dt><dd><T text={confidence}/></dd></div>
                {project.genres.length > 0 ? <div><dt><T text="Genres"/></dt><dd>{project.genres.join(" · ")}</dd></div> : null}
                {project.credits.length > 0 ? (
                  <div>
                    <dt><T text="Crédits"/></dt>
                    <dd>{project.credits.map((credit, index) => <span key={`${credit.role}-${credit.name}-${index}`}>{index ? " · " : ""}<T text={getCreditRoleLabel(credit.role)}/> : <OriginalName>{credit.name}</OriginalName></span>)}</dd>
                  </div>
                ) : null}
              </dl>
              {project.audioPreview && !digital?.tracks.some(t => t.previewUrl) ? <div className="album-audio-preview">
                <AudioPreviewPlayer
                  src={project.audioPreview.url}
                  title={project.title}
                  durationMs={project.audioPreview.durationMs}
                />
                {project.platforms.length ? <p><T text="Écouter le titre complet"/></p> : null}
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
            <p className="eyebrow"><T text="Derrière le projet"/></p>
            <h2><T text={project.description ? "L’histoire qui ouvre la musique." : "Le récit viendra trouver sa place."}/></h2>
            <p><LocalizedEditorial text={project.description || "Aucun récit éditorial n’est publié pour ce projet à ce jour."} names={[project.title, project.primaryArtist ?? ""]}/></p>
          </aside>
          {!digital ? <Tracklist project={project} /> : null}
        </Container>
      </section>
      <EditorialAdSlot pathname={`/album/${project.slug}`} slot="content" />
    </>
  );
}
