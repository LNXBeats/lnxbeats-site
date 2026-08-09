import type { Project } from "@/data/discography";

export function Tracklist({ project }: { project: Project }) {
  if (project.tracks.length === 0) {
    return (
      <div className="tracklist-empty">
        <p className="eyebrow">Les chapitres</p>
        <h2>Les titres viendront au bon moment.</h2>
        <p>
          {project.trackCount
            ? `${project.trackCount} titres composent cet univers. Leurs noms resteront dans l’ombre jusqu’à leur révélation officielle.`
            : "La liste reste volontairement silencieuse jusqu’à son annonce officielle."}
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="tracklist-title">
      <div className="catalog-header">
        <h2 id="tracklist-title">Les chapitres</h2>
        <span>{project.tracks.length} {project.tracks.length > 1 ? "titres" : "titre"}</span>
      </div>
      <ol className="tracklist">
        {project.tracks.map((track) => (
          <li key={`${track.number}-${track.title}`}>
            <span className="tracklist__number">{String(track.number).padStart(2, "0")}</span>
            <span className="tracklist__title">{track.title}</span>
            {track.duration ? <span className="tracklist__duration">{track.duration}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
