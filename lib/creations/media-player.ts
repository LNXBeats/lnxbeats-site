import type { CreationMediaKind, CreationPrimaryMedia } from "@/lib/creations/types";

export type ActiveCreationMedia = Readonly<{
  creationSlug: string;
  kind: CreationMediaKind;
}>;

export type CreationMediaPlayerState = Readonly<{
  selectedCreationSlug: string;
  selectedMedia: CreationPrimaryMedia;
  activeMedia: ActiveCreationMedia | null;
}>;

export type CreationMediaPlayerAction =
  | { type: "select-creation"; slug: string; primaryMedia: CreationPrimaryMedia }
  | { type: "select-media"; media: CreationPrimaryMedia }
  | { type: "play"; slug: string; kind: CreationMediaKind }
  | { type: "pause"; slug: string; kind: CreationMediaKind };

export const CREATION_MEDIA_NETWORK_RECOVERY_LIMIT = 1;

export function refreshedCreationMediaUrl(source: string, nonce: string, baseUrl: string) {
  const url = new URL(source, baseUrl);
  url.searchParams.set("lnx-media-refresh", nonce);
  return url.toString();
}

export function initialCreationMediaPlayerState(
  selectedCreationSlug: string,
  primaryMedia: CreationPrimaryMedia,
): CreationMediaPlayerState {
  return { selectedCreationSlug, selectedMedia: primaryMedia, activeMedia: null };
}

export function reduceCreationMediaPlayerState(
  state: CreationMediaPlayerState,
  action: CreationMediaPlayerAction,
): CreationMediaPlayerState {
  if (action.type === "select-creation") {
    return {
      ...state,
      selectedCreationSlug: action.slug,
      selectedMedia: action.primaryMedia,
    };
  }
  if (action.type === "select-media") return { ...state, selectedMedia: action.media };
  if (action.type === "play") {
    return {
      ...state,
      activeMedia: { creationSlug: action.slug, kind: action.kind },
    };
  }
  if (
    state.activeMedia?.creationSlug !== action.slug
    || state.activeMedia.kind !== action.kind
  ) return state;
  return { ...state, activeMedia: null };
}
