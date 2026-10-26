export const MEMBER_INVITATION_DELAY_MS = 12_000;
export const MEMBER_INVITATION_RETRY_MS = 1_000;
export const MEMBER_INVITATION_DISMISS_KEY = "lnx-member-invitation-dismissed-until-v1";
export const MEMBER_INVITATION_DISMISS_MS = 30 * 24 * 60 * 60_000;

/** No interruption of payment, account, legal, contact or administrative tasks. */
export function memberInvitationPathAllowed(pathname: string) {
  return pathname === "/" || ["/discographie", "/album", "/creations", "/boutique"].some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
    && !/(?:^|\/)(?:panier|checkout|paiement|confirmation|retour)(?:\/|$)/.test(pathname);
}
export function memberInvitationDismissed(value: string | null, now = Date.now()) {
  const expires = Number(value);
  return Number.isFinite(expires) && expires > now && expires <= now + MEMBER_INVITATION_DISMISS_MS;
}
