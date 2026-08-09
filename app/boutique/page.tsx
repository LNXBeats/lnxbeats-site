import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";
import { siteConfig } from "@/data/site";

export const metadata: Metadata = {
  title: "Boutique",
  description: "Accéder aux boutiques officielles LNX Beats sur DistroKid Direct et Etsy.",
  alternates: { canonical: "/boutique" },
};

export default function ShopPage() {
  return (
    <>
      <header className="page-hero">
        <Container className="page-hero__grid">
          <div><p className="eyebrow">Boutiques officielles</p><h1>Boutique</h1></div>
          <p className="page-hero__intro">Deux destinations directes pour découvrir les sorties et créations proposées par LNX Beats. Aucun paiement n’est traité sur ce site.</p>
        </Container>
      </header>
      <section className="section">
        <Container className="shop-grid">
          <article className="shop-card">
            <span className="shop-card__index">01 · MUSIQUE</span>
            <div className="shop-card__content">
              <h2>DistroKid Direct</h2>
              <p>Retrouvez la boutique musicale officielle LNX Beats et accédez directement aux sorties disponibles.</p>
              <ButtonLink href={siteConfig.shops[0].url} external>Visiter la boutique</ButtonLink>
            </div>
          </article>
          <article className="shop-card">
            <span className="shop-card__index">02 · CRÉATIONS</span>
            <div className="shop-card__content">
              <h2>Etsy</h2>
              <p>Découvrez la sélection LNX Beats actuellement proposée sur Etsy, via la boutique officielle.</p>
              <ButtonLink href={siteConfig.shops[1].url} external>Ouvrir Etsy</ButtonLink>
            </div>
          </article>
        </Container>
      </section>
    </>
  );
}
