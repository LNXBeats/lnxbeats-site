import {
  digitalExcerptCandidateReady, digitalExcerptDetails,
  type DigitalExcerptEvent, type DigitalExcerptMaster,
} from "./excerpt-policy";

type Reviewer = { id: string; role: string; status: string; emailVerified: boolean };
type Candidate = Parameters<typeof digitalExcerptCandidateReady>[0];

/** Same exact-file proof for checkout and public catalogue projections. This
 * evaluates recorded facts; it never records a listen or an approval. */
export function digitalExcerptApprovalMatches(
  master: DigitalExcerptMaster,
  event: DigitalExcerptEvent | undefined,
  reviewer: Reviewer | undefined,
  candidates: ReadonlyMap<string, Candidate>,
) {
  try {
    if (!event || !reviewer || reviewer.id !== event.actorId || reviewer.role !== "ADMIN"
      || reviewer.status !== "ACTIVE" || reviewer.emailVerified !== true) return false;
    const details = digitalExcerptDetails(event, master);
    if (details.status !== "VALIDATED" || details.startMs !== master.previewStartMs
      || details.candidateSha256 !== master.previewAsset?.checksumSha256
      || details.previewDurationMs !== master.previewDurationMs) return false;
    if (details.candidateOrigin === "EXISTING_PROVISIONAL") return true;
    const candidate = details.candidateAssetId ? candidates.get(details.candidateAssetId) : undefined;
    return !!candidate && digitalExcerptCandidateReady(candidate, details);
  } catch { return false; }
}
