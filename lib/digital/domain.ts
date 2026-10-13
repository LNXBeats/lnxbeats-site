export class DigitalError extends Error {
  constructor(readonly code: string, readonly status = 400, readonly publicDetails?:{ownedTitles:string[]}) { super(code); this.name = "DigitalError"; }
}
export const DIGITAL_PREVIEW_LIMIT_MS = 60_000;
export const DIGITAL_MASTER_LIMIT_BYTES = 512 * 1024 * 1024;
export const DIGITAL_TERMS_VERSION = "DCN-1.0-LOCAL-REVIEW";
export const DIGITAL_TERMS_TEXT = "Licence personnelle d'écoute et de téléchargement. Aucune cession de droits d'exploitation. Conditions de test uniquement, à valider avant LIVE.";
export const DIGITAL_EARLY_DELIVERY_TEXT = "Je demande expressément la fourniture immédiate du contenu numérique.";
export const DIGITAL_WITHDRAWAL_TEXT = "Je reconnais la perte du droit de rétractation après confirmation sur support durable et commencement de la fourniture.";
export const digitalUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function assertDigitalUuid(v: unknown): asserts v is string { if (!digitalUuid(v)) throw new DigitalError("INVALID_ID"); }
export function digitalPrice(v: unknown) {
  if (!Number.isSafeInteger(v) || Number(v) < 1 || Number(v) > 100_000) throw new DigitalError("INVALID_PRICE");
  return Number(v);
}
export function parseEuroCents(v: unknown) {
  if (typeof v !== "string" || !/^(?:0|[1-9]\d{0,3})(?:[.,]\d{1,2})?$/.test(v.trim())) throw new DigitalError("INVALID_PRICE");
  const [a, b = ""] = v.trim().replace(",", ".").split(".");
  return digitalPrice(Number(a) * 100 + Number(b.padEnd(2, "0")));
}
export function previewWindow(durationMs: number, startMs: number, requestedMs = DIGITAL_PREVIEW_LIMIT_MS) {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || !Number.isSafeInteger(startMs) || startMs < 0 || startMs >= durationMs
    || !Number.isSafeInteger(requestedMs) || requestedMs < 1 || requestedMs > DIGITAL_PREVIEW_LIMIT_MS) throw new DigitalError("INVALID_EXCERPT");
  // Leave room for MP3 frame padding; the output file itself must be <= 60 s.
  return { startMs, durationMs: Math.min(durationMs - startMs, requestedMs, 59_900) };
}
export type DigitalSelection = { id: string; scope: string; title: string; priceCents: number; version: number;
  tracks: Array<{ trackId: string; masterId: string; title: string; position: number }> };
