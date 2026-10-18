import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { assertDigitalUuid, DigitalError } from "./domain";
import { digitalRightsReviewHash } from "./rights-review-policy";
export const GROUP_ORIGINAL_DECLARATION = "DCN_ORIGINALS_OWNER_DECLARATION_V1";
export const GROUP_LISTEN_RECEIPT = "MUSIC_REVIEW_LISTENING_RECEIPT";
export function requiresParticularRightsCase(roles: string[], assetRights: string[], reviewStatuses: string[]) {
  return roles.includes("FEATURING") || assetRights.includes("RESTRICTED") || reviewStatuses.some(s => s === "REJECTED" || s === "REVOKED");
}
export type OriginalFacts = { authors: string; composers: string; masterOwner: string; performers: string; toolsLicenses: string; evidenceReferences: string;
  originalControlled: true; noCollaborationSampleCover: true; noIncompatibleRestriction: true };
export function originalFacts(value: unknown): OriginalFacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DigitalError("GROUP_ORIGINAL_EVIDENCE_REQUIRED", 409);
  const v = reviewObject(value), fields = ["authors", "composers", "masterOwner", "performers", "toolsLicenses", "evidenceReferences"];
  if (Object.keys(v).some(k => ![...fields, "originalControlled", "noCollaborationSampleCover", "noIncompatibleRestriction"].includes(k))
    || fields.some(k => typeof v[k] !== "string" || String(v[k]).trim().length < 2 || String(v[k]).trim().length > 1200 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(String(v[k])))
    || v.originalControlled !== true || v.noCollaborationSampleCover !== true || v.noIncompatibleRestriction !== true) throw new DigitalError("GROUP_ORIGINAL_EVIDENCE_REQUIRED", 409);
  return { ...Object.fromEntries(fields.map(k => [k, String(v[k]).trim()])), originalControlled: true, noCollaborationSampleCover: true, noIncompatibleRestriction: true } as OriginalFacts;
}
export function reviewObject(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new DigitalError("INVALID_GROUP_REVIEW"); return value as Record<string, unknown>; }
export function reviewMasterIds(value: unknown) { if (!Array.isArray(value) || !value.length || value.length > 100 || new Set(value).size !== value.length) throw new DigitalError("INVALID_GROUP_REVIEW"); value.forEach(assertDigitalUuid); return (value as string[]).slice().sort(); }
export function reviewAttested(value: unknown) { if (value !== true) throw new DigitalError("GROUP_ATTESTATION_REQUIRED", 409); }
export function listeningCoverage(ranges: unknown, durationMs: number) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 60_000 || !Array.isArray(ranges) || !ranges.length || ranges.length > 120) throw new DigitalError("GROUP_LISTENING_INCOMPLETE", 409);
  const valid = ranges.map(r => { if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite) || r[0] < 0 || r[1] <= r[0] || r[1] > durationMs + 100) throw new DigitalError("GROUP_LISTENING_INCOMPLETE", 409); return [Math.round(r[0]), Math.min(durationMs, Math.round(r[1]))]; }).sort((a, b) => a[0] - b[0]);
  let total = 0, start = valid[0][0], end = valid[0][1];
  for (const r of valid.slice(1)) { if (r[0] <= end) end = Math.max(end, r[1]); else { total += end - start; [start, end] = r; } } total += end - start;
  if (total < durationMs * .99) throw new DigitalError("GROUP_LISTENING_INCOMPLETE", 409);
  return total;
}
type ListeningTicket = { actorId: string; masterId: string; bindingHash: string; startedAt: number; nonce: string };
function key(secret: string | undefined) { if (!secret || secret.length < 32) throw new DigitalError("GROUP_REVIEW_UNAVAILABLE", 503); return secret; }
export function issueListeningTicket(actorId: string, masterId: string, bindingHash: string, secret: string | undefined, now = Date.now()) {
  [actorId, masterId].forEach(assertDigitalUuid); if (!/^[a-f0-9]{64}$/.test(bindingHash)) throw new DigitalError("INVALID_GROUP_REVIEW");
  const data: ListeningTicket = { actorId, masterId, bindingHash, startedAt: now, nonce: randomUUID() }, body = Buffer.from(JSON.stringify(data)).toString("base64url");
  return body + "." + createHmac("sha256", key(secret)).update(body).digest("base64url");
}
export function verifyListeningTicket(ticket: unknown, actorId: string, masterId: string, bindingHash: string, durationMs: number, secret: string | undefined, now = Date.now()): ListeningTicket {
  if (typeof ticket !== "string" || ticket.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket)) throw new DigitalError("GROUP_LISTENING_INCOMPLETE", 409);
  const [body, signature] = ticket.split("."), expected = createHmac("sha256", key(secret)).update(body).digest(), actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new DigitalError("GROUP_LISTENING_INCOMPLETE", 409);
  let d: ListeningTicket; try { d = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { throw new DigitalError("GROUP_LISTENING_INCOMPLETE", 409); }
  if (!d || typeof d !== "object" || Array.isArray(d) || Object.keys(d).some(k => !["actorId", "masterId", "bindingHash", "startedAt", "nonce"].includes(k))) throw new DigitalError("GROUP_LISTENING_INCOMPLETE", 409);
  if (d.actorId !== actorId || d.masterId !== masterId || d.bindingHash !== bindingHash || !Number.isSafeInteger(d.startedAt) || d.startedAt > now || now - d.startedAt > 2 * 3600_000
    || now - d.startedAt < durationMs * .9) throw new DigitalError("GROUP_LISTENING_INCOMPLETE", 409);
  assertDigitalUuid(d.nonce); return d;
}
export function listeningReceiptValid(details: unknown, actorId: string, masterId: string, bindingHash: string) {
  try { const d = reviewObject(details), { recordHash, ...record } = d; return d.actorId === actorId && d.masterId === masterId && d.bindingHash === bindingHash
    && d.kind === GROUP_LISTEN_RECEIPT && d.browserReportedCoverage === true && Number.isSafeInteger(d.durationMs) && Number(d.durationMs) >= 1 && Number(d.durationMs) <= 60_000
    && Number.isSafeInteger(d.coverageMs) && Number(d.coverageMs) <= Number(d.durationMs) && Number(d.coverageMs) >= Number(d.durationMs) * .99
    && recordHash === digitalRightsReviewHash(record); } catch { return false; }
}
