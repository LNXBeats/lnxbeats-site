import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";

export const metadata: Metadata = {
  title: "À propos",
  description: "Découvrir la démarche artistique de LNX Beats.",
  alternates: { canonical: "/a-propos" },
};

export default function AboutPage() {
  return (
    <>
      <header className="page-hero">
        <Container className="page-hero__grid">
          <div><p className="eyebrow">Le projet artistique</p><h1>À propos</h1></div>
          <p className="page-hero__intro">LNX Beats est un projet musical construit autour du récit. Une approche ouverte, capable de passer de l’humour à l’émotion sans perdre son fil.</p>
        </Container>
      </header>
      <section className="section">
        <Container className="about-teaser">
          <div className="about-teaser__image">
            <Image src="/assets/hero-mobile.jpg" alt="LNX Beats dans une ambiance de studio sombre" fill sizes="(max-width: 820px) 100vw, 45vw" priority />
          </div>
          <div className="about-teaser__copy">
            <p className="eyebrow">Une intention</p>
            <h2>Faire vivre une histoire.</h2>
            <p>Le projet LNX Beats explore des personnages, des instants et des émotions à travers la musique. L’écriture et la production servent un même objectif : créer un morceau qui installe un univers dès les premières secondes.</p>
            <p>Cette page sera enrichie au fil des prochains sprints avec la biographie officielle, les repères artistiques et les éléments éditoriaux validés.</p>
            <ButtonLink href="/discographie" variant="quiet">Écouter les projets</ButtonLink>
          </div>
        </Container>
      </section>
      <section className="section section--soft">
        <Container className="content-columns">
          <p className="content-columns__label">La ligne artistique</p>
          <div className="editorial-copy">
            <p>Des morceaux pensés comme des scènes : une voix, une tension, un détail qui change tout.</p>
            <p>LNX Beats construit un catalogue où plusieurs tonalités peuvent cohabiter. Le site restera volontairement évolutif pour accompagner cette diversité sans figer le projet dans une seule définition.</p>
            <blockquote>Chaque histoire mérite sa musique.</blockquote>
          </div>
        </Container>
      </section>
    </>
  );
}
