"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RightsContactConfirmation({ requestNumber }: { requestNumber: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/rights/${encodeURIComponent(requestNumber)}/confirm`, { method: "POST" });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "La confirmation n’a pas pu être enregistrée.");
      router.push(`/compte/droits/${encodeURIComponent(requestNumber)}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La confirmation n’a pas pu être enregistrée.");
    } finally {
      setBusy(false);
    }
  }
  return <div className="rights-confirm-actions"><button type="button" className="form-button form-button--primary" disabled={busy} onClick={() => void confirm()}>{busy ? "GÉNÉRATION DU PROJET…" : "JE CONFIRME MES INFORMATIONS"}</button>{error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}</div>;
}
