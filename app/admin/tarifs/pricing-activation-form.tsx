"use client";

import { useState } from "react";

import { activateMusicPricingVersionAction } from "./actions";

type PricingFields = {
  basePrice: string;
  coverPrice: string;
  priorityPrice: string;
};

const pricingRows: Array<{ field: keyof PricingFields; label: string }> = [
  { field: "basePrice", label: "Création musicale" },
  { field: "coverPrice", label: "Illustration" },
  { field: "priorityPrice", label: "Traitement prioritaire" },
];

function comparablePrice(value: string) {
  const match = /^(0|[1-9]\d*)(?:[,.](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return `${Number(match[1])}:${(match[2] ?? "").padEnd(2, "0")}`;
}

export function PricingActivationForm({
  expectedRevision,
  current,
  confirmationValue,
}: {
  expectedRevision: number;
  current: PricingFields;
  confirmationValue: string;
}) {
  const [next, setNext] = useState(current);
  const changedFields = Object.fromEntries(pricingRows.map(({ field }) => [
    field,
    comparablePrice(next[field]) !== comparablePrice(current[field]),
  ])) as Record<keyof PricingFields, boolean>;
  const changedCount = Object.values(changedFields).filter(Boolean).length;
  const hasChanges = changedCount > 0;

  function update(field: keyof PricingFields, value: string) {
    setNext((pricing) => ({ ...pricing, [field]: value }));
  }

  return (
    <form action={activateMusicPricingVersionAction} className="admin-pricing-form">
      <input type="hidden" name="expectedRevision" value={expectedRevision} />
      <input type="hidden" name="currency" value="EUR" />
      <div className="admin-pricing-form__inputs">
        <label>
          <span>Création musicale</span>
          <input name="basePrice" inputMode="decimal" required value={next.basePrice} onChange={(event) => update("basePrice", event.target.value)} aria-describedby="pricing-entry-help" />
        </label>
        <label>
          <span>Illustration</span>
          <input name="coverPrice" inputMode="decimal" required value={next.coverPrice} onChange={(event) => update("coverPrice", event.target.value)} aria-describedby="pricing-entry-help" />
        </label>
        <label>
          <span>Traitement prioritaire</span>
          <input name="priorityPrice" inputMode="decimal" required value={next.priorityPrice} onChange={(event) => update("priorityPrice", event.target.value)} aria-describedby="pricing-entry-help" />
        </label>
      </div>
      <p className="admin-form-note" id="pricing-entry-help">Saisissez par exemple 20, 20,00 ou 25,50. La création musicale doit rester supérieure à 0 €.</p>

      <section className="admin-pricing-preview" aria-labelledby="pricing-preview-title">
        <div className="admin-pricing-preview__heading">
          <div><p className="admin-section-label">Avant → après</p><h3 id="pricing-preview-title">Vérification avant activation</h3></div>
          <p className="admin-pricing-change-status" aria-live="polite">{hasChanges ? `${changedCount} tarif${changedCount > 1 ? "s" : ""} modifié${changedCount > 1 ? "s" : ""}` : "Aucun changement à activer"}</p>
        </div>
        <div className="admin-pricing-comparison">
          {pricingRows.map(({ field, label }) => <div className={changedFields[field] ? "admin-pricing-comparison__row admin-pricing-comparison__row--changed" : "admin-pricing-comparison__row"} key={field}>
            <span className="admin-pricing-comparison__label">{label}</span>
            <span><small>Avant</small><strong>{current[field]} €</strong></span>
            <span className="admin-pricing-comparison__arrow" aria-hidden="true">→</span>
            <span><small>Après</small><strong>{next[field] || "—"} €</strong></span>
            <span className="admin-pricing-comparison__badge">{changedFields[field] ? "Modifié" : "Inchangé"}</span>
          </div>)}
        </div>
      </section>

      <fieldset className="admin-pricing-confirmation">
        <legend>Confirmation obligatoire</legend>
        <label className="admin-check">
          <input type="checkbox" name="confirmation" value={confirmationValue} required />
          <span>Les nouvelles commandes utiliseront ces tarifs après le futur cutover financier. Les commandes existantes ne seront jamais modifiées.</span>
        </label>
      </fieldset>
      <button className="admin-button admin-button--primary admin-pricing-submit" type="submit" disabled={!hasChanges}>Confirmer les nouveaux tarifs</button>
    </form>
  );
}
