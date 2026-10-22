type AdminCatalogProject = { id: string; slug: string; type: string };

/** Reuse the existing project; entering Express never creates a second edition. */
export function adminMusicEditorHref(project: AdminCatalogProject) {
  return project.type === "ALBUM" || project.type === "SINGLE"
    ? `/admin/musique/express?projet=${encodeURIComponent(project.id)}`
    : `/admin/catalogue/${encodeURIComponent(project.slug)}`;
}

/** Advanced catalog creation and its validation feedback remain reachable explicitly. */
export function shouldUseExpressCatalogCreation(params: { avance?: string; etat?: string }) {
  return params.avance !== "1" && !params.etat;
}
