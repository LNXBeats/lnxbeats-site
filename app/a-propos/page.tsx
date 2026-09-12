import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";
import { artistBiography } from "@/data/artist";
import "../v110-editorial-polish.css";

export const metadata: Metadata = {
  title: "À propos",
  description: artistBiography.short,
  alternates: { canonical: "/a-propos" },
};

export default function AboutPage() {
  return (
    <>
      <header className="about-hero about-hero--editorial" data-motion-scene="about">
        <Container className="about-hero__grid">
          <div className="about-hero__copy about-hero__copy--editorial" data-motion-layer="copy">
            <p className="eyebrow">Derrière LNX Beats</p>
            <h1>Ludovic<br /><em>Mathon.</em></h1>
            <p>{artistBiography.short}</p>
          </div>
          <div className="about-hero__portrait about-hero__portrait--editorial" data-motion-layer="media">
            <Image src="/assets/hero-mobile.jpg" alt="LNX Beats dans une ambiance de studio sombre" fill loading="eager" sizes="(max-width: 820px) 100vw, 48vw" />
            <span aria-hidden="true">Portrait / studio</span>
          </div>
        </Container>
      </header>
      <section className="section about-story-scene about-story-scene--editorial">
        <Container className="about-teaser about-teaser--copy-only about-teaser--editorial motion-reveal motion-reveal--soft">
          <div className="about-teaser__copy about-editorial__copy">
            <p className="eyebrow">La démarche artistique</p>
            <h2>Faire du quotidien une œuvre musicale.</h2>
            <div className="about-editorial__biography">
              {artistBiography.principal.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
            <div className="about-editorial__continuation">
              <p>LNX Beats ne cherche pas à faire entrer chaque récit dans la même couleur. Le choix du ton, de la voix et du rythme dépend de ce que l’histoire demande.</p>
              <p>Cette liberté permet aux chroniques du quotidien, aux récits familiaux, à l’humour, à l’émotion et à l’expérimentation de cohabiter sans perdre leur singularité.</p>
            </div>
            <ButtonLink href="/discographie" variant="quiet">Écouter la discographie</ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
