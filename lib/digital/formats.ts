import { DigitalError } from "./domain";
import { isAuthorizedMp3OnlySource, MP3_ONLY_SOURCE, MP3_ONLY_SOURCE_POLICY } from "./mp3-only-policy";

export const DIGITAL_AUDIO_FORMATS = ["WAV", "MP3"] as const;
export const DIGITAL_MP3_ENCODER_VERSION = "ffmpeg-libmp3lame-cbr-v2-strict";
type CommercialAudioAsset = { visibility: string; mimeType: string | null; checksumSha256: string | null; durationMs: number | null; sizeBytes: bigint | number | null };
export type DigitalCommercialAudioProof = { trackId?: string; status: string; codec: string | null; encoderVersion: string | null; mp3BitrateKbps: number | null; mp3AssetId?: string | null; previewDurationMs: number | null;
  masterAsset: CommercialAudioAsset; mp3Asset: CommercialAudioAsset | null; previewAsset: CommercialAudioAsset | null };
/** New sales require the strict ingestion proof; this does not rewrite or revoke existing acquisitions. */
export function digitalCommercialAudioReady(master: DigitalCommercialAudioProof) {
  const wav = master.masterAsset, mp3 = master.mp3Asset, preview = master.previewAsset;
  const asset = (value: CommercialAudioAsset | null, visibility: "PRIVATE" | "PUBLIC", mime: string, limit: number) => !!value
    && value.visibility === visibility && value.mimeType === mime && /^[a-f0-9]{64}$/.test(value.checksumSha256 ?? "")
    && Number.isSafeInteger(value.durationMs) && value.durationMs! > 0 && value.durationMs! <= 30 * 60000
    && value.sizeBytes !== null && Number.isSafeInteger(Number(value.sizeBytes)) && Number(value.sizeBytes) >= (mime === "audio/wav" ? 44 : 4) && Number(value.sizeBytes) < limit;
  if (master.codec === "mp3") return master.status === "READY" && isAuthorizedMp3OnlySource(master.trackId, wav)
    && master.mp3AssetId === null && master.mp3Asset === null && master.mp3BitrateKbps === null && master.encoderVersion === null
    && asset(wav, "PRIVATE", "audio/mpeg", 96 * 1024 * 1024) && asset(preview, "PUBLIC", "audio/mpeg", 3 * 1024 * 1024 + 1)
    && Number.isSafeInteger(master.previewDurationMs) && master.previewDurationMs! > 0 && master.previewDurationMs! <= 60000
    && preview!.durationMs === master.previewDurationMs && preview!.durationMs! <= wav.durationMs! + 100;
  return master.status === "READY" && master.codec === "wav" && master.encoderVersion === DIGITAL_MP3_ENCODER_VERSION
    && [192, 256, 320].includes(master.mp3BitrateKbps ?? 0) && asset(wav, "PRIVATE", "audio/wav", 512 * 1024 * 1024 + 1)
    && asset(mp3, "PRIVATE", "audio/mpeg", 96 * 1024 * 1024) && asset(preview, "PUBLIC", "audio/mpeg", 3 * 1024 * 1024 + 1)
    && Math.abs(wav.durationMs! - mp3!.durationMs!) <= 100 && Number.isSafeInteger(master.previewDurationMs)
    && master.previewDurationMs! > 0 && master.previewDurationMs! <= 60000 && preview!.durationMs === master.previewDurationMs;
}
export type DigitalAudioFormat = (typeof DIGITAL_AUDIO_FORMATS)[number];
export type DigitalAcquiredTrack = {
  trackId: string; masterId: string; title: string; position: number;
  formats?: DigitalAudioFormat[];
  wavAssetId?: string;
  mp3AssetId?: string;
  sourceSha256?: string;
  sourceFormat?: "MP3_LOSSY";
  formatPolicy?: string;
};

/** This explicit, frozen exception does not turn arbitrary MP3 drafts into saleable masters. */
export function isDigitalMp3OnlyTrack(track: DigitalAcquiredTrack) {
  return Array.isArray(track.formats) && track.formats.length === 1 && track.formats[0] === "MP3"
    && track.trackId === MP3_ONLY_SOURCE.trackId && track.formatPolicy === MP3_ONLY_SOURCE_POLICY
    && track.sourceFormat === "MP3_LOSSY" && track.sourceSha256 === MP3_ONLY_SOURCE.sourceSha256
    && track.wavAssetId === undefined && typeof track.mp3AssetId === "string"
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(track.mp3AssetId);
}

