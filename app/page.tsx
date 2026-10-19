
import { T } from "@/components/site-language";
import { OriginalName } from "@/components/original-name";
import { LocalizedEditorial } from "@/components/localized-editorial";
import { getSiteLocale, serverT } from "@/lib/i18n/server";
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
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getSiteLocale();
  const title = serverT(locale, "LNX Beats — Chaque histoire mérite sa musique");
  const description = serverT(locale, homeDescription);
  return {
  title, description,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", title, description, images: [{ url: "/og.png", width: 1200, height: 630, alt: serverT(locale, "LNX Beats — Chaque histoire mérite sa musique.") }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const locale = await getSiteLocale();
  const { lead: leadProject } = await getHomepageProjects();
  return <div className={styles.home}>
    <section className={styles.hero} aria-labelledby="home-hero-title" data-v4-hero>
      <Container className={styles.heroGrid}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><T text="Des histoires. Des personnages."/><br /><T text="Des morceaux qui restent."/></p>
          <h1 id="home-hero-title" className={styles.wordmark}><span className="visually-hidden"><OriginalName>LNX Beats</OriginalName></span><Image src="/assets/v3/lnx-beats-signature-transparent.png" alt="" width={1501} height={348} priority /></h1>
          <p className={styles.slogan}><T text="Les histoires"/> <br /><T text="deviennent musique."/></p>
          <p className={styles.lead}><T text="Chaque histoire mérite sa musique."/></p>
        </div>
        <div className={styles.heroPhoto}><Image src="/assets/v3/hero-main-ludovic-dog-exact.jpg" alt={serverT(locale, "Ludovic et son chien, l’univers LNX Beats")} width={1254} height={1254} priority sizes="(max-width: 760px) calc(100vw - 36px), 55vw" /></div>
        <div className={styles.heroActions}>
          <Link className={styles.primary} href="/discographie"><UiIcon name="play" /><span><T text="Découvrir la musique"/></span><UiIcon name="arrow-right" /></Link>
          <Link className={styles.secondary} href="/commander"><span><T text="Commander une création"/></span><UiIcon name="arrow-right" /></Link>
        </div>
      </Container>
    </section>
    {leadProject ? <section className={styles.section} aria-labelledby="featured-title"><Container>
      <div className={styles.heading}><h2 id="featured-title"><T text="À la une"/></h2><Link href="/discographie"><T text="Toute la discographie"/> <UiIcon name="arrow-right" /></Link></div>
      <article className={styles.featured} data-v4-featured>
        <Link className={styles.artwork} href={`/album/${leadProject.slug}`} aria-label={serverT(locale, "Découvrir {title}", { title: leadProject.title })}><ProjectArtwork project={leadProject} priority sizes="(max-width: 760px) 112px, 240px" /></Link>
        <div className={styles.featuredCopy}><p className={styles.eyebrow}><T text={leadProject.type === "album" ? "Album" : "Single"}/></p><h3><OriginalName>{leadProject.title}</OriginalName></h3><Link className={styles.textLink} href={`/album/${leadProject.slug}`}><T text="Découvrir le projet"/> <UiIcon name="arrow-right" /></Link></div>
        <p className={styles.featuredDescription}><LocalizedEditorial text={leadProject.description} names={[leadProject.title]}/></p>
        {leadProject.audioPreview ? <div className={styles.featuredPlayer}><AudioPreviewPlayer src={leadProject.audioPreview.url} title={leadProject.title} durationMs={leadProject.audioPreview.durationMs} compact /></div> : null}
      </article>
    </Container></section> : null}
    <section className={styles.section} aria-labelledby="home-universe-title"><Container>
      <div className={styles.heading}><h2 id="home-universe-title"><T text="LNX en trois regards."/></h2></div>
      <div className={styles.doors} data-v4-doors>
        <Link href="/discographie"><span className={styles.doorIcon}><UiIcon name="headphones" /></span><div><h3><T text="Des histoires"/></h3><p><T text="Des récits en musique, inspirés par la vie."/></p></div><UiIcon name="arrow-right" /></Link>
        <Link href="/creations"><span className={styles.doorIcon}><UiIcon name="users" /></span><div><h3><T text="Des rencontres"/></h3><p><T text="Des voix, des images, des collaborations."/></p></div><UiIcon name="arrow-right" /></Link>
        <Link href="/commander"><span className={styles.doorIcon}><UiIcon name="pen" /></span><div><h3><T text="Votre récit"/></h3><p><T text="Votre histoire, une création à imaginer ensemble."/></p></div><UiIcon name="arrow-right" /></Link>
      </div>
    </Container></section>
    {isSupportEnabled() ? <section className={styles.section} aria-labelledby="home-support-title"><Container>
      <div className={styles.support} data-v4-support>
        <div className={styles.supportCopy}><h2 id="home-support-title"><T text="Soutenir LNX Beats"/></h2><p className={styles.supportSubtitle}><T text="Un soutien libre, sans contrepartie."/></p></div>
        <span className={styles.heart}><UiIcon name="heart" /></span>
        <p className={styles.supportDescription}><T text="Pour contribuer au développement du projet et aux prochaines histoires. Merci pour votre écoute et votre soutien."/></p>
        <Link className={styles.primary} href="/soutenir"><UiIcon name="heart" /><span><T text="Soutenir LNX Beats"/></span><UiIcon name="arrow-right" /></Link>
        <p className={styles.testNote}><T text="Préversion · mode test uniquement. Aucun reçu fiscal."/></p>
      </div>
    </Container></section> : null}
    <section className={`${styles.section} ${styles.platforms}`} aria-labelledby="home-platforms-title"><Container>
      <div className={styles.heading}><h2 id="home-platforms-title"><T text="L’écoute continue."/></h2><Link href="/contact#plateformes"><T text="Toutes les plateformes"/> <UiIcon name="arrow-right" /></Link></div>
      <ul className={styles.platformIcons} aria-label={serverT(locale, "Écouter et suivre LNX Beats")}>{quickAccessPlatforms.map(({ name, url, icon }) => <li key={name}><a href={url} target="_blank" rel="noopener noreferrer" aria-label={serverT(locale, "{name} — nouvel onglet", { name })} title={name}><Image src={icon} alt="" width={28} height={28} /><span className="visually-hidden"><OriginalName>{name}</OriginalName></span></a></li>)}</ul>
      <div className={styles.signature}><p><T text="Merci à tous ceux qui écoutent, partagent et soutiennent."/><br /><T text="Vous faites vivre cette aventure."/></p><Image src="/assets/v3/lnx-beats-signature-source-apple-artist.jpg" alt={serverT(locale, "LNX Beats — signature officielle")} width={1536} height={614} unoptimized /></div>
    </Container></section>
    <EditorialAdSlot pathname="/" slot="footer" />
  </div>;
}
