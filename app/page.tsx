import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AlbumCard } from "@/components/album-card";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";
import { PlatformLink } from "@/components/platform-link";
import { ProjectArtwork } from "@/components/project-artwork";
import { SectionHeading } from "@/components/section-heading";
import { featuredProjects, projectsInDevelopment } from "@/data/discography";
import { siteConfig } from "@/data/site";

export const metadata: Metadata = {
  title: "LNX Beats — Chaque histoire mérite sa musique",
  description: "Site officiel de LNX Beats : musique narrative, discographie, projets artistiques et création musicale personnalisée.",
  alternates: { canonical: "/" },
};

const leadProject = featuredProjects[0];
const secondaryProjects = featuredProjects.slice(1, 4);

export default function HomePage() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__media">
          <Image
            src="/assets/hero-desktop.jpg"
            alt="LNX Beats dans son studio, casquette noire et lumière tamisée"
            fill
            preload
            sizes="100vw"
          />
        </div>
        <Container className="hero__content">
          <div className="hero__copy">
            <p className="hero__identity">LNX BEATS</p>
            <p className="eyebrow">Artiste · Auteur d’univers</p>
            <h1 className="display-title" id="hero-title">
              Chaque histoire <em>mérite sa musique.</em>
            </h1>
            <p className="hero__lead">
              Des récits en chansons, des personnages et des émotions brutes. LNX Beats transforme les scènes du quotidien en univers musicaux singuliers.
            </p>
            <div className="hero__actions">
              <ButtonLink href="/discographie">Explorer la discographie</ButtonLink>
              <ButtonLink href="/commander" variant="secondary">Commander une musique</ButtonLink>
            </div>
          </div>
          <div className="hero__footer" aria-hidden="true">
            <span className="hero__scroll">Découvrir</span>
            <span>Récits · Personnages · Émotion</span>
          </div>
        </Container>
      </section>

      <div className="platform-strip" aria-label="Plateformes d’écoute">
        <Container className="platform-strip__inner">
          {siteConfig.platforms.map((platform) => <PlatformLink key={platform.name} {...platform} />)}
        </Container>
      </div>

      <section className="section manifesto-section">
        <Container className="manifesto-grid">
          <div>
            <p className="eyebrow">L’univers LNX</p>
            <h2>Le réel comme matière. La musique comme récit.</h2>
          </div>
          <div className="manifesto-copy">
            <p>Une famille trop bruyante, un collègue impossible, un animal qui observe les humains : chaque détail peut devenir un décor, une voix et une histoire.</p>
            <p>LNX Beats développe un catalogue où l’humour, l’émotion et l’expérimentation se répondent sans enfermer le projet dans un seul genre.</p>
          </div>
        </Container>
      </section>

      {leadProject ? (
        <section className="section section--soft" aria-labelledby="featured-title">
          <Container>
            <SectionHeading
              eyebrow="Projets à la une"
              title="Des univers à parcourir, pas seulement des titres à écouter."
              description="Une sélection éditoriale du catalogue officiel, présentée avec les seules informations actuellement confirmées."
            />
            <article className="featured-project">
              <Link className="featured-project__art" href={`/album/${leadProject.slug}`} aria-label={`Découvrir ${leadProject.title}`}>
                <ProjectArtwork project={leadProject} priority sizes="(max-width: 820px) 100vw, 55vw" />
              </Link>
              <div className="featured-project__copy">
                <p className="eyebrow">Single · À la une</p>
                <h2 id="featured-title">{leadProject.title}</h2>
                <p>{leadProject.description}</p>
                <ButtonLink href={`/album/${leadProject.slug}`} variant="quiet">Entrer dans le projet</ButtonLink>
              </div>
            </article>
            <div className="release-grid release-grid--editorial">
              {secondaryProjects.map((project) => <AlbumCard key={project.slug} project={project} />)}
            </div>
            <div className="section-cta">
              <ButtonLink href="/discographie" variant="quiet">Voir tout le catalogue</ButtonLink>
            </div>
          </Container>
        </section>
      ) : null}

      <section className="section section--paper">
        <Container className="commission-grid">
          <div>
            <p className="eyebrow">Création personnalisée</p>
            <h2>Votre histoire peut devenir <span>une musique.</span></h2>
          </div>
          <div className="commission-grid__details">
            <p className="commission-grid__price">50 €</p>
            <p className="commission-grid__delivery">Délai indicatif : 7 jours. Un morceau original imaginé par LNX Beats à partir de votre récit.</p>
            <ButtonLink href="/commander">Présenter mon histoire</ButtonLink>
          </div>
        </Container>
      </section>

      <section className="section future-section" aria-labelledby="future-title">
        <Container>
          <div className="catalog-header catalog-header--large">
            <div>
              <p className="eyebrow">En développement</p>
              <h2 id="future-title">La suite se construit déjà.</h2>
            </div>
            <p>Des noms de projets, sans fausse date ni promesse prématurée.</p>
          </div>
          <div className="future-projects">
            {projectsInDevelopment.slice(0, 5).map((project, index) => (
              <Link href={`/album/${project.slug}`} className="future-project-row" key={project.slug}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{project.title}</strong>
                <span>En développement</span>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </Container>
      </section>

      <section className="section section--soft">
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
            <p>Un projet artistique pensé comme un ensemble de mondes : certains drôles, d’autres plus sensibles, toujours construits autour d’un point de vue et d’une histoire.</p>
            <ButtonLink href="/a-propos" variant="quiet">Découvrir la démarche</ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
