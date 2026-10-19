/** Admin wording only. These labels never change an offer scope or a sale requirement. */
export function digitalAdminReleaseLabels(type: string, includesMp3Only = false) {
  const kind = type === "SINGLE" ? "Single" : type === "ALBUM" ? "Album" : "Projet";
  return {
    kind,
    completeOffer: type === "SINGLE" ? "Offre du single complet" : type === "ALBUM" ? "Offre de l’album complet" : "Offre du projet complet",
    completeAvailability: `${kind} complet — TEST`,
    individualOffer: "Offre du titre à l’unité",
    offerExplanation: type === "SINGLE"
      ? "Le single complet et ses titres à l’unité sont des offres distinctes. Choisissez celles à proposer ; leurs prix ne s’additionnent pas."
      : "L’édition complète et les titres à l’unité ont des prix indépendants. La vente de tous les titres à l’unité n’est pas obligatoire.",
    includedTrack: "Incluse dans l’édition si le projet est publié et visible",
    excludedTrack: "Non incluse — piste annoncée ou non listée",
    formats: includesMp3Only ? "Formats exacts indiqués par version. Une source MP3 uniquement reste compressée : aucun WAV ni qualité supérieure n’est annoncé. Aucun fichier complet n’est fourni dans cette prévisualisation." : "Formats : WAV original et MP3 privé par piste. Deux ZIP séparés, WAV et MP3, pour l’édition complète. Aucun fichier complet n’est fourni dans cette prévisualisation.",
  };
}
export function digitalAdminSeconds(milliseconds: number) {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(milliseconds / 1000)} s`;
}
export function digitalAdminMasterLabel(version: number, codec = "wav") {
  return version > 0 ? `Version audio ${version} — ${codec === "mp3" ? "MP3 source privé" : "WAV privé"}` : "WAV à importer";
}
export function digitalAdminMp3Label(ready: boolean, bitrateKbps: number | null, sourceOnly = false) {
  if (sourceOnly) return "MP3 uniquement : source compressée d’origine, aucun WAV créé";
  if (!ready) return "MP3 privé : à préparer après l’import WAV";
  return bitrateKbps ? `MP3 privé : prêt (${bitrateKbps} kbit/s)` : "MP3 privé : présent, débit à vérifier";
}
export function digitalAdminExcerptLabel(startMs: number, durationMs: number | null) {
  return durationMs ? `Extrait : ${digitalAdminSeconds(durationMs)} · Début : ${digitalAdminSeconds(startMs)}` : "Extrait à préparer ou à vérifier";
}
export function digitalAdminMasterState(status: string) {
  return ({ READY: "Validée", QUARANTINED: "À vérifier", FAILED: "Échec" } as Record<string, string>)[status] ?? "État à vérifier";
}
