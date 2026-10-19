import type { DigitalAudioFormat } from "./formats";

/** Labels reflect the server quote or acquired snapshot, never the file extension or price. */
export function digitalFormatsLabel(formats: readonly DigitalAudioFormat[] | null | undefined) {
  if (formats?.length === 1 && formats[0] === "MP3") return "MP3 uniquement";
  if (formats?.length === 2 && formats[0] === "WAV" && formats[1] === "MP3") return "WAV + MP3";
  if (formats?.length === 1 && formats[0] === "WAV") return "WAV";
  return "Formats à vérifier";
}

export function digitalAcquiredFormatsDescription(formats: readonly DigitalAudioFormat[], legacy: boolean) {
  if (legacy && formats.length === 1 && formats[0] === "WAV") return "Achat historique : format original conservé, sans conversion rétroactive.";
  if (formats.length === 1 && formats[0] === "MP3") return "MP3 uniquement : fichier source compressé conservé, sans WAV ni amélioration de qualité annoncée.";
  if (formats.length === 2 && formats[0] === "WAV" && formats[1] === "MP3") return "WAV et MP3 inclus dans cet achat.";
  return "Formats à vérifier";
}
