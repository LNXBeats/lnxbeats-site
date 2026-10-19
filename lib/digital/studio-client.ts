import "server-only";
import { prisma } from "@/lib/prisma";
import { catalogAudioResponse } from "@/lib/catalog/audio-response";
import { DigitalError, assertDigitalUuid } from "./domain";
import { studioBinding, studioAcquiredAccessEnabled, requireStudioAcquiredAccess } from "./studio-policy";
import { studioAcquisitionAllowed, studioAttachment, studioClientLabel, studioClientRole, STUDIO_CLIENT_ROLES } from "./studio-client-policy";
import { loadDigitalRightsReviews } from "./rights-review-service";

export type StudioCustomerFormat = { jobId: string; role: "MP3" | "WAV_CD" | "WAV_24"; label: string; sourceLossy: boolean };

/** Read-only, additive projection. No current offer lookup, contract rewrite,
 * replacement of an acquired asset, ticket widening or payment API call. */
export async function studioFormatsForMasters(masterIds: string[]): Promise<Map<string, StudioCustomerFormat[]>> {
  const result = new Map<string, StudioCustomerFormat[]>();
  if (!studioAcquiredAccessEnabled() || !masterIds.length) return result;
  const ids = [...new Set(masterIds)];
  const jobs = await prisma.digitalStudioJob.findMany({ where: { status: "READY", decision: "APPROVED", sourceLossy: false,
    OR: [{ publishedMasterId: { in: ids } }, { baseMasterId: { in: ids }, allowExistingPurchases: true }] },
    include: { artifacts: { include: { asset: true } } }, orderBy: { createdAt: "desc" }, take: 500 });
  const acquired = await prisma.digitalMaster.findMany({ where: { id: { in: ids } }, select: { id: true, trackId: true, masterAsset: { select: { checksumSha256: true } } } });
  const published = await prisma.digitalMaster.findMany({ where: { id: { in: jobs.flatMap(j => j.publishedMasterId ? [j.publishedMasterId] : []) } },
    include: { masterAsset: true, mp3Asset: true, previewAsset: true } });
  const reviewed = await loadDigitalRightsReviews(prisma, published);
  for (const job of jobs) {
    if (!job.binding || studioBinding(job, job.artifacts) !== job.binding) continue;
    const master = published.find(m => m.id === job.publishedMasterId);
    const rightsCleared = master?.status === "READY" && master.masterAsset.rightsStatus === "CLEARED"
      && master.mp3Asset?.rightsStatus === "CLEARED" && master.previewAsset?.rightsStatus === "CLEARED"
      && reviewed.some(review => review.masterId === master.id && review.status === "APPROVED");
    if (STUDIO_CLIENT_ROLES.some(role => !job.artifacts.some(a => a.role === role && a.metadataVerified && a.asset.visibility === "PRIVATE"
      && /^[a-f0-9]{64}$/.test(a.asset.checksumSha256 ?? "")))) continue;
    for (const owner of acquired) {
      if (result.has(owner.id) || owner.trackId !== job.trackId || !studioAcquisitionAllowed({ acquiredMasterId: owner.id,
        acquiredSha256: owner.masterAsset.checksumSha256, publishedMasterId: job.publishedMasterId, baseMasterId: job.baseMasterId,
        sourceSha256: job.sourceSha256, sourceLossy: job.sourceLossy, allowExistingPurchases: job.allowExistingPurchases,
        technicalReady: job.status === "READY", humanApproved: job.decision === "APPROVED", rightsCleared: !!rightsCleared })) continue;
      result.set(owner.id, STUDIO_CLIENT_ROLES.map(role => { const file = job.artifacts.find(a => a.role === role)!;
        return { jobId: job.id, role, label: studioClientLabel(role, file.bitrateKbps, file.sampleRate), sourceLossy: job.sourceLossy }; }));
    }
  }
  return result;
}

export async function studioCustomerDownload(request: Request, userId: string, jobId: string, rawRole: unknown, head = false) {
  requireStudioAcquiredAccess(); assertDigitalUuid(jobId); assertDigitalUuid(userId);
  const url = new URL(request.url), lineId = url.searchParams.get("lineId"), masterId = url.searchParams.get("masterId");
  assertDigitalUuid(lineId); assertDigitalUuid(masterId); const role = studioClientRole(rawRole);
  if (!await prisma.user.findFirst({ where: { id: userId, status: "ACTIVE", emailVerified: true } })) throw new DigitalError("NOT_FOUND", 404);
  // Reuse the existing active-entitlement/order/receipt authorization, including
  // partial refunds and revocation. An album line grants only its acquired tracks.
  const { ownedDigitalLine } = await import("./library");
  const line = await ownedDigitalLine(userId, lineId);
  const entitlement = line.entitlements.find(e => e.masterId === masterId);
  const frozen = (line.trackSnapshot as Array<{ masterId: string; title: string }>).find(t => t.masterId === masterId);
  if (!entitlement || !frozen) throw new DigitalError("NOT_FOUND", 404);
  const choices = (await studioFormatsForMasters([masterId])).get(masterId);
  if (!choices?.some(f => f.jobId === jobId && f.role === role)) throw new DigitalError("FORMAT_NOT_ACQUIRED", 404);
  const artifact = await prisma.digitalStudioArtifact.findUnique({ where: { jobId_role: { jobId, role } }, include: { asset: true } });
  if (!artifact || artifact.asset.visibility !== "PRIVATE" || !artifact.metadataVerified) throw new DigitalError("NOT_FOUND", 404);
  const response = await catalogAudioResponse(request, artifact.asset, "private, no-store", head);
  response.headers.set("Content-Disposition", studioAttachment(frozen.title, role));
  response.headers.set("X-Robots-Tag", "noindex, nofollow"); response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (response.ok) await prisma.digitalEvent.create({ data: { actorId: userId, orderId: line.orderId,
    kind: head ? "STUDIO_DOWNLOAD_METADATA_READ" : "STUDIO_DOWNLOAD_AUTHORIZED", details: { lineId, masterId, jobId, role, assetId: artifact.assetId, sha256: artifact.asset.checksumSha256, replacesAcquiredFile: false } } });
  return response;
}
