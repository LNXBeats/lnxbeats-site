import { parseEuroCents } from "./domain";
import { expressDraft, type ExpressDraft } from "./express-policy";

export type ExpressEditorTrack = { id: string | null; title: string; price: string; expectedOfferVersion: number };
/** Disable editing until recovery completes, including in the server-rendered form. */
export function expressEditorLocked(cacheReady: boolean, busy: boolean, active: boolean, uncertain: boolean) {
  void active; // Existing sales protect their identity, not unrelated draft offers/prices.
  return !cacheReady || busy || uncertain;
}
/** Presentation only: the authoritative draft policy still validates the whole payload. */
export function expressEditorTracks(type: "SINGLE" | "ALBUM", title: string, tracks: ExpressEditorTrack[], distinctSingleTitle: boolean) {
  return tracks.map(t => ({ id: t.id, title: type === "SINGLE" && !distinctSingleTitle ? title : t.title,
    priceCents: parseEuroCents(t.price), expectedOfferVersion: t.expectedOfferVersion }));
}
export function hasDistinctSingleTitle(title: string, tracks: Array<{ title: string }>) {
  return tracks.length === 1 && !!tracks[0].title.trim() && tracks[0].title.trim() !== title.trim();
}
/** Cached attempts are never submitted automatically and are scoped to one actor/project by the caller. */
export function recoverExpressAttempt(value: unknown, projectId: string | null): ExpressDraft | null {
  try { const draft = expressDraft(value); return draft.projectId === projectId ? draft : null; } catch { return null; }
}
export function expressDurationLabel(milliseconds: number | null) {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return "Durée à analyser";
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function digitalUploadPhaseLabel(phase: string, filename: string) {
  const format = /\.mp3$/i.test(filename) ? "MP3" : "WAV";
  return ({ initializing: "Préparation", uploading: `Envoi du ${format}`, finalizing: "Fin de l’envoi", validating: "Vérification audio",
    analyzing: `Analyse du ${format}`, transcoding: format === "MP3" ? "Préparation du brouillon MP3" : "Création du MP3 et de l’extrait",
    ready: "Fichier vérifié", paused: "En pause", retrying: "Reprise" } as Record<string, string>)[phase] ?? "Traitement audio";
}
export function expressBatchPercent(progress: Record<string, { percent: number }>, ids: string[], states?: Record<string, string>) {
  return ids.length ? Math.round(ids.reduce((sum, id) => sum + (states?.[id] === "ready" ? 100 : Math.max(0, Math.min(states ? 95 : 100, progress[id]?.percent ?? 0))), 0) / ids.length) : 0;
}
