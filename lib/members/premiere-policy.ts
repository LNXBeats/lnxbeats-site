import { createHash } from "node:crypto";
import { isPrivateStudioStorageKey } from "@/lib/media/storage/policy";

export const MEMBER_PREMIERE_EVENT = "MUSIC_EXPRESS_PREMIERE_PUBLISHED";
type PreviewBinding = { id: string; checksumSha256: string | null; storageKey: string };
export type PremiereBindingProject = {
  id: string; slug: string; title: string; type: string; releaseDate: Date | null; membersPreviewEnabled: boolean;
  assets: Array<{ asset: { id: string; checksumSha256: string | null } }>;
  tracks: Array<{ id: string; position: number; title: string; digitalMasters: Array<{ id: string; version: number; masterAssetId: string; masterAsset: { checksumSha256: string | null }; previewAsset: PreviewBinding | null }> }>;
};
export function memberPremiereBinding(project: PremiereBindingProject) {
  const cover = project.assets[0]?.asset;
  return createHash("sha256").update(JSON.stringify({ policy: "member-premieres-v1", id: project.id, slug: project.slug, title: project.title, type: project.type,
    releaseDate: project.releaseDate?.toISOString().slice(0, 10) ?? null, enabled: project.membersPreviewEnabled,
    cover: cover ? [cover.id, cover.checksumSha256] : null,
    tracks: [...project.tracks].sort((a,b) => a.position-b.position || a.id.localeCompare(b.id)).map(track => {
      const master = track.digitalMasters[0];
      return [track.id, track.position, track.title, master ? [master.id, master.version, master.masterAssetId, master.masterAsset.checksumSha256,
        master.previewAsset ? [master.previewAsset.id,master.previewAsset.checksumSha256,master.previewAsset.storageKey] : null] : null];
    }) })).digest("hex");
}
export function premiereFutureDate(releaseDate: Date | null, now = new Date()) {
  if (!releaseDate || !Number.isFinite(releaseDate.getTime()) || !Number.isFinite(now.getTime())) return false;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return releaseDate.toISOString().slice(0,10) > today;
}
export function premiereMemberAllowed(actor: { status?: string; emailVerified?: boolean; role?: string } | null | undefined) {
  return !!actor && actor.status === "ACTIVE" && actor.emailVerified === true && ["MEMBER", "CUSTOMER", "ADMIN"].includes(actor.role ?? "");
}
export function privatePremiereExcerpt(asset: { type: string; storageKey: string; mimeType: string; durationMs: number | null; sizeBytes: bigint; checksumSha256: string | null } | null) {
  return !!asset && asset.type === "AUDIO_PREVIEW" && isPrivateStudioStorageKey(asset.storageKey) && asset.storageKey.toLowerCase().endsWith(".mp3") && asset.mimeType === "audio/mpeg" && asset.durationMs !== null && Number.isSafeInteger(asset.durationMs)
    && asset.durationMs > 0 && asset.durationMs <= 60000 && asset.sizeBytes > 0n && asset.sizeBytes <= 3n * 1024n * 1024n && /^[a-f0-9]{64}$/.test(asset.checksumSha256 ?? "");
}
