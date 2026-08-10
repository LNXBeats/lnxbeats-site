import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";
import { siteConfig } from "@/data/site";

export const metadata: Metadata = {
  title: "Boutique",
  description: "Les prolongements officiels de l’univers LNX Beats sur DistroKid Direct et Etsy.",
  alternates: { canonical: "/boutique" },
};

export default function ShopPage() {
  return (
    <>
      <header className="page-hero">
        <Container className="page-hero__grid">
          <div><p className="eyebrow">Ce qui prolonge la musique</p><h1>Les histoires peuvent laisser une trace.</h1></div>
          <p className="page-hero__intro">Certains univers continuent au-delà de l’écoute. Les deux portes ci-dessous mènent aux espaces officiels de LNX Beats ; aucun achat n’est traité sur ce site.</p>
        </Container>
      </header>
      <section className="section">
        <Container className="shop-grid motion-reveal motion-reveal--soft">
          <article className="shop-card">
            <span className="shop-card__index">01 · MUSIQUE</span>
            <div className="shop-card__content">
              <h2>DistroKid Direct</h2>
              <p>La musique rejoint sa destination officielle, sans intermédiaire ajouté par ce site.</p>
              <ButtonLink href={siteConfig.shops[0].url} external>Rejoindre DistroKid Direct</ButtonLink>
            </div>
          </article>
          <article className="shop-card">
            <span className="shop-card__index">02 · CRÉATIONS</span>
            <div className="shop-card__content">
              <h2>Etsy</h2>
              <p>Les créations actuellement proposées par LNX Beats trouvent ici un autre espace.</p>
              <ButtonLink href={siteConfig.shops[1].url} external>Passer par Etsy</ButtonLink>
            </div>
          </article>
        </Container>
      </section>
      <section className="section section--soft">
        <Container className="content-columns motion-reveal">
          <p className="content-columns__label">Un jour, peut-être</p>
          <div className="editorial-copy">
            <p>Si les univers LNX Beats quittent un jour l’écran, cet espace pourra accueillir leurs formes physiques.</p>
            <p>Rien n’est annoncé pour le moment : ni objet, ni prix, ni date. Seulement une place laissée ouverte.</p>
          </div>
        </Container>
      </section>
    </>
  );
}
