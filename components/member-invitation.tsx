"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { memberInvitationDismissed, memberInvitationPathAllowed, MEMBER_INVITATION_DELAY_MS, MEMBER_INVITATION_DISMISS_KEY, MEMBER_INVITATION_DISMISS_MS } from "@/lib/members/invitation-policy";
import { T, useSiteLanguage } from "@/components/site-language";
import styles from "./member-invitation.module.css";

/** Non-modal invitation: the visitor keeps access to the page and all players. */
export function MemberInvitation() {
  const pathname = usePathname(), { t } = useSiteLanguage();
  const { data: session, isPending, error } = authClient.useSession();
  const [open, setOpen] = useState(false), offered = useRef(false);
  const allowed = memberInvitationPathAllowed(pathname);
  function dismiss() {
    offered.current = true;
    setOpen(false);
    // Only remember an explicit choice, no identifier, tracking or marketing consent.
    try { window.localStorage.setItem(MEMBER_INVITATION_DISMISS_KEY, String(Date.now() + MEMBER_INVITATION_DISMISS_MS)); } catch { /* Choice still respected in memory. */ }
  }
  useEffect(() => {
    if (!allowed || isPending || error || session?.user || offered.current) return;
    try { if (memberInvitationDismissed(window.localStorage.getItem(MEMBER_INVITATION_DISMISS_KEY))) return; } catch { /* No storage is required to browse. */ }
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== "visible" || offered.current) return;
      timer = window.setTimeout(() => {
        const modalVisible = Array.from(document.querySelectorAll('dialog[open], [aria-modal="true"]')).some(element => element.getClientRects().length > 0);
        if (document.visibilityState !== "visible" || modalVisible || document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
        offered.current = true; setOpen(true);
      }, MEMBER_INVITATION_DELAY_MS);
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", schedule); };
  }, [allowed, isPending, error, session?.user]);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  if (!open || !allowed || isPending || error || session?.user) return null;
  return <aside className={styles.invitation} role="dialog" aria-modal="false" aria-labelledby="member-invitation-title" aria-describedby="member-invitation-description">
    <button type="button" className={styles.close} onClick={dismiss} aria-label={t("Fermer l’invitation à s’inscrire")}><span aria-hidden="true">×</span></button>
    <p className={styles.eyebrow}><T text="Le cercle LNX Beats" /></p>
    <h2 id="member-invitation-title"><T text="Écoutez les prochaines avant-premières." /></h2>
    <p id="member-invitation-description"><T text="Créez votre espace gratuit pour écouter les extraits réservés aux membres, lorsque LNX Beats les publie." /></p>
    <Link className={styles.join} href="/inscription?retour=%2Favant-premieres" onClick={dismiss}><T text="Créer mon espace gratuit" /><span aria-hidden="true">→</span></Link>
    <button type="button" className={styles.later} onClick={dismiss}><T text="Continuer sans m’inscrire" /></button>
    <p className={styles.note}><T text="Les alertes e-mail sont facultatives. Vous gardez le choix." /></p>
  </aside>;
}
