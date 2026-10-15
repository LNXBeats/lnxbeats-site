import { DigitalError } from "./domain";
import { DIGITAL_MP3_ENCODER_VERSION } from "./formats";

export type DigitalDuplicateMasterProof = { id: string; trackId: string; version: number; status: string; codec: string; encoderVersion: string | null; previewStartMs: number;
  masterAssetId: string; masterAsset: { checksumSha256: string | null; storageKey: string; visibility: string; mimeType: string } };

/** Called only after complete strict decoding. No old master or acquisition is modified. */
export function planDigitalMasterImport(input: { trackId: string; expectedVersion: number; latestMasterId: string | null; checksum: string;
  newAssetId: string; newStorageKey: string; encoderVersion: string; previewStartMs: number; duplicates: DigitalDuplicateMasterProof[] }) {
  if (!/^[a-f0-9]{64}$/.test(input.checksum) || input.encoderVersion !== DIGITAL_MP3_ENCODER_VERSION) throw new DigitalError("AUDIO_VALIDATION_REQUIRED", 409);
  if (!input.duplicates.length) return { revalidation: null };
  const previous = input.duplicates.find(master => master.id === input.latestMasterId);
  const coherentSource = (master: DigitalDuplicateMasterProof) => master.trackId === input.trackId && master.version >= 1 && master.version <= input.expectedVersion
    && master.status === "READY" && master.codec === "wav" && ["ffmpeg-libmp3lame-cbr-v1", DIGITAL_MP3_ENCODER_VERSION].includes(master.encoderVersion ?? "")
    && master.masterAsset.visibility === "PRIVATE" && master.masterAsset.mimeType === "audio/wav" && master.masterAsset.checksumSha256 === input.checksum
    && master.masterAssetId !== input.newAssetId && master.masterAsset.storageKey !== input.newStorageKey;
  if (!previous || input.duplicates.length > 100 || !input.duplicates.every(coherentSource)
    || new Set(input.duplicates.map(master => master.version)).size !== input.duplicates.length
    || new Set(input.duplicates.map(master => master.masterAssetId)).size !== input.duplicates.length
    || new Set(input.duplicates.map(master => master.masterAsset.storageKey)).size !== input.duplicates.length || previous.trackId !== input.trackId || previous.id !== input.latestMasterId
    || previous.version !== input.expectedVersion || previous.version < 1 || previous.status !== "READY" || previous.codec !== "wav"
    || previous.masterAsset.visibility !== "PRIVATE" || previous.masterAsset.mimeType !== "audio/wav"
    || previous.masterAsset.checksumSha256 !== input.checksum || previous.masterAssetId === input.newAssetId || previous.masterAsset.storageKey === input.newStorageKey) {
    throw new DigitalError("DUPLICATE_MASTER_REVIEW_REQUIRED", 409);
  }
  if (previous.encoderVersion === DIGITAL_MP3_ENCODER_VERSION) {
    if (!Number.isSafeInteger(input.previewStartMs) || input.previewStartMs < 0 || input.previewStartMs >= 30 * 60_000
      || !Number.isSafeInteger(previous.previewStartMs) || previous.previewStartMs < 0 || previous.previewStartMs === input.previewStartMs) throw new DigitalError("DUPLICATE_MASTER_REVIEW_REQUIRED", 409);
    return { revalidation: { kind: "ADDITIVE_EXCERPT_REVISION" as const, previousMasterId: previous.id, previousMasterVersion: previous.version,
      previousMasterAssetId: previous.masterAssetId, previousEncoderVersion: previous.encoderVersion, sourceChecksum: input.checksum,
      previousPreviewStartMs: previous.previewStartMs, previewStartMs: input.previewStartMs } };
  }
  // The historical v1 revalidation exception is unchanged: one exact current source only.
  if (input.duplicates.length !== 1) throw new DigitalError("DUPLICATE_MASTER_REVIEW_REQUIRED", 409);
  return { revalidation: { kind: "ADDITIVE_STRICT_REVALIDATION" as const, previousMasterId: previous.id, previousMasterVersion: previous.version,
    previousMasterAssetId: previous.masterAssetId, previousEncoderVersion: previous.encoderVersion, sourceChecksum: input.checksum } };
}
