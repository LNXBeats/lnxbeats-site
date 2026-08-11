import type { Metadata } from "next";

import type { DataConfidence, Project } from "@/data/discography";
import { getProjectKindLabel, getProjectStatusLabel, projects } from "@/data/discography";
import { getProjectBySlug } from "@/data/discography";
import { homeEditorial } from "@/data/home";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Catalogue" };

function getCatalogueState(confidence: DataConfidence) {
  if (confidence === "confirmed") return "Complet";
  if (confidence === "partial") return "À compléter";
  if (confidence === "placeholder") return "Provisoire";
  return "Non documenté";
}

function getDirectLinksLabel(project: Project) {
  const count = project.platforms.filter(({ scope }) => scope === "release").length;
  if (count === 0) return "Aucun lien direct";
  return `${count} lien${count === 1 ? "" : "s"} renseigné${count === 1 ? "" : "s"}`;
}

function getTracklistLabel(project: Project) {
  const count = project.tracks.length || project.trackCount;
  if (!count) return "Non documentée";
  if (project.tracks.length) return `${count} titre${count === 1 ? "" : "s"}`;
  return `${count} titre${count === 1 ? " annoncé" : "s annoncés"}`;
}

export default async function AdminCataloguePage() {
  await requireAdmin();
  const spotlight = getProjectBySlug(homeEditorial.spotlightProjectSlug);

  return (
    <div className="admin-main">
      <header className="admin-page-heading"><div><p className="admin-kicker">Catalogue</p><h1>Audit de la discographie.</h1></div><p>{projects.length} projets composent actuellement le catalogue. Cette vue met en lumière les informations qui méritent encore votre attention.</p></header>

      <section className="admin-catalogue-notice" id="mise-en-avant">
        <div><p className="admin-section-label">Projet actuellement mis en avant</p><h2>{spotlight?.title ?? "Aucun projet sélectionné"}</h2></div>
        <p>La modification sera disponible depuis l’administration lorsque l’édition du catalogue sera activée.</p>
      </section>

      <section className="admin-list-window" aria-labelledby="catalogue-audit-title">
        <div className="admin-list-window__heading"><h2 id="catalogue-audit-title">Catalogue LNX Beats</h2><span>{projects.length} projets</span></div>
        <ul className="admin-catalogue-list">
          {projects.map((project) => {
            return <li key={project.slug}>
              <div><strong>{project.title}</strong><small>{getProjectKindLabel(project.type)} · {getProjectStatusLabel(project.status)}{project.featured ? " · Mis en avant" : ""}</small></div>
              <dl>
                <div><dt>Informations</dt><dd>{getCatalogueState(project.dataConfidence.overall)}</dd></div>
                <div><dt>Cover</dt><dd>{project.cover ? "Officielle" : "Manquante"}</dd></div>
                <div><dt>Liens directs</dt><dd>{getDirectLinksLabel(project)}</dd></div>
                <div><dt>Tracklist</dt><dd>{getTracklistLabel(project)}</dd></div>
              </dl>
            </li>;
          })}
        </ul>
      </section>

      <section className="admin-migration-window">
        <p className="admin-section-label">Édition du catalogue</p><h2>Les modifications seront bientôt disponibles ici.</h2>
        <p>Pour le moment, cette page permet de vérifier les projets et les éléments à compléter.</p>
        <p>L’édition, la mise en avant et l’ajout de covers seront activés lorsque le catalogue pourra être géré directement depuis l’administration.</p>
      </section>
    </div>
  );
}
