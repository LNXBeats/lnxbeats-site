import { digitalCommercialAudioReady } from "./formats";
import { digitalExistingExcerptReady, type DigitalExcerptMaster, type DigitalExcerptSelection } from "./excerpt-policy";

/** Eligibility only: reading this projection never records a listening decision.
 * The final, explicit owner confirmation may reuse the existing append-only
 * artistic workflow for the exact provisional excerpt at zero. A draft/candidate
 * chosen elsewhere, an unreadable proof or a restriction remains a blocker. */
export function expressArtisticAtPublication(master: DigitalExcerptMaster | null | undefined,
  selection: DigitalExcerptSelection | null, rights: { reviewStatus?: string | null; assetRights?: readonly string[] } = {}) {
  return !!master && selection?.status === "TO_LISTEN" && selection.revisionId === null
    && master.previewStartMs === 0 && selection.startMs === 0 && selection.previewDurationMs === master.previewDurationMs
    && !["REJECTED", "REVOKED"].includes(rights.reviewStatus ?? "") && !rights.assetRights?.includes("RESTRICTED")
    && digitalCommercialAudioReady(master) && digitalExistingExcerptReady(master);
}
