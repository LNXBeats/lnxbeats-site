"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { checkoutPaymentChoicePresentation, checkoutPaymentCtaLabel } from "@/lib/payments/presentation";

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
  target = "music",
  termsAccepted = true,
}: {
  orderNumber: string;
  amountCents: number;
  compact?: boolean;
  target?: "music" | "shop";
  termsAccepted?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function startCheckout() {
    if (pending) return;
    if (target === "shop" && !termsAccepted) {
      setMessage("Acceptez les Conditions Générales de Vente avant de poursuivre.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        target === "shop"
          ? `/api/shop/orders/${encodeURIComponent(orderNumber)}/payments/stripe/checkout`
          : `/api/orders/${encodeURIComponent(orderNumber)}/payments/stripe/checkout`,
        target === "shop"
          ? {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ termsAccepted: true }),
          }
          : { method: "POST", headers: { accept: "application/json" } },
      );
      const body = await response.json().catch(() => null) as { checkoutUrl?: unknown; code?: unknown } | null;
      if (response.status === 401) {
        const returnTo = target === "shop"
          ? `/compte/achats/${encodeURIComponent(orderNumber)}`
          : `/compte/commandes/${encodeURIComponent(orderNumber)}`;
        router.push(`/connexion?retour=${encodeURIComponent(returnTo)}`);
        return;
      }
      if (!response.ok || typeof body?.checkoutUrl !== "string") {
        const code = typeof body?.code === "string" ? body.code : "";
        throw new Error(checkoutMessages[code] ?? "Stripe est momentanément indisponible. Votre commande reste enregistrée.");
      }
      const checkoutUrl = new URL(body.checkoutUrl);
      if (checkoutUrl.protocol !== "https:") throw new Error("La redirection de paiement est invalide.");
      window.location.assign(checkoutUrl.toString());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Stripe est momentanément indisponible. Votre commande reste enregistrée.");
      setPending(false);
    }
  }

  return (
    <div className={compact ? "checkout-action checkout-action--compact" : "checkout-action"}>
      <button className="form-button form-button--primary" type="button" onClick={startCheckout} disabled={pending}>
        {pending ? "Préparation sécurisée…" : checkoutPaymentCtaLabel("stripe", amountCents, target)}
      </button>
      <small>{checkoutPaymentChoicePresentation.stripe.assurance}</small>
      {message ? <p className="form-message form-message--error" role="alert">{message}</p> : null}
    </div>
  );
}
