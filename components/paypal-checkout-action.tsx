"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatEuro } from "@/lib/orders/domain";

const messages: Record<string, string> = {
  PAYMENT_ALREADY_COMPLETED: "Ce paiement est déjà confirmé. Actualisez la page pour voir la commande.",
  ORDER_NOT_PAYABLE: "Cette commande ne peut plus être payée dans son état actuel.",
  PAYMENT_SNAPSHOT_CONFLICT: "Le paiement doit être vérifié avant une nouvelle tentative.",
  RATE_LIMITED: "Trop de tentatives rapprochées. Patientez quelques minutes.",
};

export function PaypalCheckoutAction({
  orderNumber,
  amountCents,
}: {
  orderNumber: string;
  amountCents: number;
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
        `/api/orders/${encodeURIComponent(orderNumber)}/payments/paypal/checkout`,
        { method: "POST", headers: { accept: "application/json" } },
      );
      const body = await response.json().catch(() => null) as { approvalUrl?: unknown; code?: unknown } | null;
      if (response.status === 401) {
        router.push(`/connexion?retour=${encodeURIComponent(`/compte/commandes/${orderNumber}`)}`);
        return;
      }
      if (!response.ok || typeof body?.approvalUrl !== "string") {
        const code = typeof body?.code === "string" ? body.code : "";
        throw new Error(messages[code] ?? "PayPal est momentanément indisponible. Votre commande reste enregistrée.");
      }
      const approvalUrl = new URL(body.approvalUrl);
      const allowed = approvalUrl.protocol === "https:"
        && (approvalUrl.hostname === "www.sandbox.paypal.com" || approvalUrl.origin === window.location.origin);
      if (!allowed) throw new Error("La redirection PayPal est invalide.");
      window.location.assign(approvalUrl.toString());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PayPal est momentanément indisponible.");
      setPending(false);
    }
  }

  return (
    <div className="checkout-action">
      <button className="form-button" type="button" onClick={startCheckout} disabled={pending}>
        {pending ? "Préparation PayPal…" : `Payer ${formatEuro(amountCents)} avec PayPal`}
      </button>
      <small>Paiement sécurisé hébergé par PayPal · le montant reste calculé par LNX Studio.</small>
      {message ? <p className="form-message form-message--error" role="alert">{message}</p> : null}
    </div>
  );
}
