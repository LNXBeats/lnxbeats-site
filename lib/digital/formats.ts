import { DigitalError } from "./domain";

export const DIGITAL_AUDIO_FORMATS = ["WAV", "MP3"] as const;
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
