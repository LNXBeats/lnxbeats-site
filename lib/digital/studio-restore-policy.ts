import { DigitalError } from "./domain";
import { studioHash } from "./studio-policy";

export const STUDIO_RESTORE_POLICY = "LNX_STUDIO_RESTORE_EXACT_V1";
export const STUDIO_RESTORE_REQUIRED_ROLES = ["ORIGINAL", "MP3", "WAV_CD", "WAV_24", "PREVIEW"] as const;
export const STUDIO_RESTORE_COPY_ROLES = ["MP3", "WAV_CD", "WAV_24", "PREVIEW", "AUDITION_WAV_CD", "AUDITION_WAV_24"] as const;
export type StudioRestoreCurrent = {
  id: string; trackId: string; version: number; masterAssetId: string; masterSha256: string | null;
  title: string; album: string | null; metadata: unknown;
};
export type StudioRestoreSource = {
  id: string; trackId: string; status: string; decision: string; binding: string | null;
  publishedMasterId: string | null; sourceLossy: boolean; title: string; album: string | null; metadata: unknown;
};
export function studioRestoreCurrentBinding(current: StudioRestoreCurrent) {
  if (!Number.isSafeInteger(current.version) || current.version < 1 || !/^[a-f0-9]{64}$/.test(current.masterSha256 ?? "")) throw new DigitalError("STUDIO_RESTORE_CURRENT_REQUIRED", 409);
  return studioHash({ policy: STUDIO_RESTORE_POLICY, currentMasterId: current.id, trackId: current.trackId,
    version: current.version, masterAssetId: current.masterAssetId, masterSha256: current.masterSha256,
    title: current.title, album: current.album, metadata: current.metadata });
}
export function studioRestoreAvailable(source: StudioRestoreSource, current: StudioRestoreCurrent | null) {
  return !!current && source.status === "READY" && source.decision === "APPROVED" && source.sourceLossy === false
    && !!source.publishedMasterId && source.publishedMasterId !== current.id && source.trackId === current.trackId
    && /^[a-f0-9]{64}$/.test(source.binding ?? "") && /^[a-f0-9]{64}$/.test(current.masterSha256 ?? "")
    && source.title === current.title && source.album === current.album && studioHash(source.metadata) === studioHash(current.metadata);
}
export function studioRestoreAvailability(source: StudioRestoreSource, current: StudioRestoreCurrent | null, hasAcquisitions = false) {
  if (!current) return { restoreAllowed: false, restoreCurrent: null };
  try {
    const binding = studioRestoreCurrentBinding(current);
    return { restoreAllowed: studioRestoreAvailable(source, current), restoreCurrent: {
      masterId: current.id, version: current.version, binding, hasAcquisitions,
    } };
  } catch { return { restoreAllowed: false, restoreCurrent: null }; }
}
export function studioRestorePreparationKey(sourceJobId: string, sourceBinding: string, currentBinding: string) {
  if (![sourceBinding, currentBinding].every(value => /^[a-f0-9]{64}$/.test(value))) throw new DigitalError("STUDIO_VERSION_CHANGED", 409);
  return studioHash({ policy: STUDIO_RESTORE_POLICY, sourceJobId, sourceBinding, currentBinding });
}
export function assertStudioRestoreRequest(source: StudioRestoreSource, current: StudioRestoreCurrent | null, input: {
  expectedBinding: string; expectedCurrentBinding?: string; confirmReplacement: boolean;
}) {
  if (!current || !studioRestoreAvailable(source, current)) throw new DigitalError("STUDIO_RESTORE_NOT_AVAILABLE", 409);
  if (source.binding !== input.expectedBinding || studioRestoreCurrentBinding(current) !== input.expectedCurrentBinding) throw new DigitalError("STUDIO_VERSION_CHANGED", 409);
  if (!input.confirmReplacement) throw new DigitalError("STUDIO_REPLACEMENT_CONFIRMATION_REQUIRED", 409);
  return { preparationKey: studioRestorePreparationKey(source.id, input.expectedBinding, input.expectedCurrentBinding),
    sourceJobId: source.id, sourceBinding: input.expectedBinding, currentBinding: input.expectedCurrentBinding,
    currentMasterId: current.id, currentVersion: current.version };
}
