/** Preparation only. This policy neither grants rights nor activates an offer. */
export const DISCOGRAPHY_STATES = ["ALREADY_LIVE", "READY_FOR_COMMERCIAL_REVIEW", "PUBLIC_COMING_SOON", "PRIVATE_REVIEW_REQUIRED"] as const;
export type DiscographyState = typeof DISCOGRAPHY_STATES[number];
export type PreparationIssue = { code: string; label: string; action: string; section: "identite" | "audio" | "droits" | "verification" };
export function preparationIssueGroup(code: string) { return code === "ARTIST_CREDIT" ? "CREDITS_DOCUMENTATION" : code; }
export type PreparedTrack = { id: string; title: string; position: number; released: boolean; masterId: string | null; version: number | null; durationMs: number | null;
  technicalReady: boolean; rightsApproved: boolean; mediaCleared?: boolean; artisticValidated: boolean; publicPreviewAllowed: boolean; priceCents: number | null; composerDocumented: boolean };
export type PreparationInput = { id: string; slug: string; title: string; type: string; publicVisible: boolean; status: string;
  coverCleared: boolean; coverConflict: boolean; artistDocumented: boolean; announcementAllowed?: boolean; albumPriceCents: number | null; activeOffers: number; tracks: PreparedTrack[] };
export function preparationPrice(scope: string, current: number | null) {
  if (scope !== "ALBUM" && scope !== "TRACK") throw new Error("INVALID_OFFER_SCOPE");
  return current === null ? scope === "ALBUM" ? 990 : 129 : current;
}
function validPrice(value: number | null) { return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 100_000; }
export function trackPreparationIssues(track: PreparedTrack): PreparationIssue[] {
  const items: PreparationIssue[] = [];
  if (!track.technicalReady) items.push({ code: "MASTER_IDENTITY", label: "Master WAV exact et dérivés non démontrés", action: "Confirmer la version et sa source ; ne pas associer par ressemblance.", section: "audio" });
  if (track.technicalReady && !track.rightsApproved) items.push({ code: "VERSION_RIGHTS", label: "Droits de cette version à confirmer", action: "Réunir les preuves œuvre, interprétation, master et tiers ; attestation explicite dans Express.", section: "droits" });
  if (track.technicalReady && track.rightsApproved && track.mediaCleared === false) items.push({ code: "COMMERCIAL_ACKNOWLEDGEMENT", label: "Droits de version enregistrés · ouverture commerciale distincte", action: "Ne pas redemander la même attestation. Vérifier les autres gardes puis décider séparément de l’offre ; aucun droit global de fichier n’est modifié par cette revue.", section: "verification" });
  if (track.technicalReady && !track.artisticValidated) items.push({ code: "ARTISTIC_REVIEW", label: "Extrait à écouter et valider personnellement", action: "Écouter l’extrait existant, puis utiliser la validation Admin.", section: "audio" });
  if (!track.composerDocumented) items.push({ code: "CREDITS_DOCUMENTATION", label: "Compositeur non documenté dans le catalogue", action: "Fournir le crédit exact ; ne pas déduire les autres rôles ni les droits.", section: "identite" });
  if (!validPrice(track.priceCents)) items.push({ code: "TRACK_PRICE", label: track.priceCents === null ? "Prix non renseigné" : "Prix existant à vérifier", action: "Préparer 1,29 € si le prix est absent ; ne jamais remplacer automatiquement un prix existant.", section: "verification" });
  if (!track.released) items.push({ code: "TRACK_PUBLICATION", label: "Inclusion publique de la piste non confirmée", action: "Vérifier son inclusion avant toute publication.", section: "verification" });
  return items;
}
export function classifyDiscography(input: PreparationInput) {
  const issues: PreparationIssue[] = [];
  if (!input.coverCleared || input.coverConflict) issues.push({ code: "COVER_REVIEW", label: input.coverConflict ? "Plusieurs pochettes : priorité ou autorisation à vérifier" : "Autorisation de la pochette à confirmer", action: "Vérifier la pochette exacte et ses preuves privées.", section: "identite" });
  if (!input.artistDocumented) issues.push({ code: "ARTIST_CREDIT", label: "Crédit artiste du projet non documenté", action: "Renseigner le crédit sourcé, sans en déduire les auteurs ou interprètes.", section: "identite" });
  if (input.type === "ALBUM" && !validPrice(input.albumPriceCents)) issues.push({ code: "ALBUM_PRICE", label: "Prix album à vérifier", action: "Préparer 9,90 € si absent, sans remplacer un prix existant ni activer la vente.", section: "verification" });
  if (input.status === "IN_DEVELOPMENT" && input.publicVisible && input.announcementAllowed !== true) issues.push({ code: "ANNOUNCEMENT_REVIEW", label: "Provenance de l’annonce à réexaminer", action: "Revoir le titre, la pochette, les crédits et les versions modifiés avant de proposer une nouvelle annonce publique.", section: "identite" });
  const technicalReady = input.tracks.length > 0 && input.tracks.every(t => t.technicalReady);
  const exactApprovals = technicalReady && input.tracks.every(t => t.rightsApproved && t.artisticValidated && t.released && validPrice(t.priceCents));
  const complete = exactApprovals && input.coverCleared && !input.coverConflict && input.artistDocumented && (input.type !== "ALBUM" || validPrice(input.albumPriceCents));
  // Existing explicit catalogue publication + CLEARED cover permits metadata only.
  // It is never used as evidence of audio, copyright or sales authorization.
  const historicalMetadataAllowed = (input.status === "PUBLISHED" || input.status === "IN_DEVELOPMENT" && input.announcementAllowed === true)
    && input.publicVisible && input.coverCleared && !input.coverConflict && technicalReady && input.tracks.every(t => t.released);
  const state: DiscographyState = input.activeOffers > 0 ? "ALREADY_LIVE" : complete ? "READY_FOR_COMMERCIAL_REVIEW" : historicalMetadataAllowed ? "PUBLIC_COMING_SOON" : "PRIVATE_REVIEW_REQUIRED";
  return { state, complete, technicalReady, metadataPublicAllowed: state === "ALREADY_LIVE" || historicalMetadataAllowed, issues };
}
export const discographyStateLabel: Record<DiscographyState, string> = { ALREADY_LIVE: "Déjà en vente — préservé", READY_FOR_COMMERCIAL_REVIEW: "Prêt pour décision commerciale", PUBLIC_COMING_SOON: "Arrive bientôt — vente indisponible", PRIVATE_REVIEW_REQUIRED: "Revue privée nécessaire" };
export function discographyPreparationEnabled() { return process.env.DCN_DISCOGRAPHY_V13_ENABLED === "true"; }
