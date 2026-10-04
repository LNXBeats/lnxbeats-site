import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";
import { PlatformLink } from "@/components/platform-link";
import { quickAccessPlatforms, siteConfig } from "@/data/site";
import { createPublicPageMetadata } from "@/lib/seo/metadata";
import styles from "./contact.module.css";

export const metadata: Metadata = createPublicPageMetadata({
  title: "Contact",
  description: "Échanger directement avec LNX Beats autour d’une idée, d’une collaboration ou d’un projet musical.",
  pathname: "/contact",
});

const contactPlatforms = [
  ...quickAccessPlatforms.filter(({ name }) => name === "YouTube"),
  ...quickAccessPlatforms.filter(({ name }) => name !== "YouTube"),
];

export default function ContactPage() {
  return (
    <>
      <header className={styles.hero}>
        <Container className={styles.heroGrid}>
          <div>
            <p className="eyebrow">Entrer en conversation</p>
            <h1>Une idée mérite parfois d’être entendue avant d’être écrite.</h1>
            <p>Collaboration musicale, demande professionnelle, adaptation, droits ou autre échange : écrivez directement à LNX Beats. Pour confier une histoire destinée à une création personnalisée, le parcours Commander reste le meilleur point de départ.</p>
          </div>
          <Image className={styles.portrait} src="/assets/v3/hero-main-ludovic-dog-exact.jpg" alt="Ludovic et son chien" width={1254} height={1254} loading="eager" sizes="(max-width: 760px) calc(100vw - 36px), 40vw" />
        </Container>
      </header>
      <section className="section contact-section--v3">
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
            </div>
            <ButtonLink href={`mailto:${siteConfig.email}`} external>Écrire à LNX Beats</ButtonLink>
          </div>
        </Container>
      </section>
      <section id="plateformes" className={styles.platformSection}>
        <Container>
          <div className={styles.platforms}>
            <div className={styles.intro}>
              <p className={styles.eyebrow}>Le dialogue continue</p>
              <h2>Écouter et suivre LNX Beats.</h2>
              <p>La musique, les clips et les coulisses, sur vos plateformes.</p>
            </div>
            <ul className={styles.list} aria-label="Plateformes officielles de LNX Beats">
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
