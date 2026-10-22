import { multipartFileSignature } from "@/lib/creations/direct-multipart-upload";
import { DIGITAL_BATCH_FILE_LIMIT } from "./admin";
import { appendLocalAudioFiles } from "./local-audio-selection";

type LocalAudioFile = Pick<File, "name" | "size" | "type" | "lastModified">;
export type BoundAudioQueueEntry<T extends LocalAudioFile = File> = { id: string; file: T; studio?: true; trackId: string };

/** Merge deliberate title/file bindings without replacing an existing queued upload. */
export function mergeBoundAudioQueue<T extends LocalAudioFile, E extends { id: string; file: T; studio?: true; trackId?: string }>(
  entries: E[], incoming: Array<{ file: T; trackId: string }>, allowedTrackIds: string[],
  studio: boolean, makeId: () => string,
): { entries: Array<E | BoundAudioQueueEntry<T>>; error: string | null } {
  const validated = appendLocalAudioFiles([], incoming.map(item => item.file));
  if (validated.error) return { entries, error: validated.error };
  const allowed = new Set(allowedTrackIds), pending: Array<{ file: T; trackId: string }> = [];
  for (const item of incoming) {
    if (!item.trackId || !allowed.has(item.trackId)) return { entries, error: "La piste associée a changé ou n’est plus disponible. Aucun fichier n’a été ajouté." };
    const signature = multipartFileSignature(item.file);
    const sameDestination = entries.filter(entry => entry.trackId === item.trackId);
    if (sameDestination.some(entry => multipartFileSignature(entry.file) !== signature)) {
      return { entries, error: "Un autre fichier est déjà préparé pour ce titre. Retirez-le explicitement avant de le remplacer. La file précédente est conservée." };
    }
    const sameFile = entries.filter(entry => multipartFileSignature(entry.file) === signature);
    if (sameFile.some(entry => entry.trackId !== item.trackId)) {
      return { entries, error: "Ce fichier est déjà préparé pour une autre piste ou sans association. Retirez cette entrée avant de modifier son association. La file précédente est conservée." };
    }
    if (sameFile.length) continue;
    const pendingDestination = pending.find(entry => entry.trackId === item.trackId);
    if (pendingDestination && multipartFileSignature(pendingDestination.file) !== signature) {
      return { entries, error: "Deux fichiers différents visent le même titre. Aucun fichier n’a été ajouté." };
    }
    const pendingFile = pending.find(entry => multipartFileSignature(entry.file) === signature);
    if (pendingFile && pendingFile.trackId !== item.trackId) {
      return { entries, error: "Un même fichier ne peut pas être associé à deux titres dans cet envoi. Aucun fichier n’a été ajouté." };
    }
    if (!pendingFile) pending.push(item);
  }
  if (entries.length + pending.length > DIGITAL_BATCH_FILE_LIMIT) {
    return { entries, error: "Limite de 50 fichiers dans la file. La file précédente est conservée." };
  }
  if (!pending.length) return { entries, error: null };
  // ID allocation and mode capture happen only after every binding has passed.
  const additions = pending.map(item => ({ id: makeId(), file: item.file, trackId: item.trackId, ...(studio ? { studio: true as const } : {}) }));
  return { entries: [...entries, ...additions], error: null };
}
