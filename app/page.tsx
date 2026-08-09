import type { Metadata } from "next";
import Image from "next/image";
import { AlbumCard } from "@/components/album-card";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";
import { PlatformLink } from "@/components/platform-link";
import { SectionHeading } from "@/components/section-heading";
import { albums } from "@/data/discography";
import { siteConfig } from "@/data/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__media">
          <Image
            src="/assets/hero-desktop.jpg"
            alt="LNX Beats dans son studio, casquette noire et lumière tamisée"
            fill
            priority
            sizes="100vw"
          />
        </div>
        <Container className="hero__content">
          <div className="hero__copy">
            <p className="eyebrow">LNX Beats · Site officiel</p>
            <h1 className="display-title" id="hero-title">
              Chaque histoire <em>mérite sa musique.</em>
            </h1>
            <p className="hero__lead">
              Des morceaux narratifs, des émotions brutes et une création sur mesure pour donner une voix à ce qui compte.
            </p>
            <div className="hero__actions">
              <ButtonLink href={siteConfig.featuredRelease.url} external>Écouter maintenant</ButtonLink>
              <ButtonLink href="/commander" variant="secondary">Commander une musique</ButtonLink>
            </div>
          </div>
          <div className="hero__footer" aria-hidden="true">
            <span className="hero__scroll">Découvrir</span>
            <span>Musique · Récits · Émotion</span>
          </div>
        </Container>
      </section>

      <div className="platform-strip" aria-label="Plateformes d’écoute">
        <Container className="platform-strip__inner">
          {siteConfig.platforms.map((platform) => <PlatformLink key={platform.name} {...platform} />)}
        </Container>
      </div>

      <section className="section">
        <Container>
          <SectionHeading
            eyebrow="Titre à la une"
            title="Une histoire entre deux mondes."
            description="Le titre actuellement mis en lumière dans l’univers LNX Beats. Une écoute lancée à votre rythme, sans lecture automatique."
          />
          <article className="featured-release">
            <div className="featured-release__visual">
              <Image
                src="/assets/hero-mobile.jpg"
                alt="Visuel de LNX Beats pour le titre J’ai adopté un humain"
                fill
                sizes="(max-width: 820px) 100vw, 60vw"
              />
              <a
                className="play-link"
                href={siteConfig.featuredRelease.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Écouter J’ai adopté un humain sur YouTube"
              >
                <span aria-hidden="true">▶</span>
              </a>
            </div>
            <div className="featured-release__copy">
              <div>
                <p className="eyebrow">LNX Beats · À la une</p>
                <h2>{siteConfig.featuredRelease.title}</h2>
              </div>
              <div>
                <p>Découvrez le titre sur la chaîne YouTube officielle et poursuivez l’écoute sur vos plateformes préférées.</p>
                <ButtonLink href={siteConfig.featuredRelease.url} external>Ouvrir YouTube</ButtonLink>
              </div>
            </div>
          </article>
        </Container>
      </section>

      <section className="section section--paper">
        <Container className="commission-grid">
          <div>
            <p className="eyebrow">Création personnalisée</p>
            <h2>Créez votre <span>musique</span> personnalisée.</h2>
          </div>
          <div className="commission-grid__details">
            <p className="commission-grid__price">50 €</p>
            <p className="commission-grid__delivery">Délai indicatif : 7 jours. Votre histoire, transformée en morceau original par LNX Beats.</p>
            <ButtonLink href="/commander">Commencer mon projet</ButtonLink>
          </div>
        </Container>
      </section>

      <section className="section section--soft">
        <Container>
          <SectionHeading
            eyebrow="Discographie"
            title="Plusieurs univers. Une même signature."
            description="Une sélection de projets LNX Beats, entre récit, humour, observation et émotion."
          />
          <div className="release-grid">
            {albums.slice(0, 3).map((release, index) => <AlbumCard key={release.slug} release={release} index={index} />)}
          </div>
          <div className="section-cta">
            <ButtonLink href="/discographie" variant="quiet">Explorer la discographie</ButtonLink>
          </div>
        </Container>
      </section>

      <section className="section">
        <Container className="about-teaser">
          <div className="about-teaser__image">
            <Image
              src="/assets/hero-mobile.jpg"
              alt="Portrait en clair-obscur de LNX Beats"
              fill
              sizes="(max-width: 820px) 100vw, 45vw"
            />
          </div>
          <div className="about-teaser__copy">
            <p className="eyebrow">Derrière LNX Beats</p>
            <h2>Raconter autrement.</h2>
            <p>
              LNX Beats développe un projet artistique centré sur les histoires, les personnages et les émotions. Chaque morceau cherche son propre ton, sans perdre la signature qui relie l’ensemble.
            </p>
            <ButtonLink href="/a-propos" variant="quiet">Découvrir le projet</ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
