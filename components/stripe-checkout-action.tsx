"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatEuro } from "@/lib/orders/domain";

const checkoutMessages: Record<string, string> = {
  PAYMENT_ALREADY_COMPLETED: "Ce paiement est déjà confirmé. Actualisez la page pour voir la commande.",
  ORDER_NOT_PAYABLE: "Cette commande ne peut plus être payée dans son état actuel.",
  PAYMENT_SNAPSHOT_CONFLICT: "Le paiement doit être vérifié avant une nouvelle tentative.",
  RATE_LIMITED: "Trop de tentatives rapprochées. Patientez quelques minutes.",
};

export function StripeCheckoutAction({
  orderNumber,
  amountCents,
  compact = false,
}: {
  orderNumber: string;
  amountCents: number;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function startCheckout() {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderNumber)}/payments/stripe/checkout`,
        { method: "POST", headers: { accept: "application/json" } },
      );
      const body = await response.json().catch(() => null) as { checkoutUrl?: unknown; code?: unknown } | null;
      if (response.status === 401) {
        const returnTo = `/compte/commandes/${encodeURIComponent(orderNumber)}`;
        router.push(`/connexion?retour=${encodeURIComponent(returnTo)}`);
        return;
      }
      if (!response.ok || typeof body?.checkoutUrl !== "string") {
        const code = typeof body?.code === "string" ? body.code : "";
        throw new Error(checkoutMessages[code] ?? "Stripe Test est momentanément indisponible. Votre commande reste enregistrée.");
      }
      const checkoutUrl = new URL(body.checkoutUrl);
      if (checkoutUrl.protocol !== "https:") throw new Error("La redirection de paiement est invalide.");
      window.location.assign(checkoutUrl.toString());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Stripe Test est momentanément indisponible. Votre commande reste enregistrée.");
      setPending(false);
    }
  }

  return (
    <div className={compact ? "checkout-action checkout-action--compact" : "checkout-action"}>
      <button className="form-button form-button--primary" type="button" onClick={startCheckout} disabled={pending}>
        {pending ? "Préparation sécurisée…" : `Payer ${formatEuro(amountCents)}`}
      </button>
      <small>Paiement hébergé par Stripe · environnement Test · aucune donnée carte saisie sur LNX.</small>
      {message ? <p className="form-message form-message--error" role="alert">{message}</p> : null}
    </div>
  );
}
