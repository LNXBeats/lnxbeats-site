
import { T } from "@/components/site-language";
import { OriginalName } from "@/components/original-name";
import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";
import { artistBiography } from "@/data/artist";
import { createPublicPageMetadata } from "@/lib/seo/metadata";
import "../v110-editorial-polish.css";
import { LocalizedEditorial } from "@/components/localized-editorial";
import { getSiteLocale, serverT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getSiteLocale();
  return createPublicPageMetadata({
  title: serverT(locale, "Ludovic Mathon — À propos"),
  description: serverT(locale, artistBiography.short),
  imageAlt: serverT(locale, "LNX Beats — Chaque histoire mérite sa musique."),
  pathname: "/a-propos",
  });
}

export default async function AboutPage() {
  const locale = await getSiteLocale();
  return (
    <>
      <header className="about-hero about-hero--editorial" data-motion-scene="about">
        <Container className="about-hero__grid">
          <div className="about-hero__copy about-hero__copy--editorial" data-motion-layer="copy">
            <p className="eyebrow"><T text="Derrière LNX Beats"/></p>
            <h1><OriginalName>Ludovic Mathon</OriginalName></h1>
            <p><LocalizedEditorial text={artistBiography.short}/></p>
          </div>
          <div className="about-hero__portrait about-hero__portrait--editorial" data-motion-layer="media">
            <Image src="/assets/v3/hero-main-ludovic-dog-exact.jpg" alt={serverT(locale, "Ludovic et son chien dans l’univers visuel LNX Beats")} fill loading="eager" sizes="(max-width: 820px) 100vw, 48vw" />
            <span aria-hidden="true"><T text="Portrait / studio"/></span>
          </div>
        </Container>
      </header>
      <section className="section about-story-scene about-story-scene--editorial">
        <Container className="about-teaser about-teaser--copy-only about-teaser--editorial motion-reveal motion-reveal--soft">
          <div className="about-teaser__copy about-editorial__copy">
            <p className="eyebrow"><T text="La démarche artistique"/></p>
            <h2><T text="Faire du quotidien une œuvre musicale."/></h2>
            <div className="about-editorial__biography">
              {artistBiography.principal.map((paragraph) => <p key={paragraph}><LocalizedEditorial text={paragraph}/></p>)}
            </div>
            <div className="about-editorial__continuation">
              <p><T text="LNX Beats ne cherche pas à faire entrer chaque récit dans la même couleur. Le choix du ton, de la voix et du rythme dépend de ce que l’histoire demande."/></p>
              <p><T text="Cette liberté permet aux chroniques du quotidien, aux récits familiaux, à l’humour, à l’émotion et à l’expérimentation de cohabiter sans perdre leur singularité."/></p>
            </div>
            <ButtonLink href="/discographie" variant="quiet"><T text="Écouter la discographie"/></ButtonLink>
          </div>
        </Container>
      </section>
      <section className="about-final-cta" aria-labelledby="about-final-cta-title">
        <Container className="about-final-cta__inner motion-reveal">
          <div><p className="eyebrow"><T text="La suite s’écoute"/></p><h2 id="about-final-cta-title"><T text="Entrez dans les histoires LNX Beats."/></h2></div>
          <ButtonLink href="/discographie" variant="secondary"><T text="Découvrir la discographie"/></ButtonLink>
        </Container>
      </section>
    </>
  );
}
