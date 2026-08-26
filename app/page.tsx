import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { AudioPreviewPlayer } from "@/components/audio-preview-player";
import { Container } from "@/components/container";
import { ProjectArtwork } from "@/components/project-artwork";
import { getHomepageProjects } from "@/lib/catalog/queries";

const homeDescription = "LNX Beats transforme les scènes ordinaires, les souvenirs et les émotions en récits musicaux. Chaque histoire mérite sa musique.";

export const metadata: Metadata = {
  title: "LNX Beats — Chaque histoire mérite sa musique",
  description: homeDescription,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", title: "LNX Beats — Chaque histoire mérite sa musique", description: homeDescription, images: [{ url: "/og.png", width: 1200, height: 630, alt: "LNX Beats — Chaque histoire mérite sa musique." }] },
  twitter: { card: "summary_large_image", title: "LNX Beats — Chaque histoire mérite sa musique", description: homeDescription, images: ["/og.png"] },
};

const perspectives = [
  { number: "01", title: "Histoires", description: "Des personnages, du vécu, des scènes qui restent." },
  { number: "02", title: "Univers", description: "Rap, humour, émotion, expérimentation : chaque récit trouve sa lumière." },
  { number: "03", title: "Sur mesure", description: "Votre histoire devient une création LNX Beats, pensée dans ses détails." },
] as const;

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { lead: leadProject } = await getHomepageProjects();

  return <>
    <section className="home-hero" aria-labelledby="home-hero-title">
      <div className="home-hero__media" aria-hidden="true"><Image src="/assets/hero-desktop.jpg" alt="" fill priority sizes="100vw" /></div>
      <Container className="home-hero__inner">
        <div className="home-hero__copy">
          <p className="eyebrow home-hero__eyebrow">
            <span className="home-hero__eyebrow-brand">LNX Beats</span>
            <span className="home-hero__eyebrow-separator" aria-hidden="true">·</span>
            <span className="home-hero__eyebrow-story"><span className="home-hero__eyebrow-story-key">Les histoires</span> deviennent musique</span>
          </p>
          <h1 id="home-hero-title">LNX <span>BEATS</span></h1>
          <p className="home-hero__slogan">Chaque histoire mérite sa musique.</p>
          <p className="home-hero__lead">Un prénom, un souvenir ou une scène banale : LNX Beats écoute ce qui s’y cache et lui donne une voix, un rythme, un monde.</p>
          <div className="home-hero__actions"><ButtonLink href="/discographie">Découvrir la musique</ButtonLink><ButtonLink href="/commander" variant="secondary">Commander une création</ButtonLink></div>
        </div>
        <div className="home-hero__signature" aria-hidden="true"><span>Rap narratif</span><span>Humour</span><span>Émotion</span></div>
      </Container>
    </section>

    {leadProject ? <section className="section home-featured" aria-labelledby="featured-title">
      <Container>
        <div className="home-featured__heading motion-reveal"><div><p className="section-index">À la une</p><h2 id="featured-title">Une histoire à écouter.</h2></div><ButtonLink href="/discographie" variant="quiet">Toute la discographie</ButtonLink></div>
        <article className="home-project-lead motion-reveal motion-reveal--soft">
          <Link className="home-project-lead__art" href={`/album/${leadProject.slug}`} aria-label={`Ouvrir l’univers ${leadProject.title}`}><ProjectArtwork project={leadProject} priority sizes="(max-width: 820px) calc(100vw - 48px), 48vw" /></Link>
          <div className="home-project-lead__copy"><p className="eyebrow">Projet à la une · {leadProject.type === "album" ? "Album" : "Single"}</p><h3>{leadProject.title}</h3><p>{leadProject.description}</p>{leadProject.audioPreview ? <AudioPreviewPlayer src={leadProject.audioPreview.url} title={leadProject.title} durationMs={leadProject.audioPreview.durationMs} compact /> : null}<ButtonLink href={`/album/${leadProject.slug}`} variant="quiet">Entrer dans le projet</ButtonLink></div>
        </article>
      </Container>
    </section> : null}

    <section className="section home-perspectives" aria-labelledby="perspectives-title">
      <Container><div className="home-perspectives__heading motion-reveal"><p className="section-index">LNX en trois regards</p><h2 id="perspectives-title">Une musique qui prend le réel au sérieux.</h2></div><div className="home-perspectives__grid motion-reveal motion-reveal--soft">{perspectives.map((perspective) => <article className="home-perspective" key={perspective.title}><span>{perspective.number}</span><h3>{perspective.title}</h3><p>{perspective.description}</p></article>)}</div></Container>
    </section>

    <section className="home-contact home-contact--compact" id="sur-mesure" aria-labelledby="home-contact-title"><Container className="home-contact__inner motion-reveal"><p className="section-index">Votre histoire</p><div><h2 id="home-contact-title">Et si la prochaine histoire était la vôtre ?</h2><p>Quelques détails suffisent pour ouvrir la première scène.</p><div className="home-contact__actions"><ButtonLink href="/commander">Commander une création</ButtonLink><ButtonLink href="/contact" variant="quiet">Écrire à LNX Beats</ButtonLink></div></div></Container></section>
  </>;
}
