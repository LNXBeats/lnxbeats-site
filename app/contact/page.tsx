import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";
import { PlatformLink } from "@/components/platform-link";
import { siteConfig } from "@/data/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Échanger directement avec LNX Beats autour d’une idée, d’une collaboration ou d’un projet musical.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <>
      <header className="contact-hero">
        <Image src="/assets/hero-desktop.jpg" alt="" fill loading="eager" sizes="100vw" />
        <Container className="contact-hero__inner">
          <div>
            <p className="eyebrow">Entrer en conversation</p>
            <h1>Une idée mérite parfois d’être entendue avant d’être écrite.</h1>
            <p>Collaboration musicale, demande professionnelle, adaptation, droits ou autre échange : écrivez directement à LNX Beats. Pour confier une histoire destinée à une création personnalisée, le parcours Commander reste le meilleur point de départ.</p>
          </div>
        </Container>
      </header>
      <section className="section">
        <Container>
          <div className="contact-intents motion-reveal motion-reveal--soft" aria-label="Motifs de contact">
            <span>Création personnalisée</span>
            <span>Collaboration</span>
            <span>Adaptation & droits</span>
            <span>Demande professionnelle</span>
            <span>Autre échange</span>
          </div>
          <div className="contact-panel motion-reveal">
            <div>
              <p className="eyebrow">De vous à LNX Beats</p>
              <h2>La conversation commence sans intermédiaire.</h2>
              <p>Donnez le contexte, l’intention et les repères utiles. Votre message arrive directement à LNX Beats, sans passer par un support anonyme.</p>
              <a className="contact-email" href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
            </div>
            <ButtonLink href={`mailto:${siteConfig.email}`} external>Écrire à LNX Beats</ButtonLink>
          </div>
        </Container>
      </section>
      <section className="section section--soft">
        <Container>
          <div className="content-columns motion-reveal">
            <p className="content-columns__label">Le dialogue continue</p>
            <div>
              {siteConfig.social.map((item) => <PlatformLink key={item.name} {...item} compact />)}
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
