import { digitalRightsReviewHash } from "./rights-review-policy";
export const ANNOUNCEMENT_EVENT = "DISCOGRAPHY_ANNOUNCEMENT_PREPARED";
export const ANNOUNCEMENT_POLICY = "DCN_HISTORICAL_PUBLIC_METADATA_ONLY_V1";
export type AnnouncementBinding = { projectId: string; slug: string; title: string; coverId: string | null; coverSha256: string | null; editorialHash: string; creditsHash: string; tracksHash: string };
export function announcementAllowed(binding: AnnouncementBinding, details: unknown) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return false;
  const d = details as Record<string, unknown>, { recordHash, ...record } = d;
  return d.policy === ANNOUNCEMENT_POLICY && d.metadataOnly === true && d.saleApproved === false
    && d.historicalPublicVisible === true && d.historicalStatus === "PUBLISHED" && /^[a-f0-9]{40}$/.test(String(d.sourceSHA))
    && /^[a-f0-9]{64}$/.test(String(d.sourceSnapshotSha256)) && digitalRightsReviewHash(d.binding) === digitalRightsReviewHash(binding)
    && recordHash === digitalRightsReviewHash(record);
}
