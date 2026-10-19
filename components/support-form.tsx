"use client";

import { T, ContractLanguageNotice, useSiteLanguage } from "@/components/site-language";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UiIcon } from "@/components/ui-icon";
import { parseSupportContact, SUPPORT_EMAIL_MAX, SUPPORT_MESSAGE_MAX } from "@/lib/support/contact";
import styles from "@/components/support.module.css";

export function SupportForm({ minCents, maxCents, stripeConfigured = false, paypalConfigured = false, mode = "TEST" }: {
  minCents: number; maxCents: number; stripeConfigured?: boolean; paypalConfigured?: boolean; mode?: "TEST" | "LIVE";
}) {
  const router = useRouter();
  const { t, money } = useSiteLanguage();
  const [amount, setAmount] = useState("5");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [newContribution, setNewContribution] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const providerConfigured = stripeConfigured || paypalConfigured;
  const cents = /^\d+(?:[.,]\d{1,2})?$/.test(amount) ? Math.round(Number(amount.replace(",", ".")) * 100) : NaN;

  async function checkout(provider: "STRIPE" | "PAYPAL") {
    if (pending) return;
    try { parseSupportContact({ email, message }); } catch { setError("Vérifiez votre e-mail et votre message (500 caractères maximum)."); return; }
    if (!Number.isSafeInteger(cents) || cents < minCents || cents > maxCents) {
      setError(t("Choisissez un montant entre {min} et {max}.", { min: money(minCents), max: money(maxCents) }));
      return;
    }
    setPending(true);
    setError("");
    try {
      const session = await fetch("/api/support/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!session.ok) throw new Error("session");
      // This is a retry identifier, never a credential. Keep it across reloads
      // so a lost provider response does not create another contribution.
      const storageKey = "lnx-support-attempt";
      let idempotencyKey = sessionStorage.getItem(storageKey);
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        sessionStorage.setItem(storageKey, idempotencyKey);
      }
      const response = await fetch("/api/support/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, amountCents: cents, idempotencyKey, newContribution, email, message }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error("unavailable");
      if (typeof result.contributionId === "string") sessionStorage.setItem("lnx-support-contribution", result.contributionId);
      if (typeof result.checkoutUrl !== "string") {
        router.push(`/soutenir/confirmation/${encodeURIComponent(result.contributionId)}`);
        return;
      }
      const destination = new URL(result.checkoutUrl);
      const allowed = provider === "STRIPE" ? ["checkout.stripe.com"] : [mode === "TEST" ? "www.sandbox.paypal.com" : "www.paypal.com"];
      if (destination.protocol !== "https:" || !allowed.includes(destination.hostname) || destination.username || destination.password) throw new Error("destination");
      window.location.assign(destination.href);
    } catch {
      setError("La préparation du soutien n’a pas abouti. Une tentative existante sera vérifiée avant toute reprise. Ne créez pas un soutien supplémentaire pour réessayer un paiement en attente.");
      setPending(false);
    }
  }

  return <div className={styles.form}>
    {!providerConfigured ? <p className={styles.unavailable}><T text="Les moyens de paiement ne sont pas disponibles actuellement. Aucun versement n’est possible." /></p> : null}
    <fieldset disabled={pending || !providerConfigured}>
      <legend><T text="Choisissez votre montant" /></legend>
      <div className={styles.presets}>{[3, 5, 10, 20].map((value) => <button type="button" key={value} aria-pressed={cents === value * 100} onClick={() => { setAmount(String(value)); setError(""); }}>{money(value * 100)}</button>)}</div>
      <label htmlFor="support-amount"><T text="Ou un montant libre en euros" /></label>
      <div className={styles.amount}><input id="support-amount" inputMode="decimal" type="text" maxLength={9} value={amount} onChange={(event) => { setAmount(event.target.value); setError(""); }} aria-describedby="support-amount-help" /><span aria-hidden="true">€</span></div>
      <small id="support-amount-help"><T text="De {min} à {max}. Un versement ponctuel, jamais un abonnement." values={{min:money(minCents),max:money(maxCents)}}/></small>
      <div className={styles.contactFields}>
        <label htmlFor="support-email"><T text="Votre e-mail" /> <small><T text="Facultatif · Pour recevoir une confirmation de votre soutien." /></small></label>
        <input id="support-email" type="email" autoComplete="email" maxLength={SUPPORT_EMAIL_MAX} value={email} onChange={event => setEmail(event.target.value)} aria-describedby="support-contact-help" />
        <label htmlFor="support-message"><T text="Un petit mot pour LNX Beats" /> <small><T text="Facultatif" /></small></label>
        <textarea id="support-message" rows={4} maxLength={SUPPORT_MESSAGE_MAX} placeholder={t("Votre message de soutien…")} value={message} onChange={event => setMessage(event.target.value)} />
        <small id="support-contact-help"><T text="500 caractères maximum. Pas d’inscription newsletter ni d’utilisation marketing. Votre message reste chez LNX Beats." /></small>
      </div>
      <div className={styles.providers}>
        {stripeConfigured ? <button type="button" className="button button--primary" onClick={() => void checkout("STRIPE")}><T text="Soutenir avec Stripe" /> <span aria-hidden="true"><UiIcon name="arrow-up-right" /></span></button> : null}
        {paypalConfigured ? <button type="button" className="button button--secondary" onClick={() => void checkout("PAYPAL")}><T text="Soutenir avec PayPal" /> <span aria-hidden="true"><UiIcon name="arrow-up-right" /></span></button> : null}
      </div>
    </fieldset>
    <p role="status" aria-live="polite">{t(pending ? "Préparation du paiement sécurisé…" : error)}</p>
    <ContractLanguageNotice/>
    <label lang="fr" translate="no"><input type="checkbox" disabled={pending} checked={newContribution} onChange={event => {
      setNewContribution(event.target.checked);
      if (event.target.checked) sessionStorage.setItem("lnx-support-attempt", crypto.randomUUID());
    }} /> Je souhaite effectuer un soutien distinct supplémentaire, pas réessayer un paiement en attente.</label>
    <small><T text="Aucune donnée de carte n’est saisie ni conservée par LNX Beats." /></small>
  </div>;
}
