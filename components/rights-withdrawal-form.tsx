"use client";

import { OriginalName } from "@/components/original-name";
import { T, ContractLanguageNotice, useSiteLanguage } from "@/components/site-language";
import { localeIntl } from "@/lib/i18n/config";
import { useState } from "react";

export function RightsWithdrawalForm({ requestNumber, workTitle, paidAt, deadline }: Readonly<{ requestNumber: string; workTitle: string; paidAt: string; deadline: string }>) {
  const { locale, t } = useSiteLanguage();
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/rights/${encodeURIComponent(requestNumber)}/withdrawal`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ declarationAccepted: true, reason: reason.trim() || null }),
      });
      const body = await response.json().catch(() => null) as { requestNumber?: string; code?: string } | null;
      if (!response.ok || !body?.requestNumber) throw new Error(body?.code ?? "Demande indisponible");
      setMessage(t("Demande {reference} enregistrée. La prise d’effet est bloquée pendant son traitement.", {reference:body.requestNumber}));
    } catch {
      setMessage("La demande ne peut pas être enregistrée. Vérifiez son éligibilité ou réessayez plus tard.");
      setPending(false);
    }
  }

  return <form className="rights-info-request rights-withdrawal-form" onSubmit={submit}>
    <p className="eyebrow"><T text="Rétractation" /></p>
    <h2><T text="Demander la rétractation avant prise d’effet" /></h2>
    <dl className="order-detail__facts">
      <div><dt><T text="Licence" /></dt><dd>{requestNumber}</dd></div>
      <div><dt><T text="Œuvre" /></dt><dd>{<OriginalName>{workTitle}</OriginalName>}</dd></div>
      <div><dt><T text="Paiement confirmé" /></dt><dd>{new Date(paidAt).toLocaleString(localeIntl(locale), {timeZone:"Europe/Paris"})}</dd></div>
      <div><dt><T text="Date limite" /></dt><dd>{new Date(deadline).toLocaleString(localeIntl(locale), {timeZone:"Europe/Paris"})}</dd></div>
      <div><dt><T text="Remboursement prévu" /></dt><dd><T text="150,00 € · moyen de paiement d’origine" /></dd></div>
    </dl>
    <label><T text="Motif facultatif" /><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} rows={3} /></label>
    <ContractLanguageNotice /><label className="admin-check" lang="fr" translate="no"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Je demande la rétractation de cette licence avant sa prise d’effet et son remboursement total.</label>
    <button className="button" type="submit" disabled={!confirmed || pending}>{pending ? <T text="ENREGISTREMENT…" /> : <T text="CONFIRMER MA RÉTRACTATION" />}</button>
    {message ? <p role="status">{<T text={message} />}</p> : null}
  </form>;
}
