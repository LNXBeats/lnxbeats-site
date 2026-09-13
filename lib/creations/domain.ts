import { CreationValidationError } from "@/lib/creations/validation";

export const CREATION_ACTION_CONFIRMATIONS = {
  publish: "CONFIRM_CREATION_PUBLICATION",
  unpublish: "CONFIRM_CREATION_UNPUBLICATION",
  archive: "CONFIRM_CREATION_ARCHIVAL",
  deleteExternalLink: "CONFIRM_CREATION_EXTERNAL_LINK_DELETION",
} as const;

export type CreationPublicationAsset = {
  role: "COVER" | "VIDEO_POSTER" | "AUDIO" | "VIDEO" | string;
  asset: {
    visibility: string;
    type: string;
    mimeType: string;
    rightsStatus: string;
  };
};

export type CreationPublishState = {
  title: string;
  summary: string | null;
  primaryMedia: "COVER" | "AUDIO" | "VIDEO" | null | string;
  assets: readonly CreationPublicationAsset[];
};

function mediaRoleIsCoherent(asset: CreationPublicationAsset) {
  if (asset.role === "COVER" || asset.role === "VIDEO_POSTER") {
    return (asset.asset.type === "COVER" || asset.asset.type === "IMAGE")
      && asset.asset.mimeType.startsWith("image/");
  }
  if (asset.role === "AUDIO") {
    return asset.asset.type === "AUDIO" && asset.asset.mimeType === "audio/mpeg";
  }
  if (asset.role === "VIDEO") {
    return asset.asset.type === "VIDEO" && asset.asset.mimeType === "video/mp4";
  }
  return false;
}

export function isPublishableCreationAsset(asset: CreationPublicationAsset) {
  return asset.asset.visibility === "PUBLIC"
    && asset.asset.rightsStatus === "CLEARED"
    && mediaRoleIsCoherent(asset);
}

export function getCreationPublicationBlockers(creation: CreationPublishState) {
  const blockers: string[] = [];
  if (!creation.title.trim()) blockers.push("TITLE_MISSING");
  if (!creation.summary?.trim()) blockers.push("SUMMARY_MISSING");
  if (!creation.primaryMedia) blockers.push("PRIMARY_MEDIA_MISSING");
  if (creation.assets.length === 0) blockers.push("MEDIA_MISSING");

  const invalidAssets = creation.assets.filter((asset) => !isPublishableCreationAsset(asset));
  if (invalidAssets.length) blockers.push("MEDIA_NOT_PUBLIC_OR_CLEARED");

  if (!creation.assets.some((asset) => (asset.role === "AUDIO" || asset.role === "VIDEO") && isPublishableCreationAsset(asset))) {
    blockers.push("PLAYABLE_MEDIA_MISSING");
  }

  const primaryRole = creation.primaryMedia;
  if (primaryRole && !creation.assets.some((asset) => asset.role === primaryRole && isPublishableCreationAsset(asset))) {
    blockers.push("PRIMARY_MEDIA_ASSET_MISSING");
  }
  return blockers;
}

export function assertCreationPublishable(creation: CreationPublishState) {
  const blockers = getCreationPublicationBlockers(creation);
  if (blockers.length) {
    throw new CreationValidationError(
      "Cette création ne peut pas être publiée tant que son résumé et ses médias publics autorisés ne sont pas complets.",
      `PUBLICATION_BLOCKED:${blockers.join(",")}`,
    );
  }
}
