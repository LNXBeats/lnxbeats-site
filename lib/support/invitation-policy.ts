export const SUPPORT_INVITATION_DELAY_MS = 60_000;
export const SUPPORT_INVITATION_RETRY_MS = 5_000;
export const SUPPORT_INVITATION_DISMISS_KEY = "lnx-support-invitation-dismissed-until-v1";
export const SUPPORT_INVITATION_DISMISS_MS = 30 * 24 * 60 * 60_000;

/** Editorial discovery only: never interrupt a purchase, support or account task. */
export function supportInvitationPathAllowed(pathname: string) {
  return (pathname === "/" || ["/discographie", "/album", "/creations", "/boutique", "/avant-premieres"].some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)))
    && !/(?:^|\/)(?:panier|checkout|paiement|confirmation|retour)(?:\/|$)/.test(pathname);
}

/** Explicit dismissal, no identity or advertising/marketing consent is stored. */
export function supportInvitationDismissed(value: string | null, now = Date.now()) {
  const expires = Number(value);
  return Number.isFinite(expires) && expires > now && expires <= now + SUPPORT_INVITATION_DISMISS_MS;
}

export function remainingSupportInvitationDelay(remaining: number, elapsed: number) {
  return Math.max(0, remaining - Math.max(0, elapsed));
}
