import { createHash } from "node:crypto";
import { DigitalError, assertDigitalUuid } from "./domain";
import { digitalCommercialAudioReady, type DigitalCommercialAudioProof } from "./formats";

export const DIGITAL_RIGHTS_REVIEW_POLICY = "DCN_MASTER_RIGHTS_REVIEW_V1_FR_METROPOLITAN";
export const DIGITAL_RIGHTS_REVIEW_EVENT = "DIGITAL_MASTER_RIGHTS_REVIEW";
export const DIGITAL_RIGHTS_REVIEW_STATUSES = ["DRAFT", "REVIEW_REQUIRED", "APPROVED", "REJECTED", "REVOKED"] as const;
export type DigitalRightsReviewStatus = (typeof DIGITAL_RIGHTS_REVIEW_STATUSES)[number];
export const DIGITAL_RIGHTS_ATTESTATION = "J’atteste avoir vérifié les droits et autorisations sur la composition, le master, les interprètes et collaborateurs, les samples et reprises éventuels, les extraits et la vente/téléchargement WAV/MP3 en France métropolitaine, Corse comprise, sans restriction incompatible.";
export type DigitalRightsMaster = DigitalCommercialAudioProof & { id: string; trackId: string; version: number; masterAssetId: string; mp3AssetId: string | null; previewAssetId: string | null;
  masterAsset: DigitalCommercialAudioProof["masterAsset"] & { id: string }; mp3Asset: (NonNullable<DigitalCommercialAudioProof["mp3Asset"]> & { id: string }) | null;
  previewAsset: (NonNullable<DigitalCommercialAudioProof["previewAsset"]> & { id: string }) | null };
export type DigitalRightsBinding = { masterId: string; trackId: string; version: number; wavAssetId: string; wavSha256: string; mp3AssetId: string; mp3Sha256: string; previewAssetId: string; previewSha256: string };
export type DigitalRightsReviewDetails = { policy: string; binding: DigitalRightsBinding; status: DigitalRightsReviewStatus; privateEvidenceReference: string | null;
  evidenceSha256: string | null; attestation: string | null; reason: string | null; reviewedAt: string; requestHash: string; recordHash: string };
export type DigitalRightsReviewEvent = { id: string; kind: string; actorId: string | null; details: unknown; createdAt: Date };
export type DigitalRightsReviewer = { id: string; role: string; status: string; emailVerified: boolean };
export type DigitalRightsReviewSummary = { masterId: string; status: DigitalRightsReviewStatus; reviewId: string | null; reviewedAt: string | null };

function canonical(value: unknown): unknown {
  return Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
}
export function digitalRightsReviewHash(value: unknown) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function digitalRightsMasterBinding(master: DigitalRightsMaster): DigitalRightsBinding {
  for (const id of [master.id, master.trackId, master.masterAssetId, master.mp3AssetId, master.previewAssetId]) assertDigitalUuid(id);
  if (!digitalCommercialAudioReady(master) || !Number.isSafeInteger(master.version) || master.version < 1
    || master.masterAsset.id !== master.masterAssetId || master.mp3Asset?.id !== master.mp3AssetId || master.previewAsset?.id !== master.previewAssetId)
    throw new DigitalError("RIGHTS_MASTER_NOT_READY", 409);
  return { masterId: master.id, trackId: master.trackId, version: master.version, wavAssetId: master.masterAssetId, wavSha256: master.masterAsset.checksumSha256!,
    mp3AssetId: master.mp3AssetId!, mp3Sha256: master.mp3Asset!.checksumSha256!, previewAssetId: master.previewAssetId!, previewSha256: master.previewAsset!.checksumSha256! };
}
export function digitalRightsEvidenceReference(value: unknown) {
  if (typeof value !== "string" || !/^private-evidence:[A-Za-z0-9][A-Za-z0-9._/-]{0,179}$/.test(value) || value.includes("..")) throw new DigitalError("INVALID_RIGHTS_EVIDENCE", 400);
  return value;
}
export function digitalRightsEvidenceSha(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new DigitalError("INVALID_RIGHTS_EVIDENCE", 400);
  return value;
}
/** A record hash is integrity bookkeeping, not a signature or automated legal approval. */
export function assessDigitalRightsReview(master: DigitalRightsMaster, event: DigitalRightsReviewEvent | null, reviewer: DigitalRightsReviewer | null): DigitalRightsReviewSummary {
  const missing: DigitalRightsReviewSummary = { masterId: master.id, status: "REVIEW_REQUIRED", reviewId: event?.id ?? null, reviewedAt: null };
  if (!event || event.kind !== DIGITAL_RIGHTS_REVIEW_EVENT || !event.actorId || !event.details || typeof event.details !== "object" || Array.isArray(event.details)) return missing;
  const details = event.details as DigitalRightsReviewDetails;
  if (!DIGITAL_RIGHTS_REVIEW_STATUSES.includes(details.status) || details.policy !== DIGITAL_RIGHTS_REVIEW_POLICY || !details.binding
    || !reviewer || reviewer.id !== event.actorId || reviewer.role !== "ADMIN" || reviewer.status !== "ACTIVE" || !reviewer.emailVerified) return missing;
  const { recordHash, ...proof } = details;
  try {
    const binding = digitalRightsMasterBinding(master);
    if (digitalRightsReviewHash(binding) !== digitalRightsReviewHash(details.binding) || !/^[a-f0-9]{64}$/.test(details.requestHash)
      || recordHash !== digitalRightsReviewHash({ actorId: event.actorId, ...proof }) || event.createdAt.toISOString() !== details.reviewedAt) return missing;
    if (details.status === "APPROVED" && (details.attestation !== DIGITAL_RIGHTS_ATTESTATION || !details.privateEvidenceReference || !details.evidenceSha256
      || digitalRightsEvidenceReference(details.privateEvidenceReference) !== details.privateEvidenceReference || digitalRightsEvidenceSha(details.evidenceSha256) !== details.evidenceSha256)) return missing;
    return { masterId: master.id, status: details.status, reviewId: event.id, reviewedAt: details.reviewedAt };
  } catch { return missing; }
}
