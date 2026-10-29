import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertDigitalUuid, DigitalError, digitalEnabled } from "@/lib/digital/domain";
import { digitalPublicPreviewAllowed } from "@/lib/digital/public-preview";
import { digitalCommercialAudioReady } from "@/lib/digital/formats";
import { assertDigitalRightsReviews } from "@/lib/digital/rights-review-service";
import { assertDigitalExcerptApprovals } from "@/lib/digital/excerpt-commerce";
import { requireDigitalExcerptAdmin } from "@/lib/digital/excerpt-service";
import { memberPremiereBinding, MEMBER_PREMIERE_EVENT, premiereFutureDate, premiereMemberAllowed, privatePremiereExcerpt } from "./premiere-policy";

const include = { digitalOffers: { select: { active: true } }, assets: { where: { role: "COVER" as const }, orderBy: [{ position: "asc" as const }, { createdAt: "desc" as const }], take: 1, include: { asset: true } },
  tracks: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }], include: { digitalMasters: { orderBy: { version: "desc" as const }, take: 1, include: { masterAsset: true, mp3Asset: true, previewAsset: true } } } } };
type DB = Prisma.TransactionClient;
type Project = Prisma.ProjectGetPayload<{ include: typeof include }>;
type Member = { status?: string; emailVerified?: boolean; role?: string } | null | undefined;

/** Used inside the existing explicit Admin publication transaction; no sale or
 * new approval is created here. Old public-bucket files cannot be made private
 * by merely changing an application flag. */
async function assertReady(db: DB, project: Project | null, now: Date, pendingExcerptClearance = false) {
  if (!digitalEnabled() || !project || !project.membersPreviewEnabled || !["SINGLE", "ALBUM"].includes(project.type)
    || !premiereFutureDate(project.releaseDate, now)) throw new DigitalError("PREMIERE_NOT_READY", 409);
  const cover = project.assets[0]?.asset;
  if (!cover || cover.visibility !== "PUBLIC" || cover.rightsStatus !== "CLEARED" || !/^[a-f0-9]{64}$/.test(cover.checksumSha256 ?? "")
    || !project.tracks.length || project.type === "SINGLE" && project.tracks.length !== 1) throw new DigitalError("PREMIERE_NOT_READY", 409);
  for (const track of project.tracks) {
    const master = track.digitalMasters[0];
    if (track.status === "UNLISTED" || !master || !privatePremiereExcerpt(master.previewAsset)
      || [master.masterAsset, master.mp3Asset, master.previewAsset].some(asset => asset && ["RESTRICTED", "REJECTED"].includes(asset.rightsStatus))) throw new DigitalError("PREMIERE_AUDIO_NOT_READY", 409);
    if (pendingExcerptClearance) {
      if (!digitalCommercialAudioReady(master) || !["PENDING", "CLEARED"].includes(master.previewAsset!.rightsStatus)) throw new DigitalError("PREMIERE_AUDIO_NOT_READY", 409);
      await assertDigitalRightsReviews(db, [master.id]);
      await assertDigitalExcerptApprovals(db, [master]);
    } else if (!await digitalPublicPreviewAllowed(db, master)) throw new DigitalError("PREMIERE_AUDIO_NOT_READY", 409);
  }
  return { binding: memberPremiereBinding(project) };
}
export async function assertMemberPremiereReady(db: DB, projectId: string, now = new Date()) {
  assertDigitalUuid(projectId);
  return assertReady(db, await db.project.findUnique({ where: { id: projectId }, include }), now);
}
/** Explicit member-publication action only. Exact legal/artistic decisions are
 * checked before clearing the short excerpt, never the full master/MP3 or any
 * commercial offer. The caller's transaction rolls everything back on failure. */
