import type { Metadata } from "next";
import { AlbumCard } from "@/components/album-card";
import { Container } from "@/components/container";
import { PlatformLink } from "@/components/platform-link";
import { albums, singles } from "@/data/discography";
import { siteConfig } from "@/data/site";

export const metadata: Metadata = {
  title: "Discographie",
  description: "Albums, singles et projets publiés par LNX Beats.",
  alternates: { canonical: "/discographie" },
};

export default function DiscographyPage() {
  return (
    <>
      <header className="page-hero">
        <Container className="page-hero__grid">
          <div>
            <p className="eyebrow">Écouter · Explorer</p>
            <h1>Discographie</h1>
          </div>
          <div>
            <p className="page-hero__intro">
              Albums et singles publiés par LNX Beats. Les pochettes officielles seront intégrées progressivement ; les liens ouvrent les plateformes officielles.
            </p>
            <div className="page-hero__meta"><span>{albums.length} albums</span><span>{singles.length + 1} singles</span></div>
          </div>
        </Container>
      </header>

      <div className="platform-strip" aria-label="Plateformes d’écoute">
        <Container className="platform-strip__inner">
          {siteConfig.platforms.map((platform) => <PlatformLink key={platform.name} {...platform} />)}
        </Container>
      </div>

      <section className="section catalog-section" aria-labelledby="albums-title">
        <Container>
          <div className="catalog-header">
            <h2 id="albums-title">Albums & projets</h2>
            <span>{albums.length} parutions</span>
          </div>
          <div className="release-grid">
            {albums.map((release, index) => <AlbumCard key={release.slug} release={release} index={index} />)}
          </div>
        </Container>
      </section>

      <section className="section catalog-section" aria-labelledby="singles-title">
        <Container>
          <div className="catalog-header">
            <h2 id="singles-title">Singles</h2>
            <span>{singles.length} titres</span>
          </div>
          <div className="release-grid">
            {singles.map((release, index) => <AlbumCard key={release.slug} release={release} index={index} />)}
          </div>
        </Container>
      </section>
    </>
  );
}
