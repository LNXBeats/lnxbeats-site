import { DigitalError } from "./domain";
import { DIGITAL_MP3_ENCODER_VERSION } from "./formats";

export type DigitalDuplicateMasterProof = { id: string; trackId: string; version: number; status: string; codec: string; encoderVersion: string | null;
  masterAssetId: string; masterAsset: { checksumSha256: string | null; storageKey: string; visibility: string; mimeType: string } };

/** Called only after complete strict decoding. No old master or acquisition is modified. */
export function planDigitalMasterImport(input: { trackId: string; expectedVersion: number; latestMasterId: string | null; checksum: string;
  newAssetId: string; newStorageKey: string; encoderVersion: string; duplicates: DigitalDuplicateMasterProof[] }) {
  if (!/^[a-f0-9]{64}$/.test(input.checksum) || input.encoderVersion !== DIGITAL_MP3_ENCODER_VERSION) throw new DigitalError("AUDIO_VALIDATION_REQUIRED", 409);
  if (!input.duplicates.length) return { revalidation: null };
  const previous = input.duplicates[0]!;
  if (input.duplicates.length !== 1 || previous.trackId !== input.trackId || previous.id !== input.latestMasterId
    || previous.version !== input.expectedVersion || previous.version < 1 || previous.status !== "READY" || previous.codec !== "wav"
    || previous.encoderVersion !== "ffmpeg-libmp3lame-cbr-v1" || previous.masterAsset.visibility !== "PRIVATE" || previous.masterAsset.mimeType !== "audio/wav"
    || previous.masterAsset.checksumSha256 !== input.checksum || previous.masterAssetId === input.newAssetId || previous.masterAsset.storageKey === input.newStorageKey) {
    throw new DigitalError("DUPLICATE_MASTER_REVIEW_REQUIRED", 409);
  }
  return { revalidation: { kind: "ADDITIVE_STRICT_REVALIDATION" as const, previousMasterId: previous.id, previousMasterVersion: previous.version,
    previousMasterAssetId: previous.masterAssetId, previousEncoderVersion: previous.encoderVersion, sourceChecksum: input.checksum } };
}
