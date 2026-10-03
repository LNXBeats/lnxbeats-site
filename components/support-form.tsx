"use client";

import { useState } from "react";
import styles from "@/components/support.module.css";

export function SupportForm({ minCents, maxCents }: { minCents: number; maxCents: number }) {
  const [amount, setAmount] = useState("5");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const cents = /^\d+(?:[.,]\d{1,2})?$/.test(amount) ? Math.round(Number(amount.replace(",", ".")) * 100) : NaN;

  async function checkout(provider: "STRIPE" | "PAYPAL") {
    if (pending) return;
    if (!Number.isSafeInteger(cents) || cents < minCents || cents > maxCents) {
      setError(`Choisissez un montant entre ${minCents / 100} € et ${maxCents / 100} €.`);
      return;
    }
    setPending(true);
    setError("");
    try {
      const session = await fetch("/api/support/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!session.ok) throw new Error("session");
      // This is a retry identifier, never a credential. Keep it across reloads
      // so a lost provider response does not create another contribution.
      const storageKey = `lnx-support-attempt:${provider}:${cents}`;
      let idempotencyKey = sessionStorage.getItem(storageKey);
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        sessionStorage.setItem(storageKey, idempotencyKey);
      }
      const response = await fetch("/api/support/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, amountCents: cents, idempotencyKey }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.checkoutUrl !== "string") throw new Error("unavailable");
      const destination = new URL(result.checkoutUrl);
      const allowed = provider === "STRIPE" ? ["checkout.stripe.com"] : ["www.sandbox.paypal.com"];
      if (destination.protocol !== "https:" || !allowed.includes(destination.hostname) || destination.username || destination.password) throw new Error("destination");
      window.location.assign(destination.href);
    } catch {
      setError("La préparation du soutien n’a pas abouti. Réessayez : une tentative déjà créée sera réutilisée, sans double paiement.");
      setPending(false);
    }
  }

  return <div className={styles.form}>
    <fieldset disabled={pending}>
      <legend>Choisissez votre montant</legend>
      <div className={styles.presets}>{[3, 5, 10, 20].map((value) => <button type="button" key={value} aria-pressed={cents === value * 100} onClick={() => { setAmount(String(value)); setError(""); }}>{value} €</button>)}</div>
      <label htmlFor="support-amount">Ou un montant libre en euros</label>
      <div className={styles.amount}><input id="support-amount" inputMode="decimal" type="text" maxLength={9} value={amount} onChange={(event) => { setAmount(event.target.value); setError(""); }} aria-describedby="support-amount-help" /><span aria-hidden="true">€</span></div>
      <small id="support-amount-help">De {minCents / 100} € à {maxCents / 100} €. Un versement ponctuel, jamais un abonnement.</small>
      <div className={styles.providers}>
        <button type="button" className="button button--primary" onClick={() => void checkout("STRIPE")}>Soutenir avec Stripe <span aria-hidden="true">↗</span></button>
        <button type="button" className="button button--secondary" onClick={() => void checkout("PAYPAL")}>Soutenir avec PayPal <span aria-hidden="true">↗</span></button>
      </div>
    </fieldset>
    <p role="status" aria-live="polite">{pending ? "Préparation du paiement sécurisé…" : error}</p>
    <small>Aucune donnée de carte n’est saisie ni conservée par LNX Beats.</small>
  </div>;
}
