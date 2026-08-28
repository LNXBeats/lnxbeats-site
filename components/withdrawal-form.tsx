"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type FormState = {
  contractType: "MUSIC_ORDER" | "SHOP_ORDER";
  orderNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  productDescription: string;
  quantity: string;
  reason: string;
};

const initialState: FormState = {
  contractType: "MUSIC_ORDER",
  orderNumber: "",
  firstName: "",
  lastName: "",
  email: "",
  productDescription: "",
  quantity: "",
  reason: "",
};

export function WithdrawalForm() {
  const router = useRouter();
  const [form, setForm] = useState(initialState);
  const [step, setStep] = useState<"FORM" | "REVIEW">("FORM");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setStep("REVIEW");
  }

  async function confirm() {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/legal/withdrawals", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          contractType: form.contractType,
          orderNumber: form.orderNumber,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          productDescription: form.productDescription,
          quantity: form.quantity ? Number(form.quantity) : null,
          reason: form.reason || null,
          declarationAccepted: true,
        }),
      });
      const body = await response.json().catch(() => null) as { next?: unknown } | null;
      if (!response.ok || body?.next !== "/retractation/confirmation") {
        throw new Error("La demande ne peut pas être traitée. Vérifiez les informations ou réessayez plus tard.");
      }
      router.push(body.next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "La demande ne peut pas être traitée.");
      setPending(false);
    }
  }

  if (step === "REVIEW") {
    return (
      <section className="withdrawal-review" aria-labelledby="withdrawal-review-title">
        <p className="eyebrow">Vérification avant envoi</p>
        <h2 id="withdrawal-review-title">Relisez votre déclaration.</h2>
        <dl>
          <div><dt>Contrat</dt><dd>{form.contractType === "MUSIC_ORDER" ? "Création musicale" : "Boutique physique"}</dd></div>
          <div><dt>Commande</dt><dd>{form.orderNumber}</dd></div>
          <div><dt>Demandeur</dt><dd>{form.firstName} {form.lastName}</dd></div>
          <div><dt>E-mail</dt><dd>{form.email}</dd></div>
          <div><dt>Produit ou prestation</dt><dd>{form.productDescription}</dd></div>
          {form.quantity ? <div><dt>Quantité</dt><dd>{form.quantity}</dd></div> : null}
          {form.reason ? <div><dt>Motif facultatif</dt><dd>{form.reason}</dd></div> : null}
        </dl>
        <p className="withdrawal-review__declaration">Je vous notifie par la présente ma décision de me rétracter du contrat identifié ci-dessus, sous réserve de la vérification de son applicabilité.</p>
        <div className="withdrawal-form__actions">
          <button className="button button--secondary" type="button" onClick={() => setStep("FORM")} disabled={pending}>Modifier</button>
          <button className="button" type="button" onClick={confirm} disabled={pending}>{pending ? "Enregistrement…" : "Confirmer ma demande de rétractation"}</button>
        </div>
        {message ? <p className="form-message form-message--error" role="alert">{message}</p> : null}
      </section>
    );
  }

  return (
    <form className="withdrawal-form" onSubmit={review}>
      <div className="withdrawal-form__grid">
        <label><span>Type de contrat</span><select value={form.contractType} onChange={(event) => update("contractType", event.target.value as FormState["contractType"])}><option value="MUSIC_ORDER">Création musicale</option><option value="SHOP_ORDER">Boutique physique</option></select></label>
        <label><span>Numéro de commande</span><input required autoComplete="off" placeholder={form.contractType === "SHOP_ORDER" ? "LNX-SHOP-2026-000001" : "LNX-2026-000001"} value={form.orderNumber} onChange={(event) => update("orderNumber", event.target.value)} /></label>
        <label><span>Prénom</span><input required autoComplete="given-name" maxLength={100} value={form.firstName} onChange={(event) => update("firstName", event.target.value)} /></label>
        <label><span>Nom</span><input required autoComplete="family-name" maxLength={100} value={form.lastName} onChange={(event) => update("lastName", event.target.value)} /></label>
        <label className="withdrawal-form__wide"><span>Adresse e-mail utilisée pour la commande</span><input required type="email" autoComplete="email" maxLength={320} value={form.email} onChange={(event) => update("email", event.target.value)} /></label>
        <label className="withdrawal-form__wide"><span>Produit ou prestation concerné</span><input required maxLength={500} value={form.productDescription} onChange={(event) => update("productDescription", event.target.value)} /></label>
        <label><span>Quantité, si applicable</span><input type="number" inputMode="numeric" min={1} max={999} value={form.quantity} onChange={(event) => update("quantity", event.target.value)} /></label>
        <label className="withdrawal-form__wide"><span>Motif facultatif</span><textarea maxLength={1000} rows={4} value={form.reason} onChange={(event) => update("reason", event.target.value)} /><small>Aucun motif n’est exigé.</small></label>
      </div>
      <p className="withdrawal-form__privacy">Les informations servent uniquement à enregistrer, vérifier et traiter votre déclaration. La réponse publique ne révèle jamais l’existence ni le contenu d’une commande.</p>
      <button className="button" type="submit">Relire ma demande</button>
    </form>
  );
}
