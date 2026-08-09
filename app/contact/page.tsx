import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";
import { PlatformLink } from "@/components/platform-link";
import { siteConfig } from "@/data/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contacter LNX Beats pour une collaboration, une demande professionnelle ou un projet musical.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <>
      <header className="page-hero">
        <Container className="page-hero__grid">
          <div><p className="eyebrow">Contact professionnel</p><h1>Parlons de votre projet.</h1></div>
          <p className="page-hero__intro">Collaboration musicale, média, licence ou demande professionnelle : écrivez directement à LNX Beats. Pour une musique personnalisée, utilisez le parcours dédié.</p>
        </Container>
      </header>
      <section className="section">
        <Container>
          <div className="contact-panel">
            <div>
              <p className="eyebrow">E-mail direct</p>
              <h2>Une idée en tête ?</h2>
              <p>Précisez l’objet de votre demande et les éléments utiles. Une réponse pourra ensuite être apportée directement par e-mail.</p>
              <a className="contact-email" href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
            </div>
            <ButtonLink href={`mailto:${siteConfig.email}`} external>Écrire un e-mail</ButtonLink>
          </div>
        </Container>
      </section>
      <section className="section section--soft">
        <Container>
          <div className="content-columns">
            <p className="content-columns__label">Réseaux officiels</p>
            <div>
              {siteConfig.social.map((item) => <PlatformLink key={item.name} {...item} compact />)}
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
