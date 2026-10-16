import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { DigitalError, assertDigitalUuid } from "./domain";
import { DIGITAL_EXCERPT_EVENT, digitalExcerptBinding, digitalExcerptCandidateReady, digitalExcerptDetails, digitalExcerptHash,
  type DigitalExcerptEvent, type DigitalExcerptMaster } from "./excerpt-policy";

const blocked = () => new DigitalError("EXCERPT_ARTISTIC_VALIDATION_REQUIRED", 409);
type LatestMaster = { id: string; trackId: string };
type LatestEvent = DigitalExcerptEvent & { masterId: string };

/** New sales only. Never requalifies acquired downloads or writes approvals/media.
 * Constant-count batch reads/locks, including a fresh current-version check after
 * acquiring the same track/excerpt locks as the artistic workflow and ingestion.
 */
export async function assertDigitalExcerptApprovals(db: Prisma.TransactionClient, selected: DigitalExcerptMaster[]) {
  if (!selected.length) return;
  const masters = [...new Map(selected.map(master => [master.id, master])).values()].sort((a, b) => a.id.localeCompare(b.id));
  if (masters.length > 5000) throw blocked();
  masters.forEach(master => { assertDigitalUuid(master.id); assertDigitalUuid(master.trackId); });
  const ids = masters.map(master => master.id), trackIds = [...new Set(masters.map(master => master.trackId))].sort();
  // Stable group order: all track locks, then all excerpt locks. These transaction
  // locks are effective for checkout's transaction; public quotes remain advisory.
  await db.$queryRaw`/* dcn-excerpt-lock-tracks */ SELECT pg_advisory_xact_lock(hashtext(lock_key)) IS NULL AS locked
    FROM unnest(${trackIds.map(id => `digital-track:${id}`)}::text[]) WITH ORDINALITY AS keys(lock_key, ordinal) ORDER BY ordinal`;
  await db.$queryRaw`/* dcn-excerpt-lock-selections */ SELECT pg_advisory_xact_lock(hashtext(lock_key)) IS NULL AS locked
    FROM unnest(${ids.map(id => `digital-excerpt:${id}`)}::text[]) WITH ORDINALITY AS keys(lock_key, ordinal) ORDER BY ordinal`;
  const latest = await db.$queryRaw<LatestMaster[]>`/* dcn-excerpt-current-masters */
    SELECT DISTINCT ON ("trackId") id, "trackId" FROM digital_masters
    WHERE "trackId" = ANY(${trackIds}::uuid[]) ORDER BY "trackId", version DESC, id DESC`;
  const currentByTrack = new Map(latest.map(row => [row.trackId, row.id]));
  if (latest.length !== trackIds.length || masters.some(master => currentByTrack.get(master.trackId) !== master.id)) throw blocked();
  const fresh = await db.digitalMaster.findMany({ where: { id: { in: ids } }, include: { masterAsset: true, mp3Asset: true, previewAsset: true } });
  if (fresh.length !== ids.length) throw blocked();
  const expected = new Map(masters.map(master => [master.id, master]));
  const events = await db.$queryRaw<LatestEvent[]>`/* dcn-excerpt-latest-artistic-events */
    SELECT DISTINCT ON (details #>> '{binding,masterId}') id, "actorId", kind, details, "createdAt", details #>> '{binding,masterId}' AS "masterId"
    FROM digital_events WHERE kind = ${DIGITAL_EXCERPT_EVENT} AND details #>> '{binding,masterId}' = ANY(${ids}::text[])
    ORDER BY details #>> '{binding,masterId}', "createdAt" DESC, id DESC`;
  const byMaster = new Map(events.map(event => [event.masterId, event]));
  if (byMaster.size !== ids.length) throw blocked();
  const actorIds = [...new Set(events.flatMap(event => event.actorId ? [event.actorId] : []))];
  const reviewers = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, role: true, status: true, emailVerified: true } });
  const byActor = new Map(reviewers.map(actor => [actor.id, actor]));
  const prepared = fresh.map(master => {
    try {
      if (digitalExcerptHash(digitalExcerptBinding(master)) !== digitalExcerptHash(digitalExcerptBinding(expected.get(master.id)!))) throw blocked();
      const event = byMaster.get(master.id)!, actor = event.actorId ? byActor.get(event.actorId) : null;
      if (!actor || actor.role !== "ADMIN" || actor.status !== "ACTIVE" || actor.emailVerified !== true) throw blocked();
      const details = digitalExcerptDetails(event, master);
      // The validated audio must be the preview actually served for this edition,
      // not a different still-private candidate prepared for a future edit.
      if (details.status !== "VALIDATED" || details.startMs !== master.previewStartMs
        || details.candidateSha256 !== master.previewAsset?.checksumSha256 || details.previewDurationMs !== master.previewDurationMs) throw blocked();
      return { details, master };
    } catch { throw blocked(); }
  });
  const candidateIds = [...new Set(prepared.filter(entry => entry.details.candidateOrigin !== "EXISTING_PROVISIONAL")
    .map(entry => entry.details.candidateAssetId!))];
  const candidates = candidateIds.length ? await db.asset.findMany({ where: { id: { in: candidateIds } } }) : [];
  const byCandidate = new Map(candidates.map(asset => [asset.id, asset]));
  for (const { details } of prepared) if (details.candidateOrigin !== "EXISTING_PROVISIONAL") {
    const candidate = byCandidate.get(details.candidateAssetId!);
    if (!candidate || !digitalExcerptCandidateReady(candidate, details)) throw blocked();
  }
}