export async function authorizeMemberPremiereExcerpts(db: DB, projectId: string, actorId: string, now = new Date()) {
  assertDigitalUuid(projectId); await requireDigitalExcerptAdmin(db, actorId);
  const project = await db.project.findUnique({ where: { id: projectId }, include });
  const { binding } = await assertReady(db, project, now, true);
  const previews = project!.tracks.map(track => track.digitalMasters[0]);
  const changed = await db.asset.updateMany({ where: { id: { in: previews.map(master => master.previewAssetId!) }, type: "AUDIO_PREVIEW", rightsStatus: "PENDING" }, data: { rightsStatus: "CLEARED" } });
  if (changed.count) await db.digitalEvent.create({ data: { kind: "MEMBER_PREMIERE_EXCERPTS_CLEARED", actorId, details: { projectId, premiereBinding: binding,
    masterIds: previews.map(master => master.id), previewAssetIds: previews.map(master => master.previewAssetId), fullAudioChanged: false, offersActivated: false } } });
  return { binding };
}
async function publishedPremiere(db: DB, project: Project | null, now: Date) {
  if (!project || project.status !== "PUBLISHED" || !project.publicVisible) return false;
  try {
    const { binding } = await assertReady(db, project, now);
    const receipt = await db.digitalEvent.findFirst({ where: { kind: MEMBER_PREMIERE_EVENT, details: { path: ["projectId"], equals: project.id } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const details = receipt?.details as Record<string, unknown> | null | undefined;
    return !!receipt?.actorId && details?.premiereBinding === binding;
  } catch (error) { if (error instanceof DigitalError) return false; throw error; }
}
/** Public metadata may be announced by the marketing outbox, but no audio URL,
 * master or other private field is part of that notification. */
export async function publishedMemberPremiereSource(db: DB, projectId: string, now = new Date()) {
  assertDigitalUuid(projectId);
  return publishedPremiere(db, await db.project.findUnique({ where: { id: projectId }, include }), now);
}
export async function publishedMemberPremiereBinding(db: DB, projectId: string, now = new Date()) {
  assertDigitalUuid(projectId);
  const project = await db.project.findUnique({ where: { id: projectId }, include });
  return await publishedPremiere(db, project, now) ? memberPremiereBinding(project!) : null;
}
async function listPublishedPremiereProjects(db: DB, now: Date, options: { slug?: string } = {}) {
  if (!digitalEnabled()) return [];
  const projects = await db.project.findMany({ where: { membersPreviewEnabled: true, status: "PUBLISHED", publicVisible: true, releaseDate: { gt: now },
    ...(options.slug !== undefined ? { slug: options.slug } : {}) }, include,
    orderBy: [{ releaseDate: "asc" }, { id: "asc" }], take: 50 });
  const result: Project[] = [];
  for (const project of projects) if (await publishedPremiere(db, project, now)) result.push(project);
  return result;
}
/** Metadata only. The public page additionally intersects this exact approved
 * publication with the public catalogue's presentation permissions. No member
 * identity is fabricated, and no audio URL or documentary binding is projected. */
export async function listPublishedPremiereAnnouncements(db: DB = prisma, now = new Date()) {
  return (await listPublishedPremiereProjects(db, now)).map(project => ({
    id: project.id, slug: project.slug, title: project.title, type: project.type,
    releaseDate: project.releaseDate!.toISOString().slice(0, 10), trackCount: project.tracks.length,
    coverUrl: `/media/catalog/${project.assets[0].assetId}`,
  }));
}
export async function listMemberPremieres(actor: Member, db: DB = prisma, now = new Date(), options: { slug?: string } = {}) {
  if (!premiereMemberAllowed(actor) || !digitalEnabled()) return [];
  return (await listPublishedPremiereProjects(db, now, options)).map(project => ({ id: project.id, slug: project.slug, title: project.title, type: project.type, binding: memberPremiereBinding(project),
    releaseDate: project.releaseDate!.toISOString().slice(0,10), coverUrl: `/media/members-premieres/covers/${project.assets[0].assetId}`,
    tracks: project.tracks.map(track => ({ id: track.id, title: track.title, position: track.position, durationMs: track.digitalMasters[0].previewDurationMs,
      previewUrl: `/media/members-premieres/${track.digitalMasters[0].previewAssetId}` })) }));
}
/** HEAD, Range and conditional requests all pass the same member/version gates.
 * No original, complete MP3/WAV, bucket URL or signed URL is returned. */
export async function memberPremiereAudioAsset(actor: Member, assetId: string, db: DB = prisma, now = new Date()) {
  if (!premiereMemberAllowed(actor) || !digitalEnabled()) return null;
  assertDigitalUuid(assetId);
  const master = await db.digitalMaster.findFirst({ where: { previewAssetId: assetId }, select: { id: true, trackId: true, track: { select: { projectId: true } } } });
  if (!master) return null;
  const project = await db.project.findUnique({ where: { id: master.track.projectId }, include });
  if (!await publishedPremiere(db, project, now)) return null;
  const current = project!.tracks.find(track => track.id === master.trackId)?.digitalMasters[0];
  return current?.id === master.id && current.previewAsset?.id === assetId ? current.previewAsset : null;
}
export async function memberPremiereCoverAsset(actor: Member, assetId: string, db: DB = prisma, now = new Date()) {
  if (!premiereMemberAllowed(actor) || !digitalEnabled()) return null;
  assertDigitalUuid(assetId);
  const links = await db.projectAsset.findMany({ where: { assetId, role: "COVER", project: { membersPreviewEnabled: true, publicVisible: true, status: "PUBLISHED" } }, select: { projectId: true }, take: 50 });
  for (const link of links) {
    const project = await db.project.findUnique({ where: { id: link.projectId }, include });
    if (await publishedPremiere(db, project, now) && project!.assets[0]?.assetId === assetId) return project!.assets[0].asset;
  }
  return null;
}
