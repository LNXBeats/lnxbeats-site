import { createHash } from "node:crypto";
import { assertDigitalUuid, digitalUuid, DigitalError, previewWindow } from "./domain";
import { digitalCommercialAudioReady, type DigitalCommercialAudioProof } from "./formats";

export const DIGITAL_EXCERPT_EVENT = "EXCERPT_SELECTION_RECORDED";
export const DIGITAL_EXCERPT_POLICY = "dcn-private-excerpt-selection-v1";
export const DIGITAL_EXCERPT_STATUSES = ["DRAFT", "QUEUED", "READY", "VALIDATED", "FAILED"] as const;
export type DigitalExcerptStatus = "TO_LISTEN" | typeof DIGITAL_EXCERPT_STATUSES[number];
export type DigitalExcerptMaster = DigitalCommercialAudioProof & {
  id: string; trackId: string; version: number; masterAssetId: string; previewStartMs: number; previewAssetId?: string | null;
};
export type DigitalExcerptBinding = { masterId: string; trackId: string; version: number; sourceAssetId: string; sourceSha256: string; durationMs: number };
export type DigitalExcerptDetails = {
  policy: typeof DIGITAL_EXCERPT_POLICY; binding: DigitalExcerptBinding; status: Exclude<DigitalExcerptStatus, "TO_LISTEN">;
  startMs: number; candidateAssetId: string | null; candidateSha256: string | null; previewDurationMs: number | null;
  requestId: string | null; previousRevisionId: string | null; errorCode: string | null;
  attested: boolean; requestHash: string; recordHash: string;
  candidateOrigin?: "EXISTING_PROVISIONAL";
  provenance?: "OWNER_DECLARED" | "RECORDED_PLAYBACK";
  receiptId?: string | null;
};
export type DigitalExcerptEvent = { id: string; actorId: string | null; kind: string; details: unknown; createdAt: Date };
export type DigitalExcerptSelection = { revisionId: string | null; status: DigitalExcerptStatus; startMs: number; previewDurationMs: number | null; candidateUrl: string | null; errorCode: string | null };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
export function digitalExcerptHash(value: unknown) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function digitalExcerptBinding(master: DigitalExcerptMaster): DigitalExcerptBinding {
  if (!digitalCommercialAudioReady(master)) throw new DigitalError("EXCERPT_MASTER_UNAVAILABLE", 409);
  [master.id, master.trackId, master.masterAssetId].forEach(assertDigitalUuid);
  if (!Number.isSafeInteger(master.version) || master.version < 1) throw new DigitalError("EXCERPT_MASTER_UNAVAILABLE", 409);
  return { masterId: master.id, trackId: master.trackId, version: master.version, sourceAssetId: master.masterAssetId,
    sourceSha256: master.masterAsset.checksumSha256!, durationMs: master.masterAsset.durationMs! };
}
export type DigitalExcerptInput = { action: "save" | "generate" | "validate" | "validate-existing" | "validate-current" | "validate-prepared"; startMs: number; expectedRevisionId: string | null; idempotencyKey: string; attested: boolean; provenance?: "OWNER_DECLARED" | "RECORDED_PLAYBACK"; receiptId?: string | null };
export function digitalExcerptInput(value: unknown): DigitalExcerptInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DigitalError("INVALID_EXCERPT");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["action", "startMs", "expectedRevisionId", "idempotencyKey", "attested", "provenance", "receiptId"].includes(key))
    || !["save", "generate", "validate", "validate-existing", "validate-current", "validate-prepared"].includes(String(input.action)) || !Number.isSafeInteger(input.startMs) || Number(input.startMs) < 0
    || typeof input.attested !== "boolean") throw new DigitalError("INVALID_EXCERPT");
  assertDigitalUuid(input.idempotencyKey); if (input.expectedRevisionId !== null) assertDigitalUuid(input.expectedRevisionId);
  if (input.provenance !== undefined && !["OWNER_DECLARED", "RECORDED_PLAYBACK"].includes(String(input.provenance))) throw new DigitalError("INVALID_EXCERPT");
  if (input.provenance === "RECORDED_PLAYBACK") assertDigitalUuid(input.receiptId);
  if (input.provenance === "OWNER_DECLARED" && input.receiptId !== null) throw new DigitalError("INVALID_EXCERPT");
  if (["validate", "validate-existing", "validate-current", "validate-prepared"].includes(String(input.action)) && input.attested !== true) throw new DigitalError("EXCERPT_ATTESTATION_REQUIRED", 409);
  return input as DigitalExcerptInput;
}
export function digitalExcerptDetails(event: DigitalExcerptEvent, master: DigitalExcerptMaster): DigitalExcerptDetails {
  const raw = event.details;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DigitalError("EXCERPT_REVIEW_REQUIRED", 409);
  const d = raw as DigitalExcerptDetails, { recordHash, ...proof } = d;
  if (event.kind !== DIGITAL_EXCERPT_EVENT || !event.actorId || d.policy !== DIGITAL_EXCERPT_POLICY
    || !DIGITAL_EXCERPT_STATUSES.includes(d.status) || digitalExcerptHash(d.binding) !== digitalExcerptHash(digitalExcerptBinding(master))
    || recordHash !== digitalExcerptHash({ actorId: event.actorId, ...proof }) || !/^[a-f0-9]{64}$/.test(d.requestHash)
    || typeof d.attested !== "boolean") throw new DigitalError("EXCERPT_REVIEW_REQUIRED", 409);
  previewWindow(d.binding.durationMs, d.startMs);
  if (d.provenance !== undefined) {
    if (!["OWNER_DECLARED", "RECORDED_PLAYBACK"].includes(d.provenance)) throw new DigitalError("EXCERPT_REVIEW_REQUIRED", 409);
    if (d.provenance === "RECORDED_PLAYBACK") assertDigitalUuid(d.receiptId);
    if (d.provenance === "OWNER_DECLARED" && d.receiptId !== null) throw new DigitalError("EXCERPT_REVIEW_REQUIRED", 409);
  }
  if (["READY", "VALIDATED"].includes(d.status)) {
    assertDigitalUuid(d.candidateAssetId); if (!/^[a-f0-9]{64}$/.test(d.candidateSha256 ?? "") || !Number.isSafeInteger(d.previewDurationMs)
      || d.previewDurationMs! < 1 || d.previewDurationMs! > 60_000 || d.status === "VALIDATED" && !d.attested) throw new DigitalError("EXCERPT_REVIEW_REQUIRED", 409);
  } else if (d.candidateAssetId !== null || d.candidateSha256 !== null || d.previewDurationMs !== null) throw new DigitalError("EXCERPT_REVIEW_REQUIRED", 409);
  if (d.candidateOrigin !== undefined && (d.candidateOrigin !== "EXISTING_PROVISIONAL" || d.status !== "VALIDATED"
    || !digitalExistingExcerptReady(master, d))) throw new DigitalError("EXCERPT_REVIEW_REQUIRED", 409);
  if (d.requestId !== null) assertDigitalUuid(d.requestId);
  if (d.previousRevisionId !== null) assertDigitalUuid(d.previousRevisionId);
  if (d.status === "FAILED" ? !/^[A-Z0-9_]{1,80}$/.test(d.errorCode ?? "") : d.errorCode !== null) throw new DigitalError("EXCERPT_REVIEW_REQUIRED", 409);
  return d;
}
export function digitalExcerptSelection(master: DigitalExcerptMaster, event: DigitalExcerptEvent | null): DigitalExcerptSelection {
  const binding = digitalExcerptBinding(master);
  if (!event) return { revisionId: null, status: "TO_LISTEN", startMs: master.previewStartMs, previewDurationMs: master.previewDurationMs, candidateUrl: null, errorCode: null };
  const d = digitalExcerptDetails(event, master); previewWindow(binding.durationMs, d.startMs);
  return { revisionId: event.id, status: d.status, startMs: d.startMs, previewDurationMs: d.previewDurationMs,
    candidateUrl: d.candidateAssetId ? d.candidateOrigin === "EXISTING_PROVISIONAL" ? `/api/admin/digital/previews/${d.candidateAssetId}` : `/api/admin/digital/excerpt-candidates/${d.candidateAssetId}` : null, errorCode: d.errorCode };
}
export function assertDigitalExcerptRevision(selection: DigitalExcerptSelection, expectedRevisionId: string | null) {
  if (selection.revisionId !== expectedRevisionId) throw new DigitalError("EXCERPT_SELECTION_CHANGED", 409);
}
export function assertDigitalExcerptValidation(selection: DigitalExcerptSelection, input: DigitalExcerptInput) {
  if (input.action === "validate" && (selection.status !== "READY" || selection.startMs !== input.startMs || !selection.candidateUrl || !input.attested))
    throw new DigitalError("EXCERPT_NOT_READY", 409);
}
export function digitalExcerptCandidateReady(asset: { type: string; visibility: string; mimeType: string; sizeBytes: bigint | number; checksumSha256: string | null; durationMs: number | null }, details: DigitalExcerptDetails) {
  return asset.type === "AUDIO_PREVIEW" && asset.visibility === "PRIVATE" && asset.mimeType === "audio/mpeg"
    && Number.isSafeInteger(Number(asset.sizeBytes)) && Number(asset.sizeBytes) > 0 && Number(asset.sizeBytes) <= 3 * 1024 * 1024
    && asset.checksumSha256 === details.candidateSha256 && asset.durationMs === details.previewDurationMs
    && Number.isSafeInteger(asset.durationMs) && asset.durationMs! > 0 && asset.durationMs! <= 60_000;
}