export function normalizeDigitalCart(selected: DigitalSelection[], ownedTracks: Set<string>) {
  if (selected.length > 50) throw new DigitalError("CART_TOO_LARGE");
  const unique = [...new Map(selected.map(s => [s.id, s])).values()];
  const albums = unique.filter(s => s.scope === "ALBUM");
  const covered = new Set(albums.flatMap(s => s.tracks.map(t => t.trackId)));
  const removed: string[] = [];
  const lines = unique.filter(s => {
    digitalPrice(s.priceCents);
    if (!s.tracks.length) throw new DigitalError("NO_MASTER", 409);
    if (s.scope === "TRACK" && covered.has(s.tracks[0].trackId)) { removed.push(s.id); return false; }
    if (s.tracks.some(t => ownedTracks.has(t.trackId))) throw new DigitalError(s.scope === "ALBUM" ? "ALBUM_PARTIALLY_OWNED" : "ALREADY_OWNED", 409,{ownedTitles:s.tracks.filter(t=>ownedTracks.has(t.trackId)).map(t=>t.title)});
    return true;
  });
  const seen = new Set<string>();
  for (const line of lines) for (const track of line.tracks) {
    if (seen.has(track.trackId)) throw new DigitalError("OVERLAPPING_ALBUMS", 409);
    seen.add(track.trackId);
  }
  const totalCents = lines.reduce((sum, s) => sum + s.priceCents, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents > 500_000) throw new DigitalError("INVALID_TOTAL");
  return { lines, totalCents, removed };
}
export function digitalEnabled(env: Record<string, string | undefined> = process.env) {
  return env.DCN_ENABLED === "true" && env.DCN_MODE === "TEST"
    && !/production/i.test(env.RAILWAY_ENVIRONMENT_NAME ?? "")
    && env.MEDIA_DEPLOYMENT_ENV !== "production" && env.PAYMENT_DEPLOYMENT_ENV !== "production";
}
export function requireDigitalEnvironment(env: Record<string, string | undefined> = process.env) {
  if (!digitalEnabled(env) || env.DCN_MODE !== "TEST" || /production/i.test(env.RAILWAY_ENVIRONMENT_NAME ?? "")
    || env.MEDIA_DEPLOYMENT_ENV === "production" || env.PAYMENT_DEPLOYMENT_ENV === "production") throw new DigitalError("DIGITAL_CLOSED", 503);
  return "TEST" as const;
}
export function checkoutProviderUrl(v: string, provider: string) {
  let u: URL; try { u = new URL(v); } catch { throw new DigitalError("INVALID_PROVIDER_URL", 503); }
  const host = provider === "STRIPE" ? "checkout.stripe.com" : "www.sandbox.paypal.com";
  if (u.protocol !== "https:" || u.hostname !== host || u.port || u.username || u.password) throw new DigitalError("INVALID_PROVIDER_URL", 503);
  return v;
}
export function uploadMetadata(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new DigitalError("INVALID_UPLOAD");
  const v = input as Record<string, unknown>;
  if (Object.keys(v).some(k => !["filename", "mimeType", "sizeBytes", "expectedVersion", "previewStartMs", "replaceConfirmed"].includes(k))) throw new DigitalError("INVALID_UPLOAD");
  if (typeof v.filename !== "string" || v.filename.length > 255 || /[\r\n\\/]/.test(v.filename)) throw new DigitalError("INVALID_UPLOAD");
  const extension = v.filename.split(".").pop()!.toLowerCase();
  const mimes: Record<string, string[]> = { wav: ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "application/octet-stream", ""], mp3: ["audio/mpeg", "audio/mp3", "application/octet-stream", ""], flac: ["audio/flac", "audio/x-flac", "application/octet-stream", ""] };
  if (!mimes[extension]?.includes(String(v.mimeType ?? "")) || !Number.isSafeInteger(v.sizeBytes) || Number(v.sizeBytes) < 12 || Number(v.sizeBytes) > DIGITAL_MASTER_LIMIT_BYTES) throw new DigitalError("INVALID_UPLOAD");
  if (!Number.isSafeInteger(v.expectedVersion) || Number(v.expectedVersion) < 0 || !Number.isSafeInteger(v.previewStartMs) || Number(v.previewStartMs) < 0) throw new DigitalError("INVALID_UPLOAD");
  if (Number(v.expectedVersion) > 0 && v.replaceConfirmed !== true) throw new DigitalError("REPLACEMENT_CONFIRMATION_REQUIRED", 409);
  return { filename: v.filename, extension, mimeType: extension === "wav" ? "audio/wav" : extension === "mp3" ? "audio/mpeg" : "audio/flac",
    sizeBytes: Number(v.sizeBytes), expectedVersion: Number(v.expectedVersion), previewStartMs: Number(v.previewStartMs) };
}
export function signatureMatches(bytes: Uint8Array, extension: string) {
  const b = Buffer.from(bytes);
  if (extension === "wav") return b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE";
  if (extension === "flac") return b.toString("ascii", 0, 4) === "fLaC";
  return extension === "mp3" && (b.toString("ascii", 0, 3) === "ID3" || b.length > 1 && b[0] === 255 && (b[1] & 224) === 224);
}
export type DigitalPaymentEvidence = { eventId: string; orderId: string; provider: "STRIPE" | "PAYPAL"; mode: "TEST";
  providerReference: string; paymentReference: string; merchantId: string; amountCents: number; currency: string;
  status: "PAID" | "PENDING" | "FAILED"; authenticated: boolean };
export function assertPaymentEvidence(e: DigitalPaymentEvidence, expected: { id: string; totalCents: number; mode: string }, attempt: { provider: string; providerReference: string | null }, merchant: string) {
  if (e.authenticated !== true || e.mode !== "TEST" || expected.mode !== e.mode || e.orderId !== expected.id || e.provider !== attempt.provider
    || !attempt.providerReference || e.providerReference !== attempt.providerReference || (e.status === "PAID" && !e.paymentReference) || e.merchantId !== merchant || !merchant
    || e.amountCents !== expected.totalCents || e.currency !== "EUR" || !e.eventId) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
}
export function csvCell(v: unknown) { let s = String(v ?? ""); if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replaceAll('"', '""')}"`; }
