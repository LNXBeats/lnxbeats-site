import { DigitalError } from "./domain";

export const STUDIO_CLIENT_ROLES = ["MP3", "WAV_CD", "WAV_24"] as const;
export type StudioClientRole = typeof STUDIO_CLIENT_ROLES[number];
export function studioClientRole(value: unknown): StudioClientRole {
  if (!STUDIO_CLIENT_ROLES.includes(value as StudioClientRole)) throw new DigitalError("FORMAT_NOT_ACQUIRED", 404);
  return value as StudioClientRole;
}

/** An approved audio candidate never grants commercial rights by itself. An
 * additive historical format requires both explicit consent and the exact source. */
export function studioAcquisitionAllowed(value: {
  acquiredMasterId: string; acquiredSha256: string | null; publishedMasterId: string | null;
  baseMasterId: string | null; sourceSha256: string | null; sourceLossy: boolean;
  allowExistingPurchases: boolean; technicalReady: boolean; humanApproved: boolean; rightsCleared: boolean;
}) {
  if (!value.technicalReady || !value.humanApproved || !value.rightsCleared || value.sourceLossy || !value.publishedMasterId) return false;
  if (value.acquiredMasterId === value.publishedMasterId) return true;
  return value.allowExistingPurchases === true && value.acquiredMasterId === value.baseMasterId
    && /^[a-f0-9]{64}$/.test(value.sourceSha256 ?? "") && value.sourceSha256 === value.acquiredSha256;
}

/** No normalization, suffix, truncation or quality claim. Unsafe titles fail
 * explicitly rather than silently changing the owner’s exact Unicode title. */
export function studioDownloadFilename(title: string, role: StudioClientRole) {
  if (!title || title.length > 240 || /[\u0000-\u001f\u007f/\\]/.test(title)) throw new DigitalError("STUDIO_UNSAFE_FILENAME", 409);
  return `${title}.${role === "MP3" ? "mp3" : "wav"}`;
}
export function studioAttachment(title: string, role: StudioClientRole) {
  const exact = studioDownloadFilename(title, role);
  const fallback = exact.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(exact).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
export function studioClientLabel(role: StudioClientRole, bitrateKbps: number | null, sampleRate: number | null) {
  if (role === "MP3") return bitrateKbps !== null && Number.isFinite(bitrateKbps) ? `MP3 — ${bitrateKbps} kbit/s` : "MP3 — débit non documenté";
  return role === "WAV_CD" ? "WAV — Qualité CD · 16 bits / 44,1 kHz" : `WAV — 24 bits${sampleRate ? ` / ${sampleRate / 1000} kHz` : ""}`;
}
