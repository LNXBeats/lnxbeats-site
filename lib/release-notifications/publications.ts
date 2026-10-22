import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { releaseAlertPublicPath, type ReleaseAlertKind } from "@/lib/release-notifications/domain";
import { publishedMemberPremiereSource } from "@/lib/members/previews";
import { discographyPreparationEnabled } from "@/lib/digital/discography-preparation-policy";
import { digitalCommercialAudioReady } from "@/lib/digital/formats";

/** Exact metadataPublicAllowed condition for an already PUBLISHED music source,
 * as classified by the existing discography policy. Only this project is read,
 * inside the caller's transaction; no cached/global catalogue projection. */
async function musicMetadataPublicAllowed(tx: Prisma.TransactionClient, projectId: string) {
  const view = await tx.project.findUnique({ where: { id: projectId }, select: {
    status: true, publicVisible: true,
    digitalOffers: { where: { active: true }, select: { id: true } },
    assets: { where: { role: "COVER" }, orderBy: [{ position: "asc" }, { createdAt: "desc" }], select: { asset: { select: { rightsStatus: true } } } },
    tracks: { select: { status: true, digitalMasters: { take: 1, orderBy: { version: "desc" }, include: { masterAsset: true, mp3Asset: true, previewAsset: true } } } },
  } });
  if (!view || view.status !== "PUBLISHED" || !view.publicVisible) return false;
  if (view.digitalOffers.length > 0) return true; // Existing explicit live offers remain preserved by the same policy.
  return view.assets.length === 1 && view.assets[0].asset.rightsStatus === "CLEARED" && view.tracks.length > 0
    && view.tracks.every(track => track.status === "RELEASED" && !!track.digitalMasters[0] && digitalCommercialAudioReady(track.digitalMasters[0]));
}

/** Re-check the authoritative public source, never a draft or an external DistroKid product. */
export async function releasePublicationSource(tx: Prisma.TransactionClient, kind: string, resourceId: string) {
  if (kind === "MUSIC") {
    const source = await tx.project.findUnique({ where: { id: resourceId }, select: { title: true, slug: true, status: true, publicVisible: true, type: true, membersPreviewEnabled: true } });
    if (source?.status !== "PUBLISHED" || !source.publicVisible || !["SINGLE", "ALBUM"].includes(source.type)) return null;
    const path = releaseAlertPublicPath("MUSIC", source.slug);
    if (source.membersPreviewEnabled) return await publishedMemberPremiereSource(tx, resourceId)
      ? { title: source.title, path: `/avant-premieres#${source.slug}` } : null;
    if (discographyPreparationEnabled() && !await musicMetadataPublicAllowed(tx, resourceId)) return null;
    return { title: source.title, path };
  }
  if (kind === "SHOP") {
    const source = await tx.product.findUnique({ where: { id: resourceId }, select: { title: true, slug: true, status: true } });
    return source?.status === "PUBLISHED" ? { title: source.title, path: releaseAlertPublicPath("SHOP", source.slug) } : null;
  }
  if (kind === "EDITORIAL") {
    const source = await tx.creation.findUnique({ where: { id: resourceId }, select: { title: true, slug: true, status: true } });
    return source?.status === "PUBLISHED" ? { title: source.title, path: releaseAlertPublicPath("EDITORIAL", source.slug) } : null;
  }
  return null;
}

export async function enqueueReleasePublication(tx: Prisma.TransactionClient, input: { kind: ReleaseAlertKind; resourceId: string }) {
  const source = await releasePublicationSource(tx, input.kind, input.resourceId);
  if (!source) return;
  // Permanent unique marker: retries, double clicks and re-publications cannot re-send.
  // Existing public resources are marked baseline by the additive migration, without mail.
  await tx.releasePublication.createMany({ data: [{ ...input, ...source }], skipDuplicates: true });
}
