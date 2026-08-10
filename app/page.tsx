import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";
import { ProjectArtwork } from "@/components/project-artwork";
import { artistBiography } from "@/data/artist";
import { featuredProjects } from "@/data/discography";
import { officialLinks, siteConfig } from "@/data/site";

const homeDescription = "LNX Beats transforme les scènes ordinaires, les souvenirs et les émotions en récits musicaux. Chaque histoire mérite sa musique.";

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
  { title: "Rap narratif", description: "Une voix entre dans le cadre. Le décor suit. L’histoire peut commencer." },
  { title: "Humour", description: "Le quotidien se décale juste assez pour révéler ce qu’il avait de drôle." },
  { title: "Émotion", description: "Des mots pour faire entendre ce que les souvenirs gardent en silence." },
  { title: "Cinéma", description: "Des morceaux pensés en lumière, en mouvement et en scènes intérieures." },
  { title: "Sur mesure", description: "Votre histoire, ses détails, puis une musique qui n’appartient qu’à elle." },
  { title: "Expérimentation", description: "L’endroit où les voix et les formes prennent des chemins inattendus." },
] as const;

const platforms = [
  { name: "Spotify", label: "Écouter les récits", mark: "S", url: officialLinks.spotify, tone: "spotify" },
  { name: "Apple Music", label: "Écouter les récits", mark: "A", url: officialLinks.appleMusic, tone: "apple" },
  { name: "Deezer", label: "Écouter les récits", mark: "D", url: officialLinks.deezer, tone: "deezer" },
  { name: "YouTube", label: "Regarder les histoires", mark: "Y", url: officialLinks.youtube, tone: "youtube" },
  { name: "TikTok", label: "Suivre les coulisses", mark: "T", url: officialLinks.tiktok, tone: "tiktok" },
  { name: "Instagram", label: "Suivre les coulisses", mark: "I", url: officialLinks.instagram, tone: "instagram" },
] as const;

