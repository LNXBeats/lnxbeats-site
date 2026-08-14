"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 6;

export function PaymentReturnNotice({
  state,
  confirmed,
}: {
  state: "return" | "cancel";
  confirmed: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    if (state !== "return" || confirmed) return;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      router.refresh();
      if (polls >= MAX_POLLS) window.clearInterval(timer);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [confirmed, router, state]);

  if (state === "cancel") {
    return (
      <section className="order-detail__section" aria-live="polite">
        <p className="auth-panel__label">Paiement interrompu</p>
        <h2>La commande reste impayée.</h2>
        <p>Vous pourrez reprendre le même parcours Stripe Test depuis l’Admin QA. Aucun statut de paiement n’a été forcé par ce retour.</p>
      </section>
    );
  }

  return (
    <section className="order-detail__section" aria-live="polite">
      <p className="auth-panel__label">Retour Stripe Test</p>
      <h2>{confirmed ? "Paiement confirmé." : "Paiement en cours de confirmation."}</h2>
      <p>{confirmed
        ? "Le webhook signé a synchronisé le paiement et la commande dans PostgreSQL."
        : "Cette page actualise temporairement l’état serveur. Le retour navigateur ne constitue jamais une preuve de paiement."}</p>
    </section>
  );
}
