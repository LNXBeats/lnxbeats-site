import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CreationMediaStage } from "@/components/creations/creation-media-stage";
import { Container } from "@/components/container";
import { JsonLd } from "@/components/json-ld";
import { creationArtwork } from "@/lib/creations/types";
import { getPublicCreation, listPublicCreations } from "@/lib/creations/queries";
import { createPublicPageMetadata } from "@/lib/seo/metadata";
import { buildCreationStructuredData } from "@/lib/seo/structured-data";

export const dynamic = "force-dynamic";

function isoDuration(durationMs: number | null) {
  if (!durationMs || durationMs <= 0) return undefined;
  const seconds = Math.max(1, Math.round(durationMs / 1_000));
  return `PT${seconds}S`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const creation = await getPublicCreation(slug);
  if (!creation) return {};
  const image = creationArtwork(creation);
  return createPublicPageMetadata({
    title: creation.seo.title,
    socialTitle: `${creation.title} — Création LNX Beats`,
    description: creation.seo.description,
    pathname: `/creations/${creation.slug}`,
    image: image?.url,
    imageAlt: image?.alt || `Visuel de ${creation.title}`,
    imageWidth: image?.width ?? undefined,
    imageHeight: image?.height ?? undefined,
  });
}

export default async function CreationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [creation, allCreations] = await Promise.all([getPublicCreation(slug), listPublicCreations()]);
  if (!creation) notFound();
  const artwork = creationArtwork(creation);
  const related = allCreations.filter((item) => item.slug !== creation.slug).slice(0, 3);
  const structuredData = buildCreationStructuredData({
    slug: creation.slug,
    title: creation.title,
    description: creation.seo.description,
    image: artwork?.url,
    publishedAt: creation.publishedAt,
    collaborator: creation.collaborator,
    category: creation.category,
    links: creation.links.map(({ url }) => url),
    video: creation.video ? {
      published: true,
      contentUrl: creation.video.url,
      thumbnailUrl: creation.poster?.url ?? creation.cover?.url,
      name: creation.title,
      description: creation.seo.description,
      uploadDate: creation.publishedAt,
      duration: isoDuration(creation.video.durationMs),
    } : null,
  });

  return (
    <article className="creation-detail-page">
      <Container className="creation-detail-page__container">
        <nav className="creation-detail-page__breadcrumb" aria-label="Fil d’Ariane">
          <Link href="/creations">Créations</Link><span aria-hidden="true">/</span><span>{creation.title}</span>
        </nav>
        <CreationMediaStage creations={[creation]} showRail={false} showGrid={false} headingLevel="h1" />

        <div className="creation-detail-content">
          {creation.description ? (
            <section>
              <p className="creation-detail-content__label">Le projet</p>
              <h2>À propos de cette création.</h2>
              <div className="creation-detail-content__prose">{creation.description}</div>
            </section>
          ) : null}
          {creation.credits || creation.links.length ? (
            <aside>
              {creation.credits ? <div><p className="creation-detail-content__label">Crédits</p><p className="creation-detail-content__credits">{creation.credits}</p></div> : null}
              {creation.links.length ? <div><p className="creation-detail-content__label">Prolonger</p><ul>{creation.links.map((link) => <li key={link.id}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}<span aria-hidden="true">↗</span></a></li>)}</ul></div> : null}
            </aside>
          ) : null}
        </div>

        {related.length ? (
          <section className="creation-related" aria-labelledby="creation-related-title">
            <div><p className="creation-detail-content__label">À suivre</p><h2 id="creation-related-title">D’autres rencontres.</h2></div>
            <div>{related.map((item) => <Link href={`/creations/${item.slug}`} key={item.slug}><span>{item.category || "Création"}</span><strong>{item.title}</strong><small>Découvrir <span aria-hidden="true">→</span></small></Link>)}</div>
          </section>
        ) : null}
      </Container>
      <JsonLd id={`lnx-creation-${creation.slug}`} data={structuredData} />
    </article>
  );
}
