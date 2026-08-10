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
      <header className="page-hero">
        <Container className="page-hero__grid">
          <div><p className="eyebrow">Derrière LNX Beats</p><h1>Ludovic Mathon.</h1></div>
          <p className="page-hero__intro">{artistBiography.short}</p>
        </Container>
      </header>
      <section className="section">
        <Container className="about-teaser motion-reveal motion-reveal--soft">
          <div className="about-teaser__image">
            <Image src="/assets/hero-mobile.jpg" alt="LNX Beats dans une ambiance de studio sombre" fill preload sizes="(max-width: 820px) 100vw, 45vw" />
          </div>
          <div className="about-teaser__copy">
            <p className="eyebrow">La démarche artistique</p>
            <h2>Faire du quotidien une œuvre musicale.</h2>
            {artistBiography.principal.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            <ButtonLink href="/discographie" variant="quiet">Écouter la discographie</ButtonLink>
          </div>
        </Container>
      </section>
      <section className="section section--soft">
        <Container className="content-columns motion-reveal">
          <p className="content-columns__label">Le fil conducteur</p>
          <div className="editorial-copy">
            <p>Une histoire d’abord. La forme musicale ensuite.</p>
            <p>LNX Beats ne cherche pas à faire entrer chaque récit dans la même couleur. Le choix du ton, de la voix et du rythme dépend de ce que l’histoire demande.</p>
            <p>Cette liberté permet aux chroniques du quotidien, aux récits familiaux, à l’humour, à l’émotion et à l’expérimentation de cohabiter sans perdre leur singularité.</p>
            <blockquote>Chaque histoire mérite sa musique.</blockquote>
          </div>
        </Container>
      </section>
    </>
  );
}
