"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RightsRequestCloseActions({ requestNumber, orderNumber, draft }: { requestNumber: string; orderNumber: string; draft: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function close() {
    if (!window.confirm(draft ? "Supprimer définitivement ce brouillon ?" : "Annuler cette demande tout en conservant son historique ?")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/rights/${encodeURIComponent(requestNumber)}`, { method: draft ? "DELETE" : "POST" });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "L’action n’a pas pu être enregistrée.");
      if (draft) router.push(`/compte/commandes/${encodeURIComponent(orderNumber)}`);
      else router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "L’action n’a pas pu être enregistrée."); }
    finally { setBusy(false); }
  }
  return <div className="rights-close-actions"><button className="text-link" type="button" disabled={busy} onClick={() => void close()}>{draft ? "SUPPRIMER CE BROUILLON" : "ANNULER CETTE DEMANDE"}</button>{error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}</div>;
}
