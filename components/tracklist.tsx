import type { Project } from "@/data/discography";

export function Tracklist({ project }: { project: Project }) {
  if (project.tracks.length === 0) {
    const hasConfirmedCount = project.dataConfidence.tracklist === "partial" && project.trackCount !== null;

    return (
      <div className="tracklist-empty">
        <p className="eyebrow">Les chapitres</p>
        <h2>{hasConfirmedCount ? "Le nombre est connu. Les titres restent à documenter." : "Aucune tracklist confirmée."}</h2>
        <p>
          {hasConfirmedCount
            ? `${project.trackCount} titres sont documentés pour ce projet. Leurs noms et leur ordre ne figurent pas encore dans les sources locales autorisées.`
            : "Aucun titre ni ordre de piste ne figure encore dans les sources locales autorisées. Rien n’est ajouté par supposition."}
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
