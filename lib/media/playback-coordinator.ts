export const MEDIA_PLAYBACK_CLAIM_EVENT = "lnx-media-playback-claim";

export type MediaPlaybackKind = "audio" | "video";

export type MediaPlaybackClaim = Readonly<{
  ownerId: string;
  kind: MediaPlaybackKind;
}>;

type PlaybackTarget = Pick<EventTarget, "addEventListener" | "removeEventListener" | "dispatchEvent">;

function browserPlaybackTarget(): PlaybackTarget | null {
  return typeof window === "undefined" ? null : window;
}

function validClaim(value: unknown): value is MediaPlaybackClaim {
  if (!value || typeof value !== "object") return false;
  const claim = value as Partial<MediaPlaybackClaim>;
  return typeof claim.ownerId === "string"
    && claim.ownerId.length > 0
    && (claim.kind === "audio" || claim.kind === "video");
}

export function announceMediaPlayback(
  claim: MediaPlaybackClaim,
  target: PlaybackTarget | null = browserPlaybackTarget(),
) {
  if (!target || !validClaim(claim)) return false;
  return target.dispatchEvent(new CustomEvent<MediaPlaybackClaim>(MEDIA_PLAYBACK_CLAIM_EVENT, { detail: claim }));
}

export function listenForOtherMediaPlayback(
  ownerId: string,
  pause: (claim: MediaPlaybackClaim) => void,
  target: PlaybackTarget | null = browserPlaybackTarget(),
) {
  if (!target || !ownerId) return () => undefined;

  const listener = (event: Event) => {
    if (!(event instanceof CustomEvent) || !validClaim(event.detail) || event.detail.ownerId === ownerId) return;
    pause(event.detail);
  };

  target.addEventListener(MEDIA_PLAYBACK_CLAIM_EVENT, listener);
  return () => target.removeEventListener(MEDIA_PLAYBACK_CLAIM_EVENT, listener);
}