/** A recovered provisional preview is eligible only for its exact current master; never an arbitrary PUBLIC asset. */
export function digitalExistingExcerptReady(master: DigitalExcerptMaster, details?: Pick<DigitalExcerptDetails, "candidateAssetId" | "candidateSha256" | "previewDurationMs" | "startMs">) {
  const asset = master.previewAsset as (NonNullable<DigitalExcerptMaster["previewAsset"]> & { id?: string; type?: string }) | null;
  return digitalUuid(master.previewAssetId) && !!asset && asset.id === master.previewAssetId && asset.type === "AUDIO_PREVIEW" && asset.visibility === "PUBLIC" && asset.mimeType === "audio/mpeg"
    && /^[a-f0-9]{64}$/.test(asset.checksumSha256 ?? "") && Number.isSafeInteger(Number(asset.sizeBytes)) && Number(asset.sizeBytes) > 0 && Number(asset.sizeBytes) <= 3 * 1024 * 1024
    && Number.isSafeInteger(master.previewDurationMs) && master.previewDurationMs! > 0 && master.previewDurationMs! <= 60_000 && asset.durationMs === master.previewDurationMs
    && (!details || details.candidateAssetId === master.previewAssetId && details.candidateSha256 === asset.checksumSha256
      && details.previewDurationMs === master.previewDurationMs && details.startMs === master.previewStartMs);
}
