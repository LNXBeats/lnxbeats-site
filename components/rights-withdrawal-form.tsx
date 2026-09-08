"use client";

import { useState } from "react";

export function RightsWithdrawalForm({ requestNumber, workTitle, paidAt, deadline }: Readonly<{ requestNumber: string; workTitle: string; paidAt: string; deadline: string }>) {
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
      setMessage(`Demande ${body.requestNumber} enregistrée. La prise d’effet est bloquée pendant son traitement.`);
    } catch {
      setMessage("La demande ne peut pas être enregistrée. Vérifiez son éligibilité ou réessayez plus tard.");
      setPending(false);
    }
  }

  return <form className="rights-info-request rights-withdrawal-form" onSubmit={submit}>
    <p className="eyebrow">Rétractation</p>
    <h2>Demander la rétractation avant prise d’effet</h2>
    <dl className="order-detail__facts">
      <div><dt>Licence</dt><dd>{requestNumber}</dd></div>
      <div><dt>Œuvre</dt><dd>{workTitle}</dd></div>
      <div><dt>Paiement confirmé</dt><dd>{new Date(paidAt).toLocaleString("fr-FR")}</dd></div>
      <div><dt>Date limite</dt><dd>{new Date(deadline).toLocaleString("fr-FR")}</dd></div>
      <div><dt>Remboursement prévu</dt><dd>150,00 € · moyen de paiement d’origine</dd></div>
    </dl>
    <label>Motif facultatif<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} rows={3} /></label>
    <label className="admin-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Je demande la rétractation de cette licence avant sa prise d’effet et son remboursement total.</label>
    <button className="button" type="submit" disabled={!confirmed || pending}>{pending ? "ENREGISTREMENT…" : "CONFIRMER MA RÉTRACTATION"}</button>
    {message ? <p role="status">{message}</p> : null}
  </form>;
}
