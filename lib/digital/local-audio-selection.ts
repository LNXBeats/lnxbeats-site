import { multipartFileSignature } from "@/lib/creations/direct-multipart-upload";
import { DIGITAL_BATCH_FILE_LIMIT } from "./admin";
import { DIGITAL_MASTER_LIMIT_BYTES } from "./domain";

type LocalAudioFile = { name: string; size: number; type: string; lastModified: number };
// Mirrors inspectDigitalMp3's strict bound. Its server-only audio module must
// never enter this browser helper; the server remains the format authority.
const LOCAL_MP3_LIMIT_BYTES = 96 * 1024 * 1024;

/** Local preparation only: no file bytes are read, persisted or transmitted. */
export function appendLocalAudioFiles<T extends LocalAudioFile>(current: T[], incoming: T[]): { files: T[]; error: string | null } {
  for (const file of incoming) {
    const extension = file.name.match(/\.(wav|mp3)$/i)?.[1].toLowerCase();
    if (!extension) return { files: current, error: "Choisissez uniquement des fichiers WAV ou MP3. La sélection précédente est conservée." };
    if (!Number.isSafeInteger(file.size) || file.size < 1) return { files: current, error: "Un fichier est vide ou sa taille est invalide. La sélection précédente est conservée." };
    if (extension === "wav" ? file.size > DIGITAL_MASTER_LIMIT_BYTES : file.size >= LOCAL_MP3_LIMIT_BYTES) {
      return { files: current, error: "Fichier trop volumineux : WAV 512 Mio maximum ; MP3 moins de 96 Mio. La sélection précédente est conservée." };
    }
  }
  const signatures = new Set<string>(), files: T[] = [];
  for (const file of [...current, ...incoming]) {
    const signature = multipartFileSignature(file);
    if (signatures.has(signature)) continue;
    signatures.add(signature); files.push(file);
  }
  if (files.length > DIGITAL_BATCH_FILE_LIMIT) return { files: current, error: "Limite de 50 fichiers sélectionnés. La sélection précédente est conservée." };
  return { files, error: null };
}
