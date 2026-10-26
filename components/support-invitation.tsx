"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { T, useSiteLanguage } from "@/components/site-language";
import { remainingSupportInvitationDelay, supportInvitationDismissed, supportInvitationPathAllowed, SUPPORT_INVITATION_DELAY_MS, SUPPORT_INVITATION_DISMISS_KEY, SUPPORT_INVITATION_DISMISS_MS, SUPPORT_INVITATION_RETRY_MS } from "@/lib/support/invitation-policy";
import styles from "./support-invitation.module.css";

function anotherInvitationOrTaskIsOpen() {
  const blockers = document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"], .fc-consent-root, .fc-dialog-container, iframe[title*="consent" i], iframe[title*="privacy" i]');
  return Array.from(blockers).some(element => element.getClientRects().length > 0)
    || Boolean(document.activeElement?.matches('input, textarea, select, [contenteditable="true"]'));
}

/** A dismissible editorial link, not a payment form; it never loads a provider. */
export function SupportInvitation({ enabled }: { enabled: boolean }) {
  const pathname = usePathname(), { t } = useSiteLanguage();
  const [open, setOpen] = useState(false);
  const offered = useRef(false), remaining = useRef(SUPPORT_INVITATION_DELAY_MS);
  const invitation = useRef<HTMLElement>(null), previousFocus = useRef<HTMLElement | null>(null);
  const allowed = enabled && supportInvitationPathAllowed(pathname);

  function dismiss() {
    offered.current = true;
    setOpen(false);
    if (invitation.current?.contains(document.activeElement)) previousFocus.current?.focus({ preventScroll: true });
    try { window.localStorage.setItem(SUPPORT_INVITATION_DISMISS_KEY, String(Date.now() + SUPPORT_INVITATION_DISMISS_MS)); } catch { /* Choice remains respected for this visit. */ }
  }

  useEffect(() => {
    if (!allowed || offered.current) return;
    try { if (supportInvitationDismissed(window.localStorage.getItem(SUPPORT_INVITATION_DISMISS_KEY))) return; } catch { /* Storage is optional. */ }
    let timer: number | undefined, startedAt: number | null = null;
    const stop = () => {
      window.clearTimeout(timer);
      if (startedAt !== null) remaining.current = remainingSupportInvitationDelay(remaining.current, performance.now() - startedAt);
      startedAt = null;
    };
    const offer = () => {
      stop();
      if (document.visibilityState !== "visible" || offered.current) return;
      if (anotherInvitationOrTaskIsOpen()) {
        timer = window.setTimeout(offer, SUPPORT_INVITATION_RETRY_MS);
        return;
      }
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      offered.current = true;
      setOpen(true);
    };
    const schedule = () => {
      stop();
      if (document.visibilityState !== "visible" || offered.current) return;
      startedAt = performance.now();
      timer = window.setTimeout(offer, remaining.current);
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => { stop(); document.removeEventListener("visibilitychange", schedule); };
  }, [allowed]);

  useEffect(() => {
    if (!open || !allowed) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && invitation.current?.getClientRects().length) dismiss(); };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, allowed]);

  if (!allowed || !open) return null;
  return <aside ref={invitation} className={styles.invitation} role="dialog" aria-modal="false" aria-labelledby="support-invitation-title" aria-describedby="support-invitation-description" data-public-invitation="support">
    <button type="button" className={styles.close} onClick={dismiss} aria-label={t("Fermer l’invitation à soutenir")}><span aria-hidden="true">×</span></button>
    <div className={styles.emblem} aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M24 37 9.5 23a9 9 0 0 1 12.7-12.7L24 12l1.8-1.7A9 9 0 0 1 38.5 23L24 37Z" stroke="currentColor" strokeWidth="1.5"/><path d="M14 24h5l3-8 4 16 3-8h5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg></div>
    <p className={styles.eyebrow}><T text="Une minute ensemble. Merci." /></p>
    <h2 id="support-invitation-title"><T text="Votre écoute fait vivre la musique." /></h2>
    <p id="support-invitation-description"><T text="Si vous le souhaitez, contribuez aux prochaines créations de LNX Beats." /></p>
    <Link className={styles.support} href="/soutenir" onClick={dismiss}><T text="Soutenir l’artiste" /><span aria-hidden="true">↗</span></Link>
    <button type="button" className={styles.later} onClick={dismiss}><T text="Continuer à découvrir" /></button>
    <p className={styles.note}><T text="Un soutien libre, sans contrepartie." /></p>
  </aside>;
}
