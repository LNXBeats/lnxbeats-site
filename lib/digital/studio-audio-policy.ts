/** Pure, versioned audio decisions. No rights, offer or catalogue mutation lives here. */
export const STUDIO_AUDIO_VERSION = "lnx-studio-conservative-2";
export const STUDIO_FORMATS = ["MP3", "WAV_CD", "WAV_24"] as const;
export type StudioFormat = typeof STUDIO_FORMATS[number];
export type StudioProgress = "ANALYZING" | "MASTERING" | "CONVERTING" | "VERIFYING" | "READY_TO_LISTEN";
export const STUDIO_DISABLED_MODULES = Object.freeze([
  "click_repair", "declip", "denoise", "hum_removal", "eq", "deesser", "compression", "limiter", "microfade",
  "multiband", "saturation", "exciter", "spatialization", "haas", "reverb", "gate", "tempo", "pitch",
]);
/** Attenuation only. The indicative -14 LUFS is never a normalization target. */
export function studioGainPlan(integratedLufs: number | null, truePeakDbtp: number | null, options: { preserveCompliantMp3?: boolean } = {}) {
  if (integratedLufs === null || truePeakDbtp === null) return { gainDb: 0, targetDbtp: null, ceilingDbtp: null, measurable: false };
  if (!Number.isFinite(integratedLufs) || !Number.isFinite(truePeakDbtp)) throw new Error("STUDIO_INVALID_MEASUREMENT");
  const louder = integratedLufs > -14, targetDbtp = louder ? -2.2 : -1.2, ceilingDbtp = louder ? -2 : -1;
  // Reaching an indicative target is not a reason to re-encode an already safe
  // stereo MP3. Its immutable encoded audio can be remuxed when under the hard
  // ceiling; final exports are still independently measured and checked.
  const gainDb = options.preserveCompliantMp3 && truePeakDbtp <= ceilingDbtp ? 0 : Math.min(0, Math.floor((targetDbtp - truePeakDbtp) * 1000) / 1000);
  return { gainDb, targetDbtp, ceilingDbtp, measurable: true };
}
/** An unsafe filename is rejected, never silently renamed or transliterated. */
export function studioDownloadName(title: string, format: StudioFormat) {
  if (!title || title.length > 500 || /[\u0000-\u001f\u007f/\\]/.test(title) || title === "." || title === "..") throw new Error("STUDIO_INVALID_TITLE");
  return `${title}.${format === "MP3" ? "mp3" : "wav"}`;
}
export function studioOfficialTags(title: string, album?: string, preserved: Record<string, string> = {}) {
  studioDownloadName(title, "MP3");
  if (album !== undefined && (!album || album.length > 500 || /[\u0000-\u001f\u007f]/.test(album))) throw new Error("STUDIO_INVALID_ALBUM");
  const tags = { ...preserved, title, artist: "LNX Beats", album_artist: "LNX Beats", studio: "LNX Beats Studio", production_studio: "LNX Beats Studio", comment: "Création LNX Beats Studio" };
  // An old embedded album is not evidence of the actual catalogue association.
  delete (tags as Record<string, string>).album;
  if (album !== undefined) (tags as Record<string, string>).album = album;
  return tags as Record<string, string>;
}
