import { createHash } from "node:crypto";
import { DigitalError, type DigitalSelection } from "./domain";
import { acquiredDigitalFormats } from "./formats";
import { MP3_ONLY_SOURCE, MP3_ONLY_SOURCE_POLICY } from "./mp3-only-policy";

/** Prospective, immutable exception approved by the owner for this exact source.
 * It changes neither the historic CGV text/hash nor any artistic/IP approval. */
const text = "Pour le titre « Lentement », dans la version MP3 expressément indiquée dans le récapitulatif de commande, le téléchargement comprend uniquement le fichier MP3 fourni par LNX Beats. Aucun fichier WAV n’est inclus ni promis pour cet article. Le MP3 est un format compressé avec perte : aucune qualité supérieure au fichier fourni, ni aucun encodage à 320 kbit/s, n’est garanti. Cette disposition particulière prévaut, pour cet article uniquement, sur les mentions générales des CGV annonçant WAV et MP3. Les formats des autres articles demeurent ceux indiqués avant leur achat. Le prix est celui du récapitulatif, sans supplément de format. Les autres conditions, garanties légales, consentements, droits de rétractation et règles d’usage privé des CGV restent inchangés.";
export const DIGITAL_MP3_ONLY_FORMAT_SUPPLEMENT = Object.freeze({
  version: "dcn-lentement-mp3-only-20261019-v1",
  title: "Complément de formats — Lentement : MP3 uniquement",
  text,
  hashSha256: createHash("sha256").update(text, "utf8").digest("hex"),
});
type Track = DigitalSelection["tracks"][number];
type Binding = Pick<Track, "trackId" | "masterId" | "mp3AssetId" | "sourceSha256" | "sourceFormat" | "formatPolicy">;
export type DigitalFormatSupplementSnapshot = typeof DIGITAL_MP3_ONLY_FORMAT_SUPPLEMENT & {
  expresslyAccepted: true; acceptedAt: string; tracks: Binding[]; snapshotHashSha256: string;
};
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, canonical(value)])) : v;
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
function bindings(tracks: Track[]): Binding[] {
  return tracks.filter(t => acquiredDigitalFormats(t).length === 1 && acquiredDigitalFormats(t)[0] === "MP3").map(t => {
    if (t.trackId !== MP3_ONLY_SOURCE.trackId || t.sourceSha256 !== MP3_ONLY_SOURCE.sourceSha256 || t.formatPolicy !== MP3_ONLY_SOURCE_POLICY
      || t.sourceFormat !== "MP3_LOSSY" || !/^[a-f0-9-]{36}$/i.test(t.masterId) || !t.mp3AssetId || !/^[a-f0-9-]{36}$/i.test(t.mp3AssetId)) throw new DigitalError("FORMAT_SUPPLEMENT_REQUIRES_REVIEW", 409);
    return { trackId: t.trackId, masterId: t.masterId, mp3AssetId: t.mp3AssetId, sourceSha256: t.sourceSha256, sourceFormat: t.sourceFormat, formatPolicy: t.formatPolicy };
  }).sort((a, b) => a.trackId.localeCompare(b.trackId) || a.masterId.localeCompare(b.masterId));
}
export function requiredDigitalFormatSupplement(tracks: Track[]) {
  const selected = bindings(tracks);
  if (!selected.length) return null;
  if (selected.length !== 1) throw new DigitalError("FORMAT_SUPPLEMENT_REQUIRES_REVIEW", 409);
  return DIGITAL_MP3_ONLY_FORMAT_SUPPLEMENT;
}
export function digitalFormatSupplementSnapshot(tracks: Track[], acceptedAt: Date, acceptedHash?: string) {
  const required = requiredDigitalFormatSupplement(tracks);
  if (!required) {
    if (acceptedHash !== undefined) throw new DigitalError("FORMAT_SUPPLEMENT_NOT_APPLICABLE", 409);
    return null;
  }
  if (acceptedHash !== required.hashSha256 || !Number.isFinite(acceptedAt.getTime())) throw new DigitalError("FORMAT_SUPPLEMENT_ACCEPTANCE_REQUIRED", 409);
  const body = { ...required, expresslyAccepted: true as const, acceptedAt: acceptedAt.toISOString(), tracks: bindings(tracks) };
  return { ...body, snapshotHashSha256: digest(body) };
}
export function validateSavedDigitalFormatSupplement(value: unknown): value is DigitalFormatSupplementSnapshot {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const s = value as DigitalFormatSupplementSnapshot;
    if (!Array.isArray(s.tracks) || s.tracks.length !== 1 || s.expresslyAccepted !== true || typeof s.acceptedAt !== "string"
      || !Number.isFinite(Date.parse(s.acceptedAt)) || new Date(s.acceptedAt).toISOString() !== s.acceptedAt) return false;
    const tracks = s.tracks.map(t => ({ ...t, title: MP3_ONLY_SOURCE.title, position: 1, formats: ["MP3"] as ["MP3"] }));
    const expected = digitalFormatSupplementSnapshot(tracks, new Date(s.acceptedAt), DIGITAL_MP3_ONLY_FORMAT_SUPPLEMENT.hashSha256);
    return digest(value) === digest(expected);
  } catch { return false; }
}
/** First delivery/payment reconciliation uses the frozen lines, not today's offer. */
export function assertDigitalOrderFormatSupplement(contract: unknown, lines: ReadonlyArray<{ trackSnapshot: unknown }>) {
  const tracks = lines.flatMap(l => Array.isArray(l.trackSnapshot) ? l.trackSnapshot as Track[] : []);
  const required = requiredDigitalFormatSupplement(tracks);
  const c = contract && typeof contract === "object" && !Array.isArray(contract) ? contract as { acceptedAt?: unknown; formatSupplement?: unknown } : null;
  if (!required) {
    if (c?.formatSupplement != null) throw new DigitalError("FORMAT_SUPPLEMENT_REQUIRES_REVIEW", 409);
    return;
  }
  if (!c || !validateSavedDigitalFormatSupplement(c.formatSupplement) || c.formatSupplement.acceptedAt !== c.acceptedAt
    || digest(c.formatSupplement.tracks) !== digest(bindings(tracks))) throw new DigitalError("FORMAT_SUPPLEMENT_REQUIRES_REVIEW", 409);
}
