"use client";

import { useState } from "react";

export function AdminPaymentTestAction({ orderNumber }: { orderNumber: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function startCheckout() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderNumber)}/payments/stripe/checkout`,
        { method: "POST", headers: { accept: "application/json" } },
      );
      const body = await response.json().catch(() => null) as { checkoutUrl?: unknown } | null;
      if (!response.ok || typeof body?.checkoutUrl !== "string") {
        throw new Error("Checkout indisponible");
      }
      const checkoutUrl = new URL(body.checkoutUrl);
      if (checkoutUrl.protocol !== "https:") throw new Error("Checkout invalide");
      window.location.assign(checkoutUrl.toString());
    } catch {
      setMessage("La session Stripe Test n’a pas pu être préparée. Réessayez sans modifier la commande.");
      setPending(false);
    }
  }

  return (
    <div className="admin-payment-test-action">
      <strong>MODE TEST STRIPE</strong>
      <p>Aucun argent réel. Le montant est relu depuis PostgreSQL et ne peut pas être modifié ici.</p>
      <button type="button" onClick={startCheckout} disabled={pending}>
        {pending ? "Préparation…" : "Ouvrir Stripe Checkout Test"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
