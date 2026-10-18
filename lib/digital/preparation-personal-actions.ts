import type { PreparationInput, PreparedTrack } from "./discography-preparation-policy";

type PersonalPreparationInput = Readonly<Pick<PreparationInput, "id" | "slug" | "artistDocumented" | "coverCleared" | "coverConflict" | "tracks">>;
export type PersonalPreparationAction = { code: string; label: string; action: string; href: string };

export function preparationCounterLabels(displayedProjects: number, catalogueTracks: readonly Pick<PreparedTrack, "technicalReady">[]) {
  return {
    projects: `${displayedProjects} ${displayedProjects === 1 ? "projet affiché" : "projets affichés"}`,
    catalogue: `Catalogue complet : ${catalogueTracks.filter(t => t.technicalReady).length}/${catalogueTracks.length} pistes techniquement prêtes`,
  };
}

/** Read-only presentation of existing guards, never a decision or a publication action. */
export function preparationPersonalActions(project: PersonalPreparationInput): PersonalPreparationAction[] {
  const id = encodeURIComponent(project.id), review = `/admin/musique/revue?projet=${id}`;
  const express = `/admin/musique/express?projet=${id}`;
  const rights = project.tracks.filter(t => t.technicalReady && !t.rightsApproved).length;
  const artistic = project.tracks.filter(t => t.technicalReady && !t.artisticValidated).length;
  const composers = project.tracks.filter(t => !t.composerDocumented).length;
  const ambiguous = project.tracks.filter(t => !t.technicalReady).length;
  const actions: PersonalPreparationAction[] = [];
  if (rights) actions.push({ code: "VERSION_RIGHTS", label: `Droits : ${rights} version(s) à examiner avec leurs preuves privées.`, action: "Examiner les droits", href: `${review}#droits-originaux` });
  if (artistic) actions.push({ code: "ARTISTIC_REVIEW", label: `Écoute et validation artistique : ${artistic} extrait(s) restant(s). Les écoutes déjà enregistrées sont conservées dans la revue.`, action: "Reprendre mon écoute", href: review });
  const credits = [...(!project.artistDocumented ? ["artiste du projet à documenter"] : []), ...(composers ? [`compositeur à documenter pour ${composers} titre(s)`] : [])];
  if (credits.length) actions.push({ code: "CREDITS_DOCUMENTATION", label: `Crédits : ${credits.join(" ; ")}. Aucun nom n’est déduit automatiquement.`, action: "Compléter les crédits documentés", href: `/admin/catalogue/${encodeURIComponent(project.slug)}` });
  if (!project.coverCleared || project.coverConflict) actions.push({ code: "COVER_REVIEW", label: project.coverConflict ? "Pochette : plusieurs fichiers sont associés ; identifier la bonne image et son autorisation." : "Pochette : vérifier l’image exacte et son autorisation de présentation.", action: "Examiner la pochette", href: `${express}#identite` });
  if (ambiguous) actions.push({ code: "MASTER_IDENTITY", label: `Sources : ${ambiguous} version(s) ambiguë(s) ou sans fichier commercialisable démontré. Aucun import n’est repris automatiquement.`, action: "Examiner les sources en attente", href: `${express}#audio` });
  return actions;
}
