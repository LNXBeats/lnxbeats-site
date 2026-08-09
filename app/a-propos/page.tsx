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
          <p className="page-hero__intro">LNX Beats est un projet musical construit autour du récit : des personnages, des scènes ordinaires et des émotions qui deviennent des mondes à part entière.</p>
        </Container>
      </header>
      <section className="section">
        <Container className="about-teaser">
          <div className="about-teaser__image">
            <Image src="/assets/hero-mobile.jpg" alt="LNX Beats dans une ambiance de studio sombre" fill sizes="(max-width: 820px) 100vw, 45vw" preload />
          </div>
          <div className="about-teaser__copy">
            <p className="eyebrow">Une intention</p>
            <h2>Faire vivre une histoire.</h2>
            <p>Le projet LNX Beats explore des personnages, des instants et des émotions à travers la musique. L’écriture et la production servent un même objectif : installer un point de vue et faire vivre une scène dès les premières secondes.</p>
            <p>Humour, observation, sensibilité et formes plus expérimentales peuvent cohabiter. Ce qui relie ces directions n’est pas un genre unique, mais une manière de raconter.</p>
            <ButtonLink href="/discographie" variant="quiet">Écouter les projets</ButtonLink>
          </div>
        </Container>
      </section>
      <section className="section section--soft">
        <Container className="content-columns">
          <p className="content-columns__label">La ligne artistique</p>
          <div className="editorial-copy">
            <p>Des morceaux pensés comme des scènes : une voix, une tension, un détail qui change tout.</p>
            <p>LNX Beats construit un catalogue où plusieurs tonalités peuvent cohabiter : chroniques du quotidien, récits familiaux, regards décalés et projets narratifs encore en développement.</p>
            <p>Les informations biographiques et les repères artistiques plus précis seront intégrés uniquement lorsqu’ils auront été validés.</p>
            <blockquote>Chaque histoire mérite sa musique.</blockquote>
          </div>
        </Container>
      </section>
    </>
  );
}