const commissionSteps = [
  { number: "01", title: "Vous confiez", description: "Un prénom, un souvenir, une phrase que vous êtes seul à comprendre." },
  { number: "02", title: "Le récit prend forme", description: "LNX Beats cherche la voix, le rythme et la lumière justes." },
  { number: "03", title: "La musique vous revient", description: "Votre histoire a changé de forme, mais elle porte toujours votre émotion." },
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
            <p className="eyebrow">LNX Beats · Les histoires deviennent musique</p>
            <h1 id="home-hero-title">LNX <span>BEATS</span></h1>
            <p className="home-hero__slogan">Chaque histoire mérite sa musique.</p>
            <p className="home-hero__lead">Il suffit parfois d’un prénom, d’un souvenir ou d’une scène banale. LNX Beats écoute ce qui s’y cache et lui donne une voix, un rythme, un monde.</p>
            <div className="home-hero__actions">
              <ButtonLink href="/discographie">Écouter la discographie</ButtonLink>
              <ButtonLink href="/commander" variant="secondary">Préparer votre histoire</ButtonLink>
            </div>
          </div>
          <div className="home-hero__signature" aria-hidden="true">
            <span>Rap narratif</span>
            <span>Humour</span>
            <span>Émotion</span>
          </div>
          <a className="home-hero__scroll" href="#univers">
            <span>Comprendre la démarche</span>
            <span aria-hidden="true">↓</span>
          </a>
        </Container>
      </section>

      <section className="home-intro" aria-labelledby="home-intro-title">
        <Container className="home-intro__grid motion-reveal">
          <p className="section-index">01 — La démarche</p>
          <div>
            <h2 id="home-intro-title">Le réel devient une scène.<br /><em>La musique, un récit.</em></h2>
            <p>Une famille trop bruyante. Un collègue impossible. Un animal qui regarde les humains vivre. Un souvenir que l’on refuse de laisser partir. La musique commence souvent là.</p>
            <div className="home-intro__artist">
              <p>{artistBiography.short}</p>
              <Link className="text-link" href="/a-propos">Lire la démarche de Ludovic Mathon <span aria-hidden="true">→</span></Link>
            </div>
          </div>
        </Container>
      </section>

      <section className="section universe-section" id="univers" aria-labelledby="universe-title">
        <Container>
          <div className="premium-heading motion-reveal">
            <div>
              <p className="section-index">02 — Les territoires</p>
              <h2 id="universe-title">Un artiste.<br />Plusieurs univers.</h2>
            </div>
            <p>Chaque histoire réclame sa propre lumière. Certaines font sourire, d’autres serrent la gorge. Aucune ne demande à être racontée de la même manière.</p>
          </div>
          <div className="universe-grid motion-reveal motion-reveal--soft">
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
            <div className="premium-heading premium-heading--projects motion-reveal">
              <div>
                <p className="section-index">03 — La musique</p>
                <h2 id="projects-title">Des mondes à écouter.</h2>
              </div>
              <ButtonLink href="/discographie" variant="quiet">Voir toute la discographie</ButtonLink>
            </div>

            <article className="home-project-lead motion-reveal motion-reveal--soft">
              <Link className="home-project-lead__art" href={`/album/${leadProject.slug}`} aria-label={`Ouvrir l’univers ${leadProject.title}`}>
                <ProjectArtwork project={leadProject} priority sizes="(max-width: 820px) 100vw, 58vw" />
              </Link>
              <div className="home-project-lead__copy">
                <p className="eyebrow">Projet majeur · Single</p>
                <h3>{leadProject.title}</h3>
                <p>{leadProject.description}</p>
                <ButtonLink href={`/album/${leadProject.slug}`} variant="quiet">Voir la fiche du projet</ButtonLink>
              </div>
            </article>

            <div className="home-project-supporting motion-reveal motion-reveal--soft">
              {supportingProjects.map((project, index) => (
                <article className="home-project-secondary" key={project.slug}>
                  <Link href={`/album/${project.slug}`} aria-label={`Ouvrir l’univers ${project.title}`}>
                    <ProjectArtwork project={project} sizes="(max-width: 600px) 100vw, 40vw" />
                  </Link>
                  <div className="home-project-secondary__copy">
                    <p className="section-index">{String(index + 1).padStart(2, "0")} — Sélection</p>
                    <h3><Link href={`/album/${project.slug}`}>{project.title}</Link></h3>
                    <p>{project.shortDescription}</p>
                    <Link className="text-link" href={`/album/${project.slug}`}>Voir la fiche <span aria-hidden="true">→</span></Link>
                  </div>
                </article>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      <section className="section commission-story" id="sur-mesure" aria-labelledby="commission-title">
        <Container>
          <div className="commission-story__intro motion-reveal">
            <p className="section-index">04 — Votre histoire</p>
            <h2 id="commission-title">Votre histoire<br /><em>attend sa voix.</em></h2>
            <p>Vous apportez les personnes, les silences et les détails. La création commence par cette rencontre.</p>
          </div>
          <ol className="commission-steps motion-reveal motion-reveal--soft">
            {commissionSteps.map((step) => (
              <li key={step.number}>
                <span>{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
          <div className="commission-story__action motion-reveal motion-reveal--soft">
            <p>Quelques mots suffisent pour ouvrir la première scène.</p>
            <ButtonLink href="/commander">Préparer votre récit</ButtonLink>
          </div>
        </Container>
      </section>

      <section className="section platforms-stage" id="plateformes" aria-labelledby="platforms-title">
        <Container>
          <div className="premium-heading motion-reveal">
            <div>
              <p className="section-index">05 — Écouter & suivre</p>
              <h2 id="platforms-title">Les histoires continuent ailleurs.</h2>
            </div>
            <p>Chaque plateforme ouvre une autre porte sur les morceaux, les personnages et ce qui se prépare encore.</p>
          </div>
          <div className="platforms-grid motion-reveal motion-reveal--soft">
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

      <section className="section section--soft" aria-labelledby="member-space-title">
        <Container className="content-columns home-member motion-reveal">
          <p className="content-columns__label">06 — Espace membre</p>
          <div className="home-member__copy">
            <h2 id="member-space-title">Garder la main sur votre accès.</h2>
            <p>Aujourd’hui, le compte protège votre profil et votre mot de passe. Il ne contient encore ni commande, ni paiement, ni fichier à télécharger.</p>
            <p>Les brouillons et le suivi des demandes y sont désormais réunis. Les livraisons, favoris et alertes choisies apparaîtront seulement lorsque ces services seront réellement activés.</p>
            <div className="home-member__actions">
              <ButtonLink href="/inscription">Créer un espace membre</ButtonLink>
              <ButtonLink href="/connexion" variant="quiet">Se connecter</ButtonLink>
            </div>
          </div>
        </Container>
      </section>

      <section className="home-contact" id="contact-home" aria-labelledby="home-contact-title">
        <Container className="home-contact__inner motion-reveal">
          <p className="section-index">07 — Contact</p>
          <div>
            <h2 id="home-contact-title">Et si la prochaine histoire était la vôtre ?</h2>
            <p>Une idée, une proposition ou simplement quelques mots à partager : de l’autre côté, c’est LNX Beats qui répond.</p>
            <div className="home-contact__actions">
              <ButtonLink href="/contact">Écrire à LNX Beats</ButtonLink>
              <ButtonLink href={`mailto:${siteConfig.email}`} variant="quiet" external>{siteConfig.email}</ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
