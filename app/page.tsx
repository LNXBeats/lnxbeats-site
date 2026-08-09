import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";
import { ProjectArtwork } from "@/components/project-artwork";
import { featuredProjects } from "@/data/discography";
import { officialLinks, siteConfig } from "@/data/site";

const homeDescription = "Découvrez LNX Beats, ses récits musicaux, ses projets et ses créations sur mesure. Une musique construite autour des histoires, de l’humour et de l’émotion.";

export const metadata: Metadata = {
  title: "LNX Beats — Chaque histoire mérite sa musique",
  description: homeDescription,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: "LNX Beats — Chaque histoire mérite sa musique",
    description: homeDescription,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "LNX Beats — Chaque histoire mérite sa musique." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "LNX Beats — Chaque histoire mérite sa musique",
    description: homeDescription,
    images: ["/og.png"],
  },
};

const universes = [
  { title: "Rap narratif", description: "Des textes qui installent une scène, un point de vue et des personnages." },
  { title: "Humour", description: "Le quotidien observé de biais, entre détails familiers et situations inattendues." },
  { title: "Émotion", description: "Des récits plus sensibles, écrits pour laisser résonner ce qui ne se dit pas toujours." },
  { title: "Cinéma", description: "Une manière de penser la musique par images, ambiances et mouvements narratifs." },
  { title: "Sur mesure", description: "Une histoire personnelle transformée en création musicale originale." },
  { title: "Expérimentation", description: "Un espace libre où les formes, les voix et les idées peuvent se déplacer." },
] as const;

const platforms = [
  { name: "Spotify", label: "Catalogue artiste", mark: "S", url: officialLinks.spotify, tone: "spotify" },
  { name: "Apple Music", label: "Catalogue artiste", mark: "A", url: officialLinks.appleMusic, tone: "apple" },
  { name: "Deezer", label: "Catalogue artiste", mark: "D", url: officialLinks.deezer, tone: "deezer" },
  { name: "YouTube", label: "Chaîne officielle", mark: "Y", url: officialLinks.youtube, tone: "youtube" },
  { name: "TikTok", label: "Profil officiel", mark: "T", url: officialLinks.tiktok, tone: "tiktok" },
  { name: "Instagram", label: "Profil officiel", mark: "I", url: officialLinks.instagram, tone: "instagram" },
] as const;

const commissionSteps = [
  { number: "01", title: "Tu racontes", description: "Tu poses les personnes, les souvenirs et les détails qui rendent ton histoire unique." },
  { number: "02", title: "LNX Beats compose", description: "Le récit devient un texte, une intention et un univers musical original." },
  { number: "03", title: "Tu reçois ton œuvre", description: "Une création singulière, pensée autour de ton histoire et de ses émotions." },
] as const;

const leadProject = featuredProjects[0];
const supportingProjects = featuredProjects.slice(1, 3);

