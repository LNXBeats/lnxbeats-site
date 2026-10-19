import { assertDigitalUuid, DigitalError } from "./domain";
import { STUDIO_AUDIO_VERSION } from "./studio-audio-policy";
import { STUDIO_POLICY, studioHash } from "./studio-policy";

export type StudioExistingSourceInput = {
  masterId: string; expectedVersion: number; sourceAssetId: string; sourceSha256: string; expectedMetadataHash: string;
};
export type StudioExistingSourceSnapshot = {
  id: string; trackId: string; version: number; status: string; previewStartMs: number;
  title: string; album: string | null; metadata: unknown;
  source: { id: string; visibility: string; checksumSha256: string | null; mimeType: string; sizeBytes: bigint; filename: string };
};
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** Only explicit exact version/source bindings are accepted; titles and duration
 * are never used to infer an audio association. No default broad catalogue scan. */
export function studioExistingSourceInput(raw: unknown): StudioExistingSourceInput[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(key => key !== "sources")) throw new DigitalError("INVALID_STUDIO_SOURCE");
  const sources = (raw as Record<string, unknown>).sources;
  if (!Array.isArray(sources) || !sources.length || sources.length > 250) throw new DigitalError("INVALID_STUDIO_SOURCE");
  const checked = new Map<string, StudioExistingSourceInput>();
  for (const entry of sources) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).some(key => !["masterId", "expectedVersion", "sourceAssetId", "sourceSha256", "expectedMetadataHash"].includes(key))) throw new DigitalError("INVALID_STUDIO_SOURCE");
    const value = entry as Record<string, unknown>;
    assertDigitalUuid(value.masterId); assertDigitalUuid(value.sourceAssetId);
    if (!Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 1 || !sha(value.sourceSha256) || !sha(value.expectedMetadataHash)) throw new DigitalError("INVALID_STUDIO_SOURCE");
    const source: StudioExistingSourceInput = { masterId: value.masterId, expectedVersion: Number(value.expectedVersion), sourceAssetId: value.sourceAssetId,
      sourceSha256: value.sourceSha256, expectedMetadataHash: value.expectedMetadataHash };
    const previous = checked.get(source.masterId);
    if (previous && studioHash(previous) !== studioHash(source)) throw new DigitalError("STUDIO_SOURCE_CHANGED", 409);
    checked.set(source.masterId, source);
  }
  return [...checked.values()];
}

export function studioExistingMetadataHash(snapshot: Pick<StudioExistingSourceSnapshot, "title" | "album" | "metadata" | "previewStartMs">) {
  return studioHash({ title: snapshot.title, album: snapshot.album, metadata: snapshot.metadata, previewStartMs: snapshot.previewStartMs });
}

export function studioExistingPreparationKey(snapshot: StudioExistingSourceSnapshot) {
  assertDigitalUuid(snapshot.id); assertDigitalUuid(snapshot.trackId); assertDigitalUuid(snapshot.source.id);
  if (snapshot.status !== "READY" || !Number.isSafeInteger(snapshot.version) || snapshot.version < 1 || snapshot.source.visibility !== "PRIVATE"
    || !sha(snapshot.source.checksumSha256) || snapshot.source.sizeBytes < 12n || snapshot.source.sizeBytes > 512n * 1024n * 1024n
    || !Number.isSafeInteger(snapshot.previewStartMs) || snapshot.previewStartMs < 0
    || !((snapshot.source.mimeType === "audio/wav" && /\.wav$/i.test(snapshot.source.filename))
      || (snapshot.source.mimeType === "audio/mpeg" && /\.mp3$/i.test(snapshot.source.filename)))) throw new DigitalError("STUDIO_SOURCE_NOT_READY", 409);
  return studioHash({ policy: STUDIO_POLICY, processingVersion: STUDIO_AUDIO_VERSION, masterId: snapshot.id, version: snapshot.version,
    trackId: snapshot.trackId, sourceAssetId: snapshot.source.id, sourceSha256: snapshot.source.checksumSha256,
    sourceBytes: snapshot.source.sizeBytes, sourceMimeType: snapshot.source.mimeType, metadataHash: studioExistingMetadataHash(snapshot) });
}

export function assertStudioExistingSource(snapshot: StudioExistingSourceSnapshot, input: StudioExistingSourceInput) {
  const key = studioExistingPreparationKey(snapshot);
  if (snapshot.id !== input.masterId || snapshot.version !== input.expectedVersion || snapshot.source.id !== input.sourceAssetId
    || snapshot.source.checksumSha256 !== input.sourceSha256 || studioExistingMetadataHash(snapshot) !== input.expectedMetadataHash) throw new DigitalError("STUDIO_SOURCE_CHANGED", 409);
  return key;
}
