import type { DigitalAudioFormat } from "./formats";
/** A single card must use its sole eligible TRACK offer, never an album fallback. */
export function digitalCardOffer(type: string, view: { album: { id: string; priceCents: number; formats?: readonly DigitalAudioFormat[] } | null; tracks: { offer: { id: string; priceCents: number; formats?: readonly DigitalAudioFormat[] } | null }[] } | null) {
  if (!view) return null;
  if (type === "single") return view.tracks.length === 1 && view.tracks[0].offer ? { ...view.tracks[0].offer, label: "Ajouter le single" } : null;
  return view.album ? { ...view.album, label: "Ajouter l’album" } : null;
}
