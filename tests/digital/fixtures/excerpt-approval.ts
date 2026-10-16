import { randomUUID } from "node:crypto";
import { DIGITAL_EXCERPT_EVENT, DIGITAL_EXCERPT_POLICY, digitalExcerptBinding, digitalExcerptHash,
  type DigitalExcerptDetails, type DigitalExcerptEvent, type DigitalExcerptMaster } from "@/lib/digital/excerpt-policy";

/** Explicit synthetic approval for repository-double tests ONLY. Never called by
 * a seed, application workflow or real database; this is not a human attestation.
 */
export function syntheticExistingExcerptApproval(master: DigitalExcerptMaster, actorId: string, at = new Date("2026-10-16T10:00:00.000Z")) {
  const details: Omit<DigitalExcerptDetails, "recordHash"> = { policy: DIGITAL_EXCERPT_POLICY, binding: digitalExcerptBinding(master),
    status: "VALIDATED", startMs: master.previewStartMs, candidateAssetId: master.previewAssetId!, candidateSha256: master.previewAsset!.checksumSha256,
    previewDurationMs: master.previewDurationMs, requestId: null, previousRevisionId: null, errorCode: null,
    attested: true, requestHash: "c".repeat(64), candidateOrigin: "EXISTING_PROVISIONAL" };
  return { id: randomUUID(), actorId, kind: DIGITAL_EXCERPT_EVENT, createdAt: at,
    details: { ...details, recordHash: digitalExcerptHash({ actorId, ...details }) }, masterId: master.id } satisfies DigitalExcerptEvent & { masterId: string };
}
