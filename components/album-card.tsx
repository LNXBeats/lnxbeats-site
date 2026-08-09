import type { Release } from "@/data/discography";

export function AlbumCard({ release, index }: { release: Release; index: number }) {
  return (
    <article className="release-card">
      <a href={release.primaryUrl} target="_blank" rel="noopener noreferrer" aria-label={`Écouter ${release.title} — nouvel onglet`}>
        <div className="release-card__art" aria-hidden="true">
          <span className="release-card__number">{String(index + 1).padStart(2, "0")}</span>
          <span className="release-card__monogram">LNX</span>
          <span className="release-card__line" />
        </div>
        <div className="release-card__body">
          <div>
            <p className="release-card__meta">
              {release.kind === "album" ? "Album" : "Single"}
              {release.trackCount ? ` · ${release.trackCount} titres` : ""}
            </p>
            <h3>{release.title}</h3>
          </div>
          <span className="release-card__action" aria-hidden="true">↗</span>
        </div>
      </a>
    </article>
  );
}
