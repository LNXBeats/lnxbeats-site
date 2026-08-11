import type { PlatformId, ProjectPlatform } from "@/lib/catalog/types";

export type PlatformScope = ProjectPlatform["scope"];

const platformNames: Record<PlatformId, string> = {
  spotify: "Spotify",
  appleMusic: "Apple Music",
  deezer: "Deezer",
  youtube: "YouTube",
  amazonMusic: "Amazon Music",
  distroKid: "DistroKid",
  other: "le lien officiel",
};

export function platformName(platform: PlatformId) {
  return platformNames[platform];
}

export function automaticPlatformLabel(platform: PlatformId, scope: PlatformScope) {
  const name = platformName(platform);
  if (scope === "artist") return platform === "other" ? "Profil officiel LNX Beats" : `LNX Beats sur ${name}`;
  if (scope === "store") return platform === "other" ? "Ouvrir la boutique" : `Ouvrir sur ${name}`;
  if (platform === "youtube") return "Voir sur YouTube";
  if (["spotify", "appleMusic", "deezer", "amazonMusic"].includes(platform)) return `Écouter sur ${name}`;
  return platform === "other" ? "Ouvrir le lien officiel" : `Voir sur ${name}`;
}

function normalizedAutomaticLabels(platform: PlatformId, scope: PlatformScope) {
  const name = platformName(platform);
  return new Set([
    automaticPlatformLabel(platform, scope),
    scope === "artist" ? `Suivre LNX Beats sur ${name}` : `Écouter le titre sur ${name}`,
  ]);
}

export function platformLabelOverride(label: string | null | undefined, platform: PlatformId, scope: PlatformScope) {
  const trimmed = label?.trim() || null;
  if (!trimmed || normalizedAutomaticLabels(platform, scope).has(trimmed)) return null;
  return trimmed;
}

export function resolvePlatformLabel(label: string | null | undefined, platform: PlatformId, scope: PlatformScope) {
  return platformLabelOverride(label, platform, scope) ?? automaticPlatformLabel(platform, scope);
}
