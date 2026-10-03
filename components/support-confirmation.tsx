"use client";

import { useEffect, useState } from "react";

type SupportStatus = { status: string; amountCents: number; provider: string };
const labels: Record<string, string> = { PAID: "Soutien confirmé", SUCCEEDED: "Soutien confirmé", PENDING: "Confirmation en attente", CREATED: "Paiement à confirmer", REFUND_PENDING: "Remboursement en cours", REFUNDED: "Soutien remboursé", FAILED: "Paiement non confirmé", REQUIRES_REVIEW: "Vérification en cours" };

export function SupportConfirmation({ id }: { id: string }) {
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

  return <div aria-live="polite">
    {status ? <><h2>{labels[status.status] ?? "Vérification du soutien"}</h2><p>{new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(status.amountCents / 100)} · {status.provider}</p>
      {["PAID", "SUCCEEDED"].includes(status.status) ? <p>Merci pour votre soutien libre. Cette confirmation n’est ni une facture de vente ni un reçu fiscal. Aucun avantage ou droit ne découle de ce versement.</p> : <p>Seule la confirmation serveur du prestataire fait foi. Le retour sur cette page ne prouve pas un paiement réussi.</p>}
      {status.provider === "PAYPAL" && ["CREATED", "PENDING"].includes(status.status) ? <button className="button button--primary" type="button" disabled={busy} onClick={() => void capture()}>Confirmer mon soutien PayPal</button> : null}
      <button className="button button--secondary" type="button" disabled={busy} onClick={() => { setError(""); void refresh().catch(() => setError("Statut temporairement indisponible.")); }}>Actualiser le statut</button>
    </> : <p>Lecture de la confirmation sécurisée…</p>}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
