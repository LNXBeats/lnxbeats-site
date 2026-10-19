"use client";

import { T } from "@/components/site-language";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function PartnershipPreauthorizationRevision({ requestNumber }: { requestNumber: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/rights/${encodeURIComponent(requestNumber)}/preauthorization/revise`, { method: "POST" });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "La nouvelle version n’a pas pu être générée.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La nouvelle version n’a pas pu être générée.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rights-confirm-actions">
      <p><T text="La version P01 reste archivée. Cette action crée une seule version P02 corrigée, sans paiement ni activation de droits." /></p>
      <button type="button" className="form-button form-button--primary" disabled={busy} onClick={() => void generate()}>
        {busy ? <T text="GÉNÉRATION DE P02…" /> : <T text="GÉNÉRER LA VERSION P02" />}
      </button>
      {error ? <p className="form-message form-message--error" role="alert">{<T text={error} />}</p> : null}
    </div>
  );
}
