import type { Project } from "@/data/discography";

export function Tracklist({ project }: { project: Project }) {
  if (project.tracks.length === 0) {
    return (
      <div className="tracklist-empty">
        <p className="eyebrow">Tracklist</p>
        <h2>Détail à venir</h2>
        <p>
          {project.trackCount
            ? `Le projet compte ${project.trackCount} titres. Leur détail sera publié ici dès qu’une source officielle permettra de le confirmer.`
            : "La liste des titres sera publiée ici lorsqu’elle aura été officiellement annoncée."}
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="tracklist-title">
      <div className="catalog-header">
        <h2 id="tracklist-title">Tracklist</h2>
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
