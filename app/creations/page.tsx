
import { T } from "@/components/site-language";
import { OriginalName } from "@/components/original-name";
import type { Metadata } from "next";

import { CreationMediaStage } from "@/components/creations/creation-media-stage";
import { Container } from "@/components/container";
import { listPublicCreations } from "@/lib/creations/queries";
import { createPublicPageMetadata } from "@/lib/seo/metadata";
import { getSiteLocale, serverT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getSiteLocale();
  return createPublicPageMetadata({
  title: serverT(locale, "Créations et collaborations"),
  description: serverT(locale, "Découvrez les créations originales et collaborations multimédias de LNX Beats : musique, images et vidéos réunies dans un même espace."),
  imageAlt: serverT(locale, "LNX Beats — Chaque histoire mérite sa musique."),
  pathname: "/creations",
  });
}

export default async function CreationsPage() {
  const creations = await listPublicCreations();
  return (
    <div className="creations-page">
      <Container className="creations-page__container">
        <header className="creations-intro">
          <p className="creations-intro__eyebrow"><T text="LNX Beats · Studio ouvert"/></p>
          <h1><T text="Créations"/> <em><T text="& collaborations"/></em></h1>
          <p><T text="Des rencontres, des images et des sons. Chaque projet garde ici sa forme propre, de la pièce audio au récit filmé."/></p>
        </header>
        {creations.length ? (
          <CreationMediaStage creations={creations} initialSlug={creations[0]?.slug} />
        ) : (
          <section className="creations-empty" aria-labelledby="creations-empty-title">
            <span aria-hidden="true"><OriginalName>LNX</OriginalName></span>
            <div>
              <p><T text="Le répertoire se prépare"/></p>
              <h2 id="creations-empty-title"><T text="Les premières créations arrivent bientôt."/></h2>
              <p><T text="Aucun brouillon n’est rendu public. Revenez ici pour découvrir les prochaines collaborations de LNX Beats."/></p>
            </div>
          </section>
        )}
      </Container>
    </div>
  );
}
