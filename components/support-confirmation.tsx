"use client";
import { T, ContractLanguageNotice, useSiteLanguage } from "@/components/site-language";


import { useEffect, useState } from "react";
import Link from "next/link";
import { UiIcon } from "@/components/ui-icon";
import { supportConfirmationPresentation, SUPPORT_CONFIRMATION_LEGAL } from "@/lib/support/contact";
import styles from "@/components/support.module.css";

type SupportStatus = { status: string; amountCents: number; provider: string; mode?: string; needsReconciliation?: boolean;
  emailProvided?: boolean; messageProvided?: boolean; confirmationEmailStatus?: string | null };
const labels: Record<string, string> = { PAID: "Soutien confirmé", SUCCEEDED: "Soutien confirmé", PENDING: "Confirmation en attente", CREATED: "Paiement à confirmer", REFUND_PENDING: "Remboursement en cours", REFUNDED: "Soutien remboursé", FAILED: "Paiement non confirmé", REQUIRES_REVIEW: "Vérification en cours" };

export function SupportConfirmation({ id }: { id: string }) {
  const { t, money } = useSiteLanguage();
  const [status, setStatus] = useState<SupportStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh(signal?: AbortSignal) {
    const response = await fetch(`/api/support/${encodeURIComponent(id)}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error("unavailable");
    const result: SupportStatus = await response.json();
    setStatus(result);
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/support/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("unavailable"); return response.json() as Promise<SupportStatus>; })
      .then((result) => { if (!controller.signal.aborted) setStatus(result); })
      .catch(() => { if (!controller.signal.aborted) setError("Cette confirmation est inaccessible dans cette session. Aucun paiement n’est déclaré réussi sans confirmation du prestataire."); });
    return () => controller.abort();
  // id is the only request scope; no polling or automatic capture on navigation.
  }, [id]);

  async function capture() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/support/${encodeURIComponent(id)}/capture`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("unavailable");
      await refresh();
    } catch { setError("La confirmation n’a pas abouti. Actualisez le statut avant de réessayer ; le même paiement sera réutilisé."); }
    finally { setBusy(false); }
  }

  const presentation = supportConfirmationPresentation(status?.status ?? "", status?.needsReconciliation);
  if (status && presentation.confirmed) return <div className={styles.thanks} aria-live="polite">
    {status.mode === "TEST" ? <span className={styles.test}><T text="Préversion · soutien TEST uniquement" /></span> : null}
    <h1><T text="MERCI" /> <UiIcon name="heart" /></h1><h2><T text="Votre soutien compte vraiment." /></h2>
    <p className={styles.confirmedAmount}>{money(status.amountCents)} · <T text="Soutien confirmé" /></p>
    <p><T text="Merci de faire vivre LNX Beats et de contribuer aux prochaines histoires." /></p>
    <ul className={styles.acknowledgements}>
      {status.emailProvided ? <li><T text={status.confirmationEmailStatus === "SENT" ? "Une confirmation vient de vous être envoyée." : "Votre demande de confirmation par e-mail est enregistrée ; son envoi reste en attente."}/></li> : null}
      {status.messageProvided ? <li><T text="Votre message a bien été transmis à LNX Beats." /></li> : null}
    </ul>
    <div className={styles.returnActions}><Link className="button button--primary" href="/"><T text="Revenir à l’accueil" /></Link><Link className="button button--secondary" href="/discographie"><T text="Découvrir la discographie"/></Link></div>
    <ContractLanguageNotice/><p className={styles.legal} lang="fr" translate="no">{SUPPORT_CONFIRMATION_LEGAL}</p>
  </div>;
  return <div aria-live="polite">
    {status ? <><h2><T text={labels[status.status] ?? "Vérification du soutien"}/></h2><p>{money(status.amountCents)} · {status.provider}</p>
      {status.needsReconciliation ? <p><T text="Résultat à vérifier. Ne recommencez pas un paiement chez un autre prestataire." /></p> : null}
      {["PAID", "SUCCEEDED"].includes(status.status) ? <><ContractLanguageNotice/><p lang="fr" translate="no">Merci pour votre soutien libre. Cette confirmation n’est ni une facture de vente ni un reçu fiscal. Aucun avantage ou droit ne découle de ce versement.</p></> : <p><T text="Seule la confirmation serveur du prestataire fait foi. Le retour sur cette page ne prouve pas un paiement réussi." /></p>}
      {status.provider === "PAYPAL" && ["CREATED", "PENDING"].includes(status.status) ? <button className="button button--primary" type="button" disabled={busy} onClick={() => void capture()}><T text="Confirmer mon soutien PayPal" /></button> : null}
      {presentation.actionable ? <><button className="button button--secondary" type="button" disabled={busy} onClick={() => { setError(""); void refresh().catch(() => setError("Statut temporairement indisponible.")); }}><T text="Actualiser le statut" /></button>
      <button className="button button--secondary" type="button" disabled={busy} onClick={() => {
        setBusy(true); setError("");
        void fetch(`/api/support/${encodeURIComponent(id)}/reconcile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
          .then(r => { if (!r.ok) throw new Error("pending"); return refresh(); })
          .catch(() => setError("Vérification en attente. Aucun nouveau paiement n’a été demandé."))
          .finally(() => setBusy(false));
      }}><T text="Vérifier auprès du prestataire" /></button></> : null}
    </> : <p><T text="Lecture de la confirmation sécurisée…" /></p>}
    {error ? <p role="alert">{t(error)}</p> : null}
  </div>;
}
