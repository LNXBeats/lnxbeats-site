import { DigitalError } from "./domain";

export const DIGITAL_AUDIO_FORMATS = ["WAV", "MP3"] as const;
export const DIGITAL_MP3_ENCODER_VERSION = "ffmpeg-libmp3lame-cbr-v2-strict";
type CommercialAudioAsset = { visibility: string; mimeType: string | null; checksumSha256: string | null; durationMs: number | null; sizeBytes: bigint | number | null };
export type DigitalCommercialAudioProof = { status: string; codec: string | null; encoderVersion: string | null; mp3BitrateKbps: number | null; previewDurationMs: number | null;
  masterAsset: CommercialAudioAsset; mp3Asset: CommercialAudioAsset | null; previewAsset: CommercialAudioAsset | null };
/** New sales require the strict ingestion proof; this does not rewrite or revoke existing acquisitions. */
export function digitalCommercialAudioReady(master: DigitalCommercialAudioProof) {
  const wav = master.masterAsset, mp3 = master.mp3Asset, preview = master.previewAsset;
  const asset = (value: CommercialAudioAsset | null, visibility: "PRIVATE" | "PUBLIC", mime: string, limit: number) => !!value
    && value.visibility === visibility && value.mimeType === mime && /^[a-f0-9]{64}$/.test(value.checksumSha256 ?? "")
    && Number.isSafeInteger(value.durationMs) && value.durationMs! > 0 && value.durationMs! <= 30 * 60000
    && value.sizeBytes !== null && Number.isSafeInteger(Number(value.sizeBytes)) && Number(value.sizeBytes) >= (mime === "audio/wav" ? 44 : 4) && Number(value.sizeBytes) < limit;
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
};

/** Old snapshots are not rewritten or granted an unpurchased format implicitly. */
export function acquiredDigitalFormats(track: DigitalAcquiredTrack): readonly DigitalAudioFormat[] {
  if (track.formats === undefined) return ["WAV"];
  if (!Array.isArray(track.formats) || track.formats.length !== 2 || track.formats[0] !== "WAV" || track.formats[1] !== "MP3"
    || !track.wavAssetId || !track.mp3AssetId || track.wavAssetId === track.mp3AssetId) throw new DigitalError("ACQUIRED_FORMAT_INTEGRITY", 409);
  return DIGITAL_AUDIO_FORMATS;
}

export function digitalAudioFormat(value: unknown): DigitalAudioFormat {
  if (value !== "WAV" && value !== "MP3") throw new DigitalError("INVALID_DOWNLOAD_FORMAT");
  return value;
}

/** The asset identity is frozen in the order, never derived from a current offer. */
export function acquiredDigitalAssetId(track: DigitalAcquiredTrack, format: DigitalAudioFormat, master: { masterAssetId: string; mp3AssetId: string | null }) {
  if (!acquiredDigitalFormats(track).includes(format)) throw new DigitalError("FORMAT_NOT_ACQUIRED", 409);
  const id = format === "WAV" ? track.wavAssetId ?? master.masterAssetId : track.mp3AssetId;
  if (!id || id !== (format === "WAV" ? master.masterAssetId : master.mp3AssetId)) throw new DigitalError("ACQUIRED_FORMAT_INTEGRITY", 409);
  return id;
}

export function acquiredAlbumFormats(tracks: DigitalAcquiredTrack[]): DigitalAudioFormat[] {
  if (!tracks.length) throw new DigitalError("ARCHIVE_INTEGRITY", 409);
  return DIGITAL_AUDIO_FORMATS.filter(format => tracks.every(track => acquiredDigitalFormats(track).includes(format)));
}
