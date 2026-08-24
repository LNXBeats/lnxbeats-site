"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import type { ClientPaymentState } from "@/lib/orders/checkout";

const POLL_INTERVAL_MS = 1_500;
const MAX_POLLS = 12;

export function PaymentReturnNotice({
  state,
  paymentState,
  orderNumber,
}: {
  state: "return" | "cancel";
  paymentState: ClientPaymentState;
  orderNumber: string;
}) {
  const router = useRouter();

  useEffect(() => {
    if (state !== "return" || !["confirming", "ready"].includes(paymentState)) return;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      router.refresh();
      if (polls >= MAX_POLLS) window.clearInterval(timer);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [paymentState, router, state]);

  if (state === "cancel") {
    return (
      <section className="order-detail__section" aria-live="polite">
        <p className="auth-panel__label">Paiement non finalisé</p>
        <h2>Votre commande est conservée.</h2>
        <p>Aucun débit n’a été confirmé par ce retour : la commande reste impayée et conservée. Vous pouvez réessayer sans refaire votre brief.</p>
        <Link className="text-link" href={`/compte/commandes/${encodeURIComponent(orderNumber)}`}>Voir la commande <span aria-hidden="true">→</span></Link>
      </section>
    );
  }

  return (
    <section className="order-detail__section" aria-live="polite">
      <p className="auth-panel__label">Confirmation du paiement</p>
      <h2>{paymentState === "confirmed" ? "Paiement confirmé. Commande reçue." : paymentState === "failed" ? "Paiement refusé." : paymentState === "review" ? "Paiement en cours de vérification." : "Paiement en cours de confirmation."}</h2>
      <p>{paymentState === "confirmed"
        ? "La confirmation sécurisée du paiement a bien été enregistrée."
        : paymentState === "failed"
          ? "Aucun débit n’a été confirmé. Réessayez ou utilisez un autre moyen proposé par Stripe."
          : paymentState === "review"
            ? "LNX Beats vérifie automatiquement la concordance du paiement avant de traiter la commande."
            : "Cette page actualise temporairement le statut de la commande. Le retour sur le site ne suffit pas à confirmer le paiement."}</p>
      {paymentState === "confirming" || paymentState === "ready" ? <small>Après quelques instants, retrouvez toujours l’état dans votre espace Compte.</small> : null}
    </section>
  );
}
