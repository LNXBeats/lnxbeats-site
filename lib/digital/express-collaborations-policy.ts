import { parseHttpsUrl, parsePlatform, requiredText, optionalText } from "@/lib/catalog/validation";
import { isEtsyCatalogUrl } from "@/lib/catalog/public-link-policy";
import { assertDigitalUuid, DigitalError } from "./domain";

export const collaborationArtistRoles = ["ARTIST", "FEATURING"] as const;
export const collaborationPlatforms = { spotify: "SPOTIFY", appleMusic: "APPLE_MUSIC", deezer: "DEEZER", youtube: "YOUTUBE", amazonMusic: "AMAZON_MUSIC", distroKid: "DISTROKID", other: "OTHER" } as const;
type Base = { projectId: string; expectedUpdatedAt: string; idempotencyKey: string; id: string | null };
export type CollaborationMutation = Base & ({ operation: "credit"; trackId: string | null; name: string; role: "ARTIST" | "FEATURING" } | { operation: "link"; platform: keyof typeof collaborationPlatforms; scope: "ARTIST" | "RELEASE" | "STORE"; url: string; label: string | null });

/** Artistic display metadata only. Author/composer/producer roles and all rights
 * decisions are deliberately outside this small collaboration editor. */
export function expressCollaborationInput(raw: unknown): CollaborationMutation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DigitalError("EXPRESS_INVALID");
  const v = raw as Record<string, unknown>;
  const keys = v.operation === "credit" ? ["trackId", "name", "role"] : v.operation === "link" ? ["platform", "scope", "url", "label"] : [];
  if (!keys.length || Object.keys(v).some(k => !["operation", "projectId", "expectedUpdatedAt", "idempotencyKey", "id", ...keys].includes(k))) throw new DigitalError("EXPRESS_INVALID");
  assertDigitalUuid(v.projectId); assertDigitalUuid(v.idempotencyKey);
  if (v.id !== null) assertDigitalUuid(v.id);
  if (typeof v.expectedUpdatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.expectedUpdatedAt) || !Number.isFinite(Date.parse(v.expectedUpdatedAt))) throw new DigitalError("EXPRESS_INVALID");
  const base = { projectId: v.projectId, expectedUpdatedAt: v.expectedUpdatedAt, idempotencyKey: v.idempotencyKey, id: v.id as string | null };
  try {
    if (v.operation === "credit") {
      if (v.trackId !== null) assertDigitalUuid(v.trackId);
      if (v.role !== "ARTIST" && v.role !== "FEATURING") throw new DigitalError("EXPRESS_INVALID");
      return { ...base, operation: "credit", trackId: v.trackId as string | null, name: requiredText(v.name, "Le nom d’artiste", 180), role: v.role };
    }
    const platform = parsePlatform(v.platform);
    if (!["ARTIST", "RELEASE", "STORE"].includes(String(v.scope))) throw new DigitalError("EXPRESS_INVALID");
    const url = parseHttpsUrl(v.url, platform);
    if (isEtsyCatalogUrl(url)) throw new DigitalError("EXPRESS_INVALID");
    return { ...base, operation: "link", platform, scope: v.scope as "ARTIST" | "RELEASE" | "STORE", url, label: optionalText(v.label, "Le libellé", 180) };
  } catch (error) { if (error instanceof DigitalError) throw error; throw new DigitalError("EXPRESS_INVALID"); }
}

export function expressCollaborationEditable(project: { status: string; publicVisible: boolean; digitalOffers: readonly { active: boolean }[] }) {
  return project.status === "DRAFT" && !project.publicVisible && !project.digitalOffers.some(o => o.active);
}
