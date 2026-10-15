"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { consumerRequestDeclaration, consumerRequestLabel, type ConsumerRequestKind } from "@/lib/legal/withdrawal-copy";

type FormState = {
  contractType: "MUSIC_ORDER" | "SHOP_ORDER" | "DIGITAL_ORDER";
  requestKind: ConsumerRequestKind;
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
  requestKind: "WITHDRAWAL",
  orderNumber: "",
  firstName: "",
  lastName: "",
  email: "",
  productDescription: "",
  quantity: "",
  reason: "",
};

export function WithdrawalForm({ digitalAvailable = false, initialDigitalOrderId, initialDigital = false }: { digitalAvailable?: boolean; initialDigitalOrderId?: string; initialDigital?: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => digitalAvailable && (initialDigital || initialDigitalOrderId) ? { ...initialState, contractType: "DIGITAL_ORDER", orderNumber: initialDigitalOrderId ?? "" } : initialState);
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
          ...(form.contractType === "DIGITAL_ORDER" ? { requestKind: form.requestKind } : {}),
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
          <div><dt>Contrat</dt><dd>{form.contractType === "MUSIC_ORDER" ? "Création musicale" : form.contractType === "DIGITAL_ORDER" ? "Musique numérique" : "Boutique physique"}</dd></div>
          <div><dt>Nature</dt><dd>{consumerRequestLabel(form.contractType === "DIGITAL_ORDER" ? form.requestKind : "WITHDRAWAL")}</dd></div>
          <div><dt>Commande</dt><dd>{form.orderNumber}</dd></div>
          <div><dt>Demandeur</dt><dd>{form.firstName} {form.lastName}</dd></div>
          <div><dt>E-mail</dt><dd>{form.email}</dd></div>
          <div><dt>Produit ou prestation</dt><dd>{form.productDescription}</dd></div>
          {form.quantity ? <div><dt>Quantité</dt><dd>{form.quantity}</dd></div> : null}
          {form.reason ? <div><dt>Motif facultatif</dt><dd>{form.reason}</dd></div> : null}
        </dl>
        <p className="withdrawal-review__declaration">{consumerRequestDeclaration(form.contractType === "DIGITAL_ORDER" ? form.requestKind : "WITHDRAWAL")}</p>
        <div className="withdrawal-form__actions">
          <button className="button button--secondary" type="button" onClick={() => setStep("FORM")} disabled={pending}>Modifier</button>
          <button className="button" type="button" onClick={confirm} disabled={pending}>{pending ? "Enregistrement…" : form.contractType !== "DIGITAL_ORDER" || form.requestKind === "WITHDRAWAL" ? "Confirmer ma rétractation" : "Confirmer ma demande"}</button>
        </div>
        {message ? <p className="form-message form-message--error" role="alert">{message}</p> : null}
      </section>
    );
  }

  return (
    <form className="withdrawal-form" method="post" action="/api/legal/withdrawals" onSubmit={review}>
      <div className="withdrawal-form__grid">
        <label><span>Type de contrat</span><select value={form.contractType} onChange={(event) => setForm(current => ({ ...current, contractType: event.target.value as FormState["contractType"], requestKind: "WITHDRAWAL" }))}><option value="MUSIC_ORDER">Création musicale</option><option value="SHOP_ORDER">Boutique physique</option>{digitalAvailable ? <option value="DIGITAL_ORDER">Musique numérique · démonstration locale</option> : null}</select></label>
        {form.contractType === "DIGITAL_ORDER" ? <label><span>Nature de la demande</span><select value={form.requestKind} onChange={event => update("requestKind", event.target.value as ConsumerRequestKind)}><option value="WITHDRAWAL">Exercer ma rétractation</option><option value="NON_CONFORMITY">Signaler une non-conformité</option><option value="GOODWILL">Demander un geste commercial</option></select><small>Ces démarches sont distinctes. Un geste commercial ne remplace pas vos droits légaux.</small></label> : null}
        <label><span>{form.contractType === "DIGITAL_ORDER" ? "Référence complète de l’achat numérique" : "Numéro de commande"}</span><input required maxLength={64} autoComplete="off" placeholder={form.contractType === "SHOP_ORDER" ? "LNX-SHOP-2026-000001" : form.contractType === "DIGITAL_ORDER" ? "Référence complète figurant dans la confirmation" : "LNX-2026-000001"} value={form.orderNumber} onChange={(event) => update("orderNumber", event.target.value)} />{form.contractType === "DIGITAL_ORDER" ? <small>Copiez la référence complète depuis votre confirmation d’achat, pas son abréviation.</small> : null}</label>
        <label><span>Prénom</span><input required autoComplete="given-name" maxLength={100} value={form.firstName} onChange={(event) => update("firstName", event.target.value)} /></label>
        <label><span>Nom</span><input required autoComplete="family-name" maxLength={100} value={form.lastName} onChange={(event) => update("lastName", event.target.value)} /></label>
        <label className="withdrawal-form__wide"><span>{form.contractType === "DIGITAL_ORDER" ? "Adresse e-mail où recevoir l’accusé de réception" : "Adresse e-mail utilisée pour la commande"}</span><input required type="email" autoComplete="email" maxLength={320} value={form.email} onChange={(event) => update("email", event.target.value)} />{form.contractType === "DIGITAL_ORDER" ? <small>Si cette adresse diffère de celle de l’achat, la déclaration reste enregistrée ; le rapprochement du contrat nécessitera une vérification humaine.</small> : null}</label>
        <label className="withdrawal-form__wide"><span>Produit ou prestation concerné</span><input required maxLength={500} value={form.productDescription} onChange={(event) => update("productDescription", event.target.value)} /></label>
        <label><span>Quantité, si applicable</span><input type="number" inputMode="numeric" min={1} max={999} value={form.quantity} onChange={(event) => update("quantity", event.target.value)} /></label>
        <label className="withdrawal-form__wide"><span>Motif facultatif</span><textarea maxLength={1000} rows={4} value={form.reason} onChange={(event) => update("reason", event.target.value)} /><small>Aucun motif n’est exigé.</small></label>
      </div>
      <p className="withdrawal-form__privacy">Les informations servent uniquement à enregistrer, vérifier et traiter votre déclaration. La réponse publique ne révèle jamais l’existence ni le contenu d’une commande.</p>
      <button className="button" type="submit">Relire ma demande</button>
    </form>
  );
}
