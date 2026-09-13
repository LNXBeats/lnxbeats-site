import type { Metadata } from "next";

import { CreationMediaStage } from "@/components/creations/creation-media-stage";
import { Container } from "@/components/container";
import { listPublicCreations } from "@/lib/creations/queries";
import { createPublicPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPublicPageMetadata({
  title: "Créations et collaborations",
  description: "Découvrez les créations originales et collaborations multimédias de LNX Beats : musique, images et vidéos réunies dans un même espace.",
  pathname: "/creations",
});

export default async function CreationsPage() {
  const creations = await listPublicCreations();
  return (
    <div className="creations-page">
      <Container className="creations-page__container">
        <header className="creations-intro">
          <p className="creations-intro__eyebrow">LNX Beats · Studio ouvert</p>
          <h1>Créations <em>&amp; collaborations</em></h1>
          <p>Des rencontres, des images et des sons. Chaque projet garde ici sa forme propre, de la pièce audio au récit filmé.</p>
        </header>
        {creations.length ? (
          <CreationMediaStage creations={creations} initialSlug={creations[0]?.slug} />
        ) : (
          <section className="creations-empty" aria-labelledby="creations-empty-title">
            <span aria-hidden="true">LNX</span>
            <div>
              <p>Le répertoire se prépare</p>
              <h2 id="creations-empty-title">Les premières créations arrivent bientôt.</h2>
              <p>Aucun brouillon n’est rendu public. Revenez ici pour découvrir les prochaines collaborations de LNX Beats.</p>
            </div>
          </section>
        )}
      </Container>
    </div>
  );
}