export default function HomePage() {
  return (
    <>
      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero__media" aria-hidden="true">
          <Image
            src="/assets/hero-desktop.jpg"
            alt=""
            fill
            preload
            sizes="100vw"
          />
        </div>
        <Container className="home-hero__inner">
          <div className="home-hero__copy">
            <p className="eyebrow">Artiste · Auteur de récits musicaux</p>
            <h1 id="home-hero-title">LNX <span>BEATS</span></h1>
            <p className="home-hero__slogan">Chaque histoire mérite sa musique.</p>
            <p className="home-hero__lead">Des scènes du quotidien aux récits les plus personnels, LNX Beats transforme des histoires en chansons, en personnages et en univers singuliers.</p>
            <div className="home-hero__actions">
              <ButtonLink href="/discographie">Écouter la musique</ButtonLink>
              <ButtonLink href="/commander" variant="secondary">Commander sur mesure</ButtonLink>
            </div>
          </div>
          <div className="home-hero__signature" aria-hidden="true">
            <span>Rap narratif</span>
            <span>Humour</span>
            <span>Émotion</span>
          </div>
          <a className="home-hero__scroll" href="#univers">
            <span>Découvrir l’univers</span>
            <span aria-hidden="true">↓</span>
          </a>
        </Container>
      </section>

      <section className="home-intro" aria-labelledby="home-intro-title">
        <Container className="home-intro__grid">
          <p className="section-index">01 — La démarche</p>
          <div>
            <h2 id="home-intro-title">Le réel devient une scène.<br /><em>La musique, un récit.</em></h2>
            <p>Une famille trop bruyante, un collègue impossible, un animal qui observe les humains ou un souvenir que l’on veut garder : tout peut devenir le point de départ d’une chanson.</p>
          </div>
        </Container>
      </section>

      <section className="section universe-section" id="univers" aria-labelledby="universe-title">
        <Container>
          <div className="premium-heading">
            <div>
              <p className="section-index">02 — Les territoires</p>
              <h2 id="universe-title">Un artiste.<br />Plusieurs univers.</h2>
            </div>
            <p>LNX Beats ne s’enferme pas dans un seul ton. Chaque histoire appelle sa propre couleur, son propre rythme et sa propre façon d’être racontée.</p>
          </div>
          <div className="universe-grid">
            {universes.map((universe, index) => (
              <article className="universe-card" key={universe.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{universe.title}</h3>
                  <p>{universe.description}</p>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>

      {leadProject ? (
        <section className="section home-projects" id="projets" aria-labelledby="projects-title">
          <Container>
            <div className="premium-heading premium-heading--projects">
              <div>
                <p className="section-index">03 — La musique</p>
                <h2 id="projects-title">Des mondes à écouter.</h2>
              </div>
              <ButtonLink href="/discographie" variant="quiet">Voir toute la discographie</ButtonLink>
            </div>

            <article className="home-project-lead">
              <Link className="home-project-lead__art" href={`/album/${leadProject.slug}`} aria-label={`Découvrir ${leadProject.title}`}>
                <ProjectArtwork project={leadProject} priority sizes="(max-width: 820px) 100vw, 58vw" />
              </Link>
              <div className="home-project-lead__copy">
                <p className="eyebrow">Projet majeur · Single</p>
                <h3>{leadProject.title}</h3>
                <p>{leadProject.description}</p>
                <ButtonLink href={`/album/${leadProject.slug}`} variant="quiet">Entrer dans le récit</ButtonLink>
              </div>
            </article>

            <div className="home-project-supporting">
              {supportingProjects.map((project, index) => (
                <article className="home-project-secondary" key={project.slug}>
                  <Link href={`/album/${project.slug}`} aria-label={`Découvrir ${project.title}`}>
                    <ProjectArtwork project={project} sizes="(max-width: 600px) 100vw, 40vw" />
                  </Link>
                  <div className="home-project-secondary__copy">
                    <p className="section-index">{String(index + 1).padStart(2, "0")} — Sélection</p>
                    <h3><Link href={`/album/${project.slug}`}>{project.title}</Link></h3>
                    <p>{project.shortDescription}</p>
                    <Link className="text-link" href={`/album/${project.slug}`}>Découvrir <span aria-hidden="true">→</span></Link>
                  </div>
                </article>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      <section className="section commission-story" id="sur-mesure" aria-labelledby="commission-title">
        <Container>
          <div className="commission-story__intro">
            <p className="section-index">04 — Votre histoire</p>
            <h2 id="commission-title">Une musique<br /><em>rien que pour vous.</em></h2>
            <p>Un cadeau, un souvenir ou un message à transmettre : votre récit devient le point de départ d’une œuvre originale.</p>
          </div>
          <ol className="commission-steps">
            {commissionSteps.map((step) => (
              <li key={step.number}>
                <span>{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
          <div className="commission-story__action">
            <p>Vous avez une histoire en tête ?</p>
            <ButtonLink href="/commander">Commencer votre création</ButtonLink>
          </div>
        </Container>
      </section>

      <section className="section platforms-stage" id="plateformes" aria-labelledby="platforms-title">
        <Container>
          <div className="premium-heading">
            <div>
              <p className="section-index">05 — Écouter & suivre</p>
              <h2 id="platforms-title">Retrouvez LNX Beats.</h2>
            </div>
            <p>Écoutez le catalogue et suivez les nouvelles histoires depuis les profils officiels.</p>
          </div>
          <div className="platforms-grid">
            {platforms.map((platform) => (
              <a
                className="platform-card"
                data-platform={platform.tone}
                href={platform.url}
                target="_blank"
                rel="noopener noreferrer"
                key={platform.name}
              >
                <span className="platform-card__mark" aria-hidden="true">{platform.mark}</span>
                <span className="platform-card__copy">
                  <strong>{platform.name}</strong>
                  <small>{platform.label}</small>
                </span>
                <span className="platform-card__arrow" aria-hidden="true">↗</span>
                <span className="visually-hidden"> — nouvel onglet</span>
              </a>
            ))}
          </div>
        </Container>
      </section>

      <section className="home-contact" id="contact-home" aria-labelledby="home-contact-title">
        <Container className="home-contact__inner">
          <p className="section-index">06 — Contact</p>
          <div>
            <h2 id="home-contact-title">Une histoire à raconter ?</h2>
            <p>Pour une création sur mesure, une proposition professionnelle ou simplement pour entrer dans l’univers LNX Beats.</p>
            <div className="home-contact__actions">
              <ButtonLink href="/contact">Prendre contact</ButtonLink>
              <ButtonLink href={`mailto:${siteConfig.email}`} variant="quiet" external>{siteConfig.email}</ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
