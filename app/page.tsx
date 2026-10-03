import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { AudioPreviewPlayer } from "@/components/audio-preview-player";
import { Container } from "@/components/container";
import { ProjectArtwork } from "@/components/project-artwork";
import { PlatformLink } from "@/components/platform-link";
import { quickAccessPlatforms } from "@/data/site";
import { getHomepageProjects } from "@/lib/catalog/queries";
import { isSupportEnabled } from "@/lib/support/config";
import "./v110-editorial-polish.css";

const homeDescription = "LNX Beats transforme les scènes ordinaires, les souvenirs et les émotions en récits musicaux. Chaque histoire mérite sa musique.";

export const metadata: Metadata = {
  title: "LNX Beats — Chaque histoire mérite sa musique",
  description: homeDescription,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", title: "LNX Beats — Chaque histoire mérite sa musique", description: homeDescription, images: [{ url: "/og.png", width: 1200, height: 630, alt: "LNX Beats — Chaque histoire mérite sa musique." }] },
  twitter: { card: "summary_large_image", title: "LNX Beats — Chaque histoire mérite sa musique", description: homeDescription, images: ["/og.png"] },
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { lead: leadProject } = await getHomepageProjects();

  return <>
    <section className="home-hero home-hero--editorial home-hero--vfinal" aria-labelledby="home-hero-title" data-motion-scene="home">
      <div className="home-hero__media" aria-hidden="true" data-motion-layer="media"><Image src="/assets/v3/hero-main-ludovic-dog-exact.jpg" alt="" fill priority sizes="100vw" /></div>
      <Container className="home-hero__inner">
        <div className="home-hero__copy home-hero__copy--editorial" data-motion-layer="copy">
          <h1 id="home-hero-title" className="home-hero__wordmark">
            <span className="visually-hidden">LNX Beats</span>
            <Image src="/assets/v3/lnx-beats-signature-transparent.png" alt="" width={1501} height={348} priority />
          </h1>
          <p className="eyebrow home-hero__eyebrow">
            <span className="home-hero__eyebrow-story">Des histoires, des personnages, des morceaux qui restent.</span>
          </p>
          <p className="home-hero__slogan">Les histoires deviennent musique.</p>
          <p className="home-hero__lead">Chaque histoire mérite sa musique.</p>
          <div className="home-hero__actions"><ButtonLink href="/discographie">Découvrir la musique</ButtonLink><ButtonLink href="/commander" variant="secondary">Commander une création</ButtonLink></div>
        </div>
        <div className="home-hero__signature" aria-hidden="true" data-motion-layer="signature"><span>Des univers qui touchent</span><span>Une ambiance unique</span><span>Plus qu’une musique, des émotions</span></div>
      </Container>
    </section>

    {leadProject ? <section className="section home-featured home-featured--editorial home-featured--vfinal" aria-labelledby="featured-title">
      <Container className="home-featured__layout">
        <div className="home-featured__heading motion-reveal"><div><p className="section-index">À la une</p><h2 id="featured-title">Une histoire à écouter.</h2></div><ButtonLink href="/discographie" variant="quiet">Toute la discographie</ButtonLink></div>
        <article className="home-project-lead motion-reveal motion-reveal--soft" data-motion-tilt="featured-project">
          <Link className="home-project-lead__art" href={`/album/${leadProject.slug}`} aria-label={`Ouvrir l’univers ${leadProject.title}`}><ProjectArtwork project={leadProject} priority sizes="(max-width: 820px) calc(100vw - 48px), 48vw" /></Link>
          <div className="home-project-lead__copy"><p className="eyebrow">Projet à la une · {leadProject.type === "album" ? "Album" : "Single"}</p><h3>{leadProject.title}</h3><p>{leadProject.description}</p>{leadProject.audioPreview ? <AudioPreviewPlayer src={leadProject.audioPreview.url} title={leadProject.title} durationMs={leadProject.audioPreview.durationMs} compact /> : null}<ButtonLink href={`/album/${leadProject.slug}`} variant="quiet">Entrer dans le projet</ButtonLink></div>
        </article>
      </Container>
    </section> : null}

    <section className="home-universe-vfinal" aria-labelledby="home-universe-title">
      <Container>
        <p className="eyebrow">Au cœur de LNX Beats</p>
        <h2 id="home-universe-title">Le réel comme point de départ.<br /><em>La musique comme horizon.</em></h2>
        <div className="home-universe-vfinal__grid">
          <Link href="/discographie"><span className="home-universe-vfinal__index" aria-hidden="true">01</span><div><h3>Des histoires</h3><p>Des personnages, des liens, des scènes du quotidien qui deviennent des morceaux.</p><span className="home-universe-vfinal__link">Explorer la discographie <span aria-hidden="true">↗</span></span></div></Link>
          <Link href="/creations"><span className="home-universe-vfinal__index" aria-hidden="true">02</span><div><h3>Des rencontres</h3><p>Des voix, des images et des collaborations. Chaque création garde sa singularité.</p><span className="home-universe-vfinal__link">Voir les créations <span aria-hidden="true">↗</span></span></div></Link>
          <Link href="/commander"><span className="home-universe-vfinal__index" aria-hidden="true">03</span><div><h3>Votre récit</h3><p>Une histoire à confier, des émotions à préserver, une création à imaginer ensemble.</p><span className="home-universe-vfinal__link">Préparer mon projet <span aria-hidden="true">↗</span></span></div></Link>
        </div>
      </Container>
    </section>

    <section className="home-platforms-vfinal" aria-labelledby="home-platforms-title">
      <Container>
        <div className="home-platforms-vfinal__intro"><Image src="/assets/v3/lnx-beats-signature-source-apple-artist.jpg" alt="LNX Beats — signature officielle" width={1536} height={614} unoptimized /><div><p className="eyebrow">L’écoute continue</p><h2 id="home-platforms-title">Retrouvez LNX Beats.</h2><p>Les profils officiels, pour écouter les morceaux et suivre les prochaines histoires.</p></div></div>
        <ul aria-label="Écouter et suivre LNX Beats">{quickAccessPlatforms.map(({ name, url, icon }) => <li key={name}><PlatformLink name={name} url={url} icon={icon} compact /></li>)}</ul>
      </Container>
    </section>

    {isSupportEnabled() ? <section className="home-support-vfinal" aria-labelledby="home-support-title"><Container><div><p className="eyebrow">Prolonger la création</p><h2 id="home-support-title">Soutenir LNX Beats</h2><p>Un soutien libre, sans contrepartie. Pour contribuer au développement du projet, simplement.</p></div><ButtonLink href="/soutenir" variant="secondary">Soutenir LNX Beats</ButtonLink></Container></section> : null}

    <section className="home-contact home-contact--compact home-contact--editorial" id="sur-mesure" aria-labelledby="home-contact-title"><Container className="home-contact__inner motion-reveal"><p className="section-index">Votre histoire</p><div><h2 id="home-contact-title">Et si la prochaine histoire était la vôtre ?</h2><p>Quelques détails suffisent pour ouvrir la première scène.</p><div className="home-contact__actions"><ButtonLink href="/commander">Commander une création</ButtonLink><ButtonLink href="/contact" variant="quiet">Écrire à LNX Beats</ButtonLink></div></div></Container></section>
  </>;
}
