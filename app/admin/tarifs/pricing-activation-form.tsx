"use client";

import { useState } from "react";

import { activateMusicPricingVersionAction } from "./actions";

type PricingFields = {
  basePrice: string;
  coverPrice: string;
  priorityPrice: string;
};

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

  function update(field: keyof PricingFields, value: string) {
    setNext((pricing) => ({ ...pricing, [field]: value }));
  }

  return (
    <form action={activateMusicPricingVersionAction} className="admin-catalogue-filters">
      <input type="hidden" name="expectedRevision" value={expectedRevision} />
      <input type="hidden" name="currency" value="EUR" />
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
      <p id="pricing-entry-help">Saisissez par exemple 20, 20,00 ou 25,50. La création musicale doit rester supérieure à 0 €.</p>

      <section aria-labelledby="pricing-preview-title">
        <h3 id="pricing-preview-title">Vérification avant activation</h3>
        <div>
          <h4>Anciens tarifs</h4>
          <dl>
            <div><dt>Création</dt><dd>{current.basePrice} €</dd></div>
            <div><dt>Illustration</dt><dd>{current.coverPrice} €</dd></div>
            <div><dt>Priorité</dt><dd>{current.priorityPrice} €</dd></div>
          </dl>
        </div>
        <div>
          <h4>Nouveaux tarifs saisis</h4>
          <dl aria-live="polite">
            <div><dt>Création</dt><dd>{next.basePrice || "—"} €</dd></div>
            <div><dt>Illustration</dt><dd>{next.coverPrice || "—"} €</dd></div>
            <div><dt>Priorité</dt><dd>{next.priorityPrice || "—"} €</dd></div>
          </dl>
        </div>
      </section>

      <fieldset>
        <legend>Confirmation obligatoire</legend>
        <label>
          <input type="checkbox" name="confirmation" value={confirmationValue} required />
          <span>Les nouvelles commandes utiliseront ces tarifs après le futur cutover financier. Les commandes existantes ne seront jamais modifiées.</span>
        </label>
      </fieldset>
      <button type="submit">Confirmer les nouveaux tarifs</button>
    </form>
  );
}
