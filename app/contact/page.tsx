import type { Metadata } from "next";
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
      <header className="page-hero">
        <Container className="page-hero__grid">
          <div><p className="eyebrow">Une porte ouverte</p><h1>Parlons avant de parler projet.</h1></div>
          <p className="page-hero__intro">Une collaboration, une question, une intuition encore difficile à nommer : quelques lignes suffisent pour commencer. C’est LNX Beats qui vous lit.</p>
        </Container>
      </header>
      <section className="section">
        <Container>
          <div className="contact-intents" aria-label="Motifs de contact">
            <span>Collaboration musicale</span>
            <span>Média & interview</span>
            <span>Licence & synchronisation</span>
            <span>Demande professionnelle</span>
          </div>
          <div className="contact-panel">
            <div>
              <p className="eyebrow">De vous à LNX Beats</p>
              <h2>Quelques lignes suffisent.</h2>
              <p>Racontez d’où vient votre idée, ce que vous imaginez et les éventuels repères de temps. L’échange commence directement par e-mail, sans passer par un support anonyme.</p>
              <a className="contact-email" href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
            </div>
            <ButtonLink href={`mailto:${siteConfig.email}`} external>Envoyer les premiers mots</ButtonLink>
          </div>
        </Container>
      </section>
      <section className="section section--soft">
        <Container>
          <div className="content-columns">
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
