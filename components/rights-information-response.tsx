"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RightsInformationResponse({ requestNumber }: { requestNumber: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/rights/${encodeURIComponent(requestNumber)}/response`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "La réponse n’a pas pu être transmise.");
      setMessage(""); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "La réponse n’a pas pu être transmise."); }
    finally { setBusy(false); }
  }
  return <div className="rights-response"><label htmlFor="rights-response">Votre réponse</label><textarea id="rights-response" rows={6} maxLength={6000} required value={message} onChange={(event) => setMessage(event.target.value)} aria-describedby="rights-response-help" /><small id="rights-response-help">Répondez uniquement aux précisions demandées. Cet échange est historisé.</small><button className="form-button form-button--primary" type="button" disabled={busy || !message.trim()} onClick={() => void submit()}>{busy ? "ENVOI…" : "ENVOYER MA RÉPONSE"}</button>{error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}</div>;
}
