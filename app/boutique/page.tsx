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
              <p>Le lien mène vers l’espace musical officiel. Les disponibilités et les éventuels achats y sont gérés hors de ce site.</p>
              <ButtonLink href={siteConfig.shops[0].url} external>Ouvrir DistroKid Direct</ButtonLink>
            </div>
          </article>
          <article className="shop-card">
            <span className="shop-card__index">02 · CRÉATIONS</span>
            <div className="shop-card__content">
              <h2>Etsy</h2>
              <p>Le lien mène vers la page Etsy officielle de LNX Beats. Son contenu et ses disponibilités peuvent évoluer indépendamment de ce site.</p>
              <ButtonLink href={siteConfig.shops[1].url} external>Ouvrir la page Etsy</ButtonLink>
            </div>
          </article>
        </Container>
      </section>
      <section className="section section--soft">
        <Container className="content-columns motion-reveal">
          <p className="content-columns__label">Éditions futures</p>
          <div className="editorial-copy">
            <p>Certains univers pourront un jour prendre une forme physique.</p>
            <p>Albums sur CD, éditions limitées, objets collector ou prolongements visuels font partie des pistes à étudier. Rien n’est annoncé ni disponible ici pour le moment : aucun produit, stock, prix ou calendrier n’est confirmé.</p>
          </div>
        </Container>
      </section>
    </>
  );
}
