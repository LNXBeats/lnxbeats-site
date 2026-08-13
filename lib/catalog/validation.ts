import type { CreditRole, DataConfidence, PlatformId, ProjectJukeboxPlacement, ProjectKind, ProjectStatus, TrackStatus } from "@/lib/catalog/types";

export class CatalogValidationError extends Error {
  constructor(message: string, readonly code = "INVALID_CATALOG_INPUT") {
    super(message);
    this.name = "CatalogValidationError";
  }
}

export function requiredText(value: unknown, label: string, max: number) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!text || text.length > max) throw new CatalogValidationError(`${label} doit contenir entre 1 et ${max} caractères.`);
  return text;
}

export function optionalText(value: unknown, label: string, max: number) {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > max) throw new CatalogValidationError(`${label} ne peut pas dépasser ${max} caractères.`);
  return text;
}

export function boundedInteger(value: unknown, label: string, minimum: number, maximum: number, nullable = false) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new CatalogValidationError(`${label} doit être un entier entre ${minimum} et ${maximum}.`);
  }
  return number;
}

export function parseDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new CatalogValidationError("La date est invalide.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new CatalogValidationError("La date est invalide.");
  return date;
}

function enumeration<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new CatalogValidationError(`${label} est invalide.`);
  return value as T;
}

export const parseProjectType = (value: unknown) => enumeration<ProjectKind>(value, ["album", "single", "project"], "Le type");
export const parseProjectStatus = (value: unknown) => enumeration<ProjectStatus>(value, ["published", "in-development", "draft", "archive"], "Le statut");
export const parseTrackStatus = (value: unknown) => enumeration<TrackStatus>(value, ["released", "announced", "unlisted"], "Le statut de piste");
export const parseJukeboxPlacement = (value: unknown) => enumeration<ProjectJukeboxPlacement | "none">(value, ["published", "development", "none"], "Le placement jukebox");
export const parseCreditRole = (value: unknown) => enumeration<CreditRole | "engineer">(value, ["artist", "writer", "composer", "producer", "featuring", "engineer", "other"], "Le rôle du crédit");
export const parseConfidence = (value: unknown) => enumeration<DataConfidence>(value, ["confirmed", "partial", "placeholder", "unknown"], "Le niveau de confiance");
export const parsePlatform = (value: unknown) => enumeration<PlatformId>(value, ["spotify", "appleMusic", "deezer", "youtube", "amazonMusic", "distroKid", "other"], "La plateforme");

export function parseHttpsUrl(value: unknown, platform: PlatformId) {
  const raw = requiredText(value, "L’URL", 2_000);
  let url: URL;
  try { url = new URL(raw); } catch { throw new CatalogValidationError("L’URL est invalide."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new CatalogValidationError("Seules les URL HTTPS publiques sont acceptées.");
  const host = url.hostname.toLowerCase();
  const allowed: Partial<Record<PlatformId, readonly string[]>> = {
    spotify: ["open.spotify.com"], appleMusic: ["music.apple.com"],
    deezer: ["deezer.com", "www.deezer.com", "link.deezer.com"],
    youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
    amazonMusic: ["music.amazon.fr", "music.amazon.com"],
    distroKid: ["distrokid.com", "direct.distrokid.com"],
  };
  if (allowed[platform] && !allowed[platform]?.includes(host)) throw new CatalogValidationError("Le domaine ne correspond pas à la plateforme choisie.");
  return url.toString();
}
