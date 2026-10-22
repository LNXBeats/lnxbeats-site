import { multipartFileSignature } from "@/lib/creations/direct-multipart-upload";
import { appendLocalAudioFiles } from "./local-audio-selection";

type LocalAudioFile = Pick<File, "name" | "size" | "type" | "lastModified">;
export type ExpressLocalAudioSelection<T extends LocalAudioFile = File> = Record<string, T>;

/** A deliberate drop binds one local file to an opaque, stable form-row key. */
export function selectExpressTrackFile<T extends LocalAudioFile>(
  current: ExpressLocalAudioSelection<T>, rowKey: string, incoming: T[],
): { files: ExpressLocalAudioSelection<T>; error: string | null } {
  if (incoming.length !== 1) return { files: current, error: "Déposez un seul fichier WAV ou MP3 pour ce titre. La sélection précédente est conservée." };
  const validated = appendLocalAudioFiles([], incoming);
  if (validated.error) return { files: current, error: validated.error };
  const file = validated.files[0], signature = multipartFileSignature(file);
  if (Object.entries(current).some(([key, selected]) => key !== rowKey && multipartFileSignature(selected) === signature)) {
    return { files: current, error: "Ce fichier est déjà associé à un autre titre. Choisissez le fichier propre à ce titre. La sélection précédente est conservée." };
  }
  return { files: { ...current, [rowKey]: file }, error: null };
}

/** Resolve the saved IDs only after validating the entire row/response mapping. */
export function bindExpressTrackFiles<T extends LocalAudioFile>(
  files: ExpressLocalAudioSelection<T>,
  rows: Array<{ key: string; id: string | null }>,
  savedTracks: Array<{ id: string }>,
): Array<{ file: T; trackId: string }> {
  const mismatch = () => { throw new Error("AUDIO_TRACK_MAPPING_CHANGED"); };
  if (rows.length !== savedTracks.length) mismatch();
  const keys = new Set(rows.map(row => row.key)), ids = new Set(savedTracks.map(track => track.id));
  if (keys.size !== rows.length || ids.size !== savedTracks.length || savedTracks.some(track => !track.id)) mismatch();
  if (rows.some((row, index) => row.id !== null && row.id !== savedTracks[index].id)) mismatch();
  if (Object.keys(files).some(key => !keys.has(key))) mismatch();
  const signatures = Object.values(files).map(multipartFileSignature);
  if (new Set(signatures).size !== signatures.length) mismatch();
  return rows.flatMap((row, index) => Object.hasOwn(files, row.key) ? [{ file: files[row.key], trackId: savedTracks[index].id }] : []);
}
