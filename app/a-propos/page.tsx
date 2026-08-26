import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";
import { artistBiography } from "@/data/artist";

export const metadata: Metadata = {
  title: "À propos",
  description: artistBiography.short,
  alternates: { canonical: "/a-propos" },
};

export default function AboutPage() {
  return (
    <>
      <header className="about-hero">
        <Container className="about-hero__grid">
          <div className="about-hero__copy">
            <p className="eyebrow">Derrière LNX Beats</p>
            <h1>Ludovic<br /><em>Mathon.</em></h1>
            <p>{artistBiography.short}</p>
          </div>
          <div className="about-hero__portrait">
            <Image src="/assets/hero-mobile.jpg" alt="LNX Beats dans une ambiance de studio sombre" fill loading="eager" sizes="(max-width: 820px) 100vw, 48vw" />
            <span aria-hidden="true">Portrait / studio</span>
          </div>
        </Container>
      </header>
      <section className="section about-story-scene">
        <Container className="about-teaser about-teaser--copy-only motion-reveal motion-reveal--soft">
          <div className="about-teaser__copy">
            <p className="eyebrow">La démarche artistique</p>
            <h2>Faire du quotidien une œuvre musicale.</h2>
            {artistBiography.principal.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            <div className="about-story-scene__thread">
              <p>Une histoire d’abord. La forme musicale ensuite.</p>
              <p>LNX Beats ne cherche pas à faire entrer chaque récit dans la même couleur. Le choix du ton, de la voix et du rythme dépend de ce que l’histoire demande.</p>
              <p>Cette liberté permet aux chroniques du quotidien, aux récits familiaux, à l’humour, à l’émotion et à l’expérimentation de cohabiter sans perdre leur singularité.</p>
              <blockquote>Chaque histoire mérite sa musique.</blockquote>
            </div>
            <ButtonLink href="/discographie" variant="quiet">Écouter la discographie</ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
