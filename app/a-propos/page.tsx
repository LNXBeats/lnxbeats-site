import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";

export const metadata: Metadata = {
  title: "À propos",
  description: "Pourquoi LNX Beats transforme les scènes ordinaires, les personnages et les émotions en récits musicaux.",
  alternates: { canonical: "/a-propos" },
};

export default function AboutPage() {
  return (
    <>
      <header className="page-hero">
        <Container className="page-hero__grid">
          <div><p className="eyebrow">À l’origine des récits</p><h1>Pourquoi raconter ?</h1></div>
          <p className="page-hero__intro">Parce qu’une scène ordinaire peut contenir un monde entier. LNX Beats part de ces instants que l’on connaît tous et écoute ce qu’ils pourraient devenir en musique.</p>
        </Container>
      </header>
      <section className="section">
        <Container className="about-teaser motion-reveal motion-reveal--soft">
          <div className="about-teaser__image">
            <Image src="/assets/hero-mobile.jpg" alt="LNX Beats dans une ambiance de studio sombre" fill sizes="(max-width: 820px) 100vw, 45vw" />
          </div>
          <div className="about-teaser__copy">
            <p className="eyebrow">Le point de départ</p>
            <h2>Tout commence par un détail.</h2>
            <p>Une manière de parler. Un silence trop long. Une habitude que personne ne remarque plus. L’écriture commence là, quand un détail ordinaire révèle un personnage et change la lumière de toute la scène.</p>
            <p>La production vient ensuite lui construire un espace. Drôle, sensible, sombre ou inattendu : la couleur change, mais le geste reste le même. Faire entendre une histoire avant même de l’expliquer.</p>
            <ButtonLink href="/discographie" variant="quiet">Entrer dans les histoires</ButtonLink>
          </div>
        </Container>
      </section>
      <section className="section section--soft">
        <Container className="content-columns motion-reveal">
          <p className="content-columns__label">Ce qui relie tout</p>
          <div className="editorial-copy">
            <p>Une voix entre dans le cadre. Quelque chose se joue. Un détail change tout.</p>
            <p>Les chroniques du quotidien peuvent côtoyer les récits familiaux, l’humour peut laisser place à l’émotion, et une expérimentation peut ouvrir une porte que personne n’attendait.</p>
            <p>Ce qui relie ces directions n’est pas un genre. C’est l’envie de regarder autrement ce que l’on croyait déjà connaître.</p>
            <blockquote>Chaque histoire mérite sa musique.</blockquote>
          </div>
        </Container>
      </section>
    </>
  );
}
