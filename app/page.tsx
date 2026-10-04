import type { Metadata } from "next";
import { EditorialAdSlot } from "@/components/editorial-ad-slot";
import Image from "next/image";
import Link from "next/link";
import { AudioPreviewPlayer } from "@/components/audio-preview-player";
import { Container } from "@/components/container";
import { ProjectArtwork } from "@/components/project-artwork";
import { UiIcon } from "@/components/ui-icon";
import { quickAccessPlatforms } from "@/data/site";
import { getHomepageProjects } from "@/lib/catalog/queries";
import { isSupportEnabled } from "@/lib/support/config";
import styles from "./home-v4.module.css";

const homeDescription = "LNX Beats transforme les scènes ordinaires, les souvenirs et les émotions en récits musicaux. Chaque histoire mérite sa musique.";
export const metadata: Metadata = {
  title: "LNX Beats — Chaque histoire mérite sa musique", description: homeDescription,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", title: "LNX Beats — Chaque histoire mérite sa musique", description: homeDescription, images: [{ url: "/og.png", width: 1200, height: 630, alt: "LNX Beats — Chaque histoire mérite sa musique." }] },
  twitter: { card: "summary_large_image", title: "LNX Beats — Chaque histoire mérite sa musique", description: homeDescription, images: ["/og.png"] },
};
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { lead: leadProject } = await getHomepageProjects();
  return <div className={styles.home}>
    <section className={styles.hero} aria-labelledby="home-hero-title" data-v4-hero>
      <Container className={styles.heroGrid}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Des histoires. Des personnages.<br />Des morceaux qui restent.</p>
          <h1 id="home-hero-title" className={styles.wordmark}><span className="visually-hidden">LNX Beats</span><Image src="/assets/v3/lnx-beats-signature-transparent.png" alt="" width={1501} height={348} priority /></h1>
          <p className={styles.slogan}>Les histoires <br />deviennent musique.</p>
          <p className={styles.lead}>Chaque histoire mérite sa musique.</p>
        </div>
        <div className={styles.heroPhoto}><Image src="/assets/v3/hero-main-ludovic-dog-exact.jpg" alt="Ludovic et son chien, l’univers LNX Beats" width={1254} height={1254} priority sizes="(max-width: 760px) calc(100vw - 36px), 55vw" /></div>
        <div className={styles.heroActions}>
          <Link className={styles.primary} href="/discographie"><UiIcon name="play" /><span>Découvrir la musique</span><UiIcon name="arrow-right" /></Link>
          <Link className={styles.secondary} href="/commander"><span>Commander une création</span><UiIcon name="arrow-right" /></Link>
        </div>
      </Container>
    </section>
    {leadProject ? <section className={styles.section} aria-labelledby="featured-title"><Container>
      <div className={styles.heading}><h2 id="featured-title">À la une</h2><Link href="/discographie">Toute la discographie <UiIcon name="arrow-right" /></Link></div>
      <article className={styles.featured} data-v4-featured>
        <Link className={styles.artwork} href={`/album/${leadProject.slug}`} aria-label={`Découvrir ${leadProject.title}`}><ProjectArtwork project={leadProject} priority sizes="(max-width: 760px) 112px, 240px" /></Link>
        <div className={styles.featuredCopy}><p className={styles.eyebrow}>{leadProject.type === "album" ? "Album" : "Single"}</p><h3>{leadProject.title}</h3><Link className={styles.textLink} href={`/album/${leadProject.slug}`}>Découvrir le projet <UiIcon name="arrow-right" /></Link></div>
        <p className={styles.featuredDescription}>{leadProject.description}</p>
        {leadProject.audioPreview ? <div className={styles.featuredPlayer}><AudioPreviewPlayer src={leadProject.audioPreview.url} title={leadProject.title} durationMs={leadProject.audioPreview.durationMs} compact /></div> : null}
      </article>
    </Container></section> : null}
    <section className={styles.section} aria-labelledby="home-universe-title"><Container>
      <div className={styles.heading}><h2 id="home-universe-title">LNX en trois regards.</h2></div>
      <div className={styles.doors} data-v4-doors>
        <Link href="/discographie"><span className={styles.doorIcon}><UiIcon name="headphones" /></span><div><h3>Des histoires</h3><p>Des récits en musique, inspirés par la vie.</p></div><UiIcon name="arrow-right" /></Link>
        <Link href="/creations"><span className={styles.doorIcon}><UiIcon name="users" /></span><div><h3>Des rencontres</h3><p>Des voix, des images, des collaborations.</p></div><UiIcon name="arrow-right" /></Link>
        <Link href="/commander"><span className={styles.doorIcon}><UiIcon name="pen" /></span><div><h3>Votre récit</h3><p>Votre histoire, une création à imaginer ensemble.</p></div><UiIcon name="arrow-right" /></Link>
      </div>
    </Container></section>
    {isSupportEnabled() ? <section className={styles.section} aria-labelledby="home-support-title"><Container>
      <div className={styles.support} data-v4-support>
        <div className={styles.supportCopy}><h2 id="home-support-title">Soutenir LNX Beats</h2><p className={styles.supportSubtitle}>Un soutien libre, sans contrepartie.</p></div>
        <span className={styles.heart}><UiIcon name="heart" /></span>
        <p className={styles.supportDescription}>Pour contribuer au développement du projet et aux prochaines histoires. Merci pour votre écoute et votre soutien.</p>
        <Link className={styles.primary} href="/soutenir"><UiIcon name="heart" /><span>Soutenir LNX Beats</span><UiIcon name="arrow-right" /></Link>
        <p className={styles.testNote}>Préversion · mode test uniquement. Aucun reçu fiscal.</p>
      </div>
    </Container></section> : null}
    <section className={`${styles.section} ${styles.platforms}`} aria-labelledby="home-platforms-title"><Container>
      <div className={styles.heading}><h2 id="home-platforms-title">L’écoute continue.</h2><Link href="/contact#plateformes">Toutes les plateformes <UiIcon name="arrow-right" /></Link></div>
      <ul className={styles.platformIcons} aria-label="Écouter et suivre LNX Beats">{quickAccessPlatforms.map(({ name, url, icon }) => <li key={name}><a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${name} — nouvel onglet`} title={name}><Image src={icon} alt="" width={28} height={28} /><span className="visually-hidden">{name}</span></a></li>)}</ul>
      <div className={styles.signature}><p>Merci à tous ceux qui écoutent, partagent et soutiennent.<br />Vous faites vivre cette aventure.</p><Image src="/assets/v3/lnx-beats-signature-source-apple-artist.jpg" alt="LNX Beats — signature officielle" width={1536} height={614} unoptimized /></div>
    </Container></section>
    <EditorialAdSlot pathname="/" slot="footer" />
  </div>;
}
