
import { T } from "@/components/site-language";
import type { Project } from "@/lib/catalog/types";

export function Tracklist({ project }: { project: Project }) {
  if (project.tracks.length === 0) {
    const hasConfirmedCount = project.dataConfidence.tracklist === "partial" && project.trackCount !== null;

    return (
      <div className="tracklist-empty">
        <p className="eyebrow"><T text="Les chapitres"/></p>
        <h2>{hasConfirmedCount ? <T text="Le nombre est connu. Les titres restent à documenter."/> : <T text="Aucune tracklist confirmée."/>}</h2>
        <p>
          {hasConfirmedCount
            ? <T text="{count} titres sont documentés pour ce projet. Leurs noms et leur ordre ne sont pas encore renseignés." values={{ count: project.trackCount ?? 0 }}/>
            : <T text="Aucun titre ni ordre de piste n’est encore renseigné. Rien n’est ajouté par supposition."/>}
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="tracklist-title">
      <div className="catalog-header">
        <h2 id="tracklist-title"><T text="Les chapitres"/></h2>
        <span><T text={project.tracks.length === 1 ? "{count} titre" : "{count} titres"} values={{ count: project.tracks.length }}/></span>
      </div>
      <ol className="tracklist">
        {project.tracks.map((track) => (
          <li key={`${track.number}-${track.title}`}>
            <span className="tracklist__number">{String(track.number).padStart(2, "0")}</span>
            <span className="tracklist__title notranslate" translate="no">{track.title}{track.primaryArtist ? <small style={{ display: "block" }}>{track.primaryArtist}</small> : null}</span>
            {track.duration ? <span className="tracklist__duration">{track.duration}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
