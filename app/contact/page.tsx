
import { T } from "@/components/site-language";
import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";
import { PlatformLink } from "@/components/platform-link";
import { quickAccessPlatforms, siteConfig } from "@/data/site";
import { createPublicPageMetadata } from "@/lib/seo/metadata";
import styles from "./contact.module.css";
import { getSiteLocale, serverT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getSiteLocale();
  return createPublicPageMetadata({
  title: serverT(locale, "Contact"),
  description: serverT(locale, "Échanger directement avec LNX Beats autour d’une idée, d’une collaboration ou d’un projet musical."),
  imageAlt: serverT(locale, "LNX Beats — Chaque histoire mérite sa musique."),
  pathname: "/contact",
  });
}

const contactPlatforms = [
  ...quickAccessPlatforms.filter(({ name }) => name === "YouTube"),
  ...quickAccessPlatforms.filter(({ name }) => name !== "YouTube"),
];

export default async function ContactPage() {
  const locale = await getSiteLocale();
  return (
    <>
      <header className={styles.hero}>
        <Container className={styles.heroGrid}>
          <div>
            <p className="eyebrow"><T text="Entrer en conversation"/></p>
            <h1><T text="Une idée mérite parfois d’être entendue avant d’être écrite."/></h1>
            <p><T text="Collaboration musicale, demande professionnelle, adaptation, droits ou autre échange : écrivez directement à LNX Beats. Pour confier une histoire destinée à une création personnalisée, le parcours Commander reste le meilleur point de départ."/></p>
          </div>
          <Image className={styles.portrait} src="/assets/v3/hero-main-ludovic-dog-exact.jpg" alt={serverT(locale, "Ludovic et son chien")} width={1254} height={1254} loading="eager" sizes="(max-width: 760px) calc(100vw - 36px), 40vw" />
        </Container>
      </header>
      <section className="section contact-section--v3">
        <Container>
          <div className="contact-intents motion-reveal motion-reveal--soft" aria-label={serverT(locale, "Motifs de contact")}>
            <span><T text="Création personnalisée"/></span>
            <span><T text="Collaboration"/></span>
            <span><T text="Adaptation & droits"/></span>
            <span><T text="Demande professionnelle"/></span>
            <span><T text="Autre échange"/></span>
          </div>
          <div className="contact-panel motion-reveal">
            <div>
              <p className="eyebrow"><T text="De vous à LNX Beats"/></p>
              <h2><T text="La conversation commence sans intermédiaire."/></h2>
              <p><T text="Donnez le contexte, l’intention et les repères utiles. Votre message arrive directement à LNX Beats, sans passer par un support anonyme."/></p>
            </div>
            <ButtonLink href={`mailto:${siteConfig.email}`} external><T text="Écrire à LNX Beats"/></ButtonLink>
          </div>
        </Container>
      </section>
      <section id="plateformes" className={styles.platformSection}>
        <Container>
          <div className={styles.platforms}>
            <div className={styles.intro}>
              <p className={styles.eyebrow}><T text="Le dialogue continue"/></p>
              <h2><T text="Écouter et suivre LNX Beats."/></h2>
              <p><T text="La musique, les clips et les coulisses, sur vos plateformes."/></p>
            </div>
            <ul className={styles.list} aria-label={serverT(locale, "Plateformes officielles de LNX Beats")}>
              {contactPlatforms.map(({ icon, name, tone, url }) => {
                const isFeatured = name === "YouTube";

                return (
                  <li key={name} data-contact-platform={tone} data-contact-featured={isFeatured ? "true" : undefined}>
                    <PlatformLink icon={icon} name={name} url={url} featured={isFeatured} />
                  </li>
                );
              })}
            </ul>
          </div>
        </Container>
      </section>
    </>
  );
}
