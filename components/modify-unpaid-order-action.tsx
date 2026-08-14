"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ModifyUnpaidOrderAction({ orderNumber }: { orderNumber: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function prepareEdit() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/payments/stripe/prepare-edit`, { method: "POST" });
      if (!response.ok) throw new Error("La session de paiement ne peut pas encore être fermée. Réessayez dans quelques instants.");
      router.push(`/commander?brouillon=${encodeURIComponent(orderNumber)}&etape=recap`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La commande ne peut pas encore être modifiée.");
      setPending(false);
    }
  }
  return <div className="modify-unpaid-order"><button className="form-button" type="button" onClick={prepareEdit} disabled={pending}>{pending ? "Fermeture du paiement…" : "Modifier ma commande"}</button>{error ? <p role="alert">{error}</p> : null}</div>;
}
