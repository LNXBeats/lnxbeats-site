import { DigitalError, assertDigitalUuid, digitalPrice } from "./domain";

export const EXPRESS_DEFAULTS = { trackPriceCents: 129, albumPriceCents: 990, artistName: "LNX Beats Studio" };
export type ExpressDefaults = typeof EXPRESS_DEFAULTS;
export type ExpressDraft = {
  projectId: string | null; expectedUpdatedAt: string | null; title: string; type: "SINGLE" | "ALBUM"; releaseDate?: string | null; membersPreviewEnabled?: boolean; hasCollaborations?: boolean;
  tracks: Array<{ id: string | null; title: string; priceCents: number; expectedOfferVersion: number }>;
  albumPriceCents: number; expectedAlbumOfferVersion: number; idempotencyKey: string;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DigitalError("EXPRESS_INVALID");
  return value as Record<string, unknown>;
}
function title(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 240 || /[\x00-\x1f]/.test(value)) throw new DigitalError("EXPRESS_INVALID");
  return value.trim();
}
function version(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new DigitalError("EXPRESS_INVALID");
  return Number(value);
}
/** Optional for old clients: absence preserves the existing date; null clears it explicitly. */
export function expressReleaseDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DigitalError("EXPRESS_INVALID");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new DigitalError("EXPRESS_INVALID");
  return value;
}
export function expressDefaults(value: unknown): ExpressDefaults {
  const v = object(value);
  if (Object.keys(v).some(k => !["trackPriceCents", "albumPriceCents", "artistName"].includes(k))) throw new DigitalError("EXPRESS_INVALID");
  return { trackPriceCents: digitalPrice(v.trackPriceCents as number), albumPriceCents: digitalPrice(v.albumPriceCents as number), artistName: title(v.artistName) };
}
export function expressDraft(value: unknown): ExpressDraft {
  const v = object(value);
  if (Object.keys(v).some(k => !["projectId", "expectedUpdatedAt", "title", "type", "releaseDate", "membersPreviewEnabled", "hasCollaborations", "tracks", "albumPriceCents", "expectedAlbumOfferVersion", "idempotencyKey"].includes(k))) throw new DigitalError("EXPRESS_INVALID");
  if (Object.hasOwn(v, "membersPreviewEnabled") && typeof v.membersPreviewEnabled !== "boolean") throw new DigitalError("EXPRESS_INVALID");
  if (Object.hasOwn(v, "hasCollaborations") && typeof v.hasCollaborations !== "boolean") throw new DigitalError("EXPRESS_INVALID");
  assertDigitalUuid(v.idempotencyKey);
  if (v.projectId !== null) assertDigitalUuid(v.projectId);
  if (v.projectId === null ? v.expectedUpdatedAt !== null : typeof v.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(v.expectedUpdatedAt))) throw new DigitalError("EXPRESS_INVALID");
  if (!["SINGLE", "ALBUM"].includes(String(v.type)) || !Array.isArray(v.tracks) || !v.tracks.length || v.tracks.length > 100 || v.type === "SINGLE" && v.tracks.length !== 1) throw new DigitalError("EXPRESS_INVALID");
  const tracks = v.tracks.map(item => {
    const t = object(item);
    if (Object.keys(t).some(k => !["id", "title", "priceCents", "expectedOfferVersion"].includes(k))) throw new DigitalError("EXPRESS_INVALID");
    if (t.id !== null) assertDigitalUuid(t.id);
    if (v.projectId === null && t.id !== null) throw new DigitalError("EXPRESS_INVALID");
    return { id: t.id as string | null, title: title(t.title), priceCents: digitalPrice(t.priceCents as number), expectedOfferVersion: version(t.expectedOfferVersion) };
  });
  const ids = tracks.flatMap(t => t.id ? [t.id] : []);
  if (new Set(ids).size !== ids.length) throw new DigitalError("EXPRESS_INVALID");
  return { projectId: v.projectId as string | null, expectedUpdatedAt: v.expectedUpdatedAt as string | null, title: title(v.title), type: v.type as ExpressDraft["type"],
    ...(Object.hasOwn(v, "releaseDate") ? { releaseDate: expressReleaseDate(v.releaseDate) } : {}),
    ...(Object.hasOwn(v, "membersPreviewEnabled") ? { membersPreviewEnabled: v.membersPreviewEnabled as boolean } : {}), tracks,
    ...(Object.hasOwn(v, "hasCollaborations") ? { hasCollaborations: v.hasCollaborations as boolean } : {}),
    albumPriceCents: digitalPrice(v.albumPriceCents as number), expectedAlbumOfferVersion: version(v.expectedAlbumOfferVersion), idempotencyKey: v.idempotencyKey as string };
}
export function expressName(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr").replace(/\.(wav|mp3)$/i, "").replace(/^\s*\d+[\s._-]+/, "").replace(/[^\p{L}\p{N}]/gu, "");
}
/** Only a unique normalized title is proposed; the user must still confirm it. */
export function suggestExpressTrack(filename: string, tracks: Array<{ id: string; title: string }>) {
  const matches = tracks.filter(t => expressName(t.title) === expressName(filename));
  return matches.length === 1 ? matches[0].id : null;
}
/** Track storage is integral seconds; exact milliseconds remain on the versioned asset. */
export function expressDurationSeconds(milliseconds: number) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 30 * 60_000) throw new DigitalError("AUDIO_DURATION_LIMIT");
  return Math.round(milliseconds / 1000);
}