/** Old snapshots are not rewritten or granted an unpurchased format implicitly. */
export function acquiredDigitalFormats(track: DigitalAcquiredTrack): readonly DigitalAudioFormat[] {
  if (track.formats === undefined) {
    if(track.formatPolicy!==undefined||track.sourceFormat!==undefined||track.sourceSha256!==undefined)throw new DigitalError("ACQUIRED_FORMAT_INTEGRITY",409);
    return ["WAV"];
  }
  if (isDigitalMp3OnlyTrack(track)) return ["MP3"];
  if(track.formatPolicy!==undefined||track.sourceFormat!==undefined||track.sourceSha256!==undefined)throw new DigitalError("ACQUIRED_FORMAT_INTEGRITY",409);
  if (!Array.isArray(track.formats) || track.formats.length !== 2 || track.formats[0] !== "WAV" || track.formats[1] !== "MP3"
    || !track.wavAssetId || !track.mp3AssetId || track.wavAssetId === track.mp3AssetId) throw new DigitalError("ACQUIRED_FORMAT_INTEGRITY", 409);
  return DIGITAL_AUDIO_FORMATS;
}

export function digitalAudioFormat(value: unknown): DigitalAudioFormat {
  if (value !== "WAV" && value !== "MP3") throw new DigitalError("INVALID_DOWNLOAD_FORMAT");
  return value;
}

/** The asset identity is frozen in the order, never derived from a current offer. */
export function acquiredDigitalAssetId(track: DigitalAcquiredTrack, format: DigitalAudioFormat, master: { masterAssetId: string; mp3AssetId: string | null; codec?: string | null }) {
  if (!acquiredDigitalFormats(track).includes(format)) throw new DigitalError("FORMAT_NOT_ACQUIRED", 409);
  if (isDigitalMp3OnlyTrack(track)) {
    if (master.codec !== "mp3" || master.mp3AssetId !== null || track.mp3AssetId !== master.masterAssetId) throw new DigitalError("ACQUIRED_FORMAT_INTEGRITY", 409);
    return master.masterAssetId;
  }
  if(master.codec==="mp3")throw new DigitalError("ACQUIRED_FORMAT_INTEGRITY",409);
  const id = format === "WAV" ? track.wavAssetId ?? master.masterAssetId : track.mp3AssetId;
  if (!id || id !== (format === "WAV" ? master.masterAssetId : master.mp3AssetId)) throw new DigitalError("ACQUIRED_FORMAT_INTEGRITY", 409);
  return id;
}

type AcquiredAsset = { id: string; visibility: string; mimeType: string | null; checksumSha256: string | null; sizeBytes: bigint | number | null };
/** One resolver for individual downloads and ZIPs; MP3-only never falls back to an arbitrary source. */
export function acquiredDigitalAsset<T extends AcquiredAsset>(track: DigitalAcquiredTrack, format: DigitalAudioFormat,
  master: { masterAssetId: string; mp3AssetId: string | null; codec?: string | null; masterAsset: T; mp3Asset: T | null }): T {
  const id = acquiredDigitalAssetId(track, format, master);
  const asset = isDigitalMp3OnlyTrack(track) || format === "WAV" ? master.masterAsset : master.mp3Asset;
  if (!asset || asset.id !== id || asset.visibility !== "PRIVATE"
    || isDigitalMp3OnlyTrack(track) && (asset.mimeType !== "audio/mpeg" || !isAuthorizedMp3OnlySource(track.trackId, asset)))
    throw new DigitalError("ACQUIRED_FORMAT_INTEGRITY", 409);
  return asset;
}

export function acquiredAlbumFormats(tracks: DigitalAcquiredTrack[]): DigitalAudioFormat[] {
  if (!tracks.length) throw new DigitalError("ARCHIVE_INTEGRITY", 409);
  return DIGITAL_AUDIO_FORMATS.filter(format => tracks.every(track => acquiredDigitalFormats(track).includes(format)));
}
