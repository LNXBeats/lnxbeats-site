"use client";

import { useState } from "react";

import { saveRightsGrantAction } from "@/app/admin/droits/actions";
import type { AdminClientRightsWishes, AdminRightsGrantPrefill } from "@/lib/rights/admin-presentation";
import { formatAdminRightsValue, missingAdminRightsValue } from "@/lib/rights/admin-presentation";

type GrantOption = Readonly<{ value: string; label: string }>;

type Props = Readonly<{
  requestNumber: string;
  grantOptions: readonly GrantOption[];
  clientWishes: AdminClientRightsWishes;
  prefill: AdminRightsGrantPrefill;
}>;

type GrantFormState = Readonly<{
  kind: string;
  destination: string;
  platforms: string;
  territory: string;
  duration: string;
  authorized: boolean;
  exclusive: boolean;
  monetization: boolean;
  adaptation: boolean;
  advertising: boolean;
  audiovisualSync: boolean;
  contentId: boolean;
  sublicense: boolean;
  credit: string;
  restrictions: string;
}>;

export function AdminRightsGrantForm({ requestNumber, grantOptions, clientWishes, prefill }: Props) {
  const [state, setState] = useState<GrantFormState>({
    ...prefill,
    platforms: "",
    territory: "",
    duration: "",
    monetization: false,
    kind: "PUBLICATION",
    destination: "",
    credit: "",
    restrictions: "",
  });

  function setText(name: "kind" | "destination" | "platforms" | "territory" | "duration" | "credit" | "restrictions", value: string) {
    setState((current) => ({ ...current, [name]: value }));
  }

  function setFlag(name: "authorized" | "exclusive" | "monetization" | "adaptation" | "advertising" | "audiovisualSync" | "contentId" | "sublicense", checked: boolean) {
    setState((current) => ({ ...current, [name]: checked }));
  }

  function applyClientWishes() {
    setState((current) => ({
      ...current,
      ...prefill,
    }));
  }

  return <div className="admin-rights-grant-workspace">
    <section className="admin-client-wishes" aria-labelledby="admin-client-wishes-title">
      <div>
        <p className="admin-section-label">Souhaits du client</p>
        <h3 id="admin-client-wishes-title">Base déclarative, non contractuelle.</h3>
      </div>
      <dl>
        <div><dt>Plateformes</dt><dd>{formatAdminRightsValue(clientWishes.platforms)}</dd></div>
        <div><dt>Territoire</dt><dd>{clientWishes.territory || missingAdminRightsValue}</dd></div>
        <div><dt>Durée</dt><dd>{clientWishes.duration || missingAdminRightsValue}</dd></div>
        <div><dt>Monétisation</dt><dd>{formatAdminRightsValue(clientWishes.monetization)}</dd></div>
      </dl>
      <button className="admin-button admin-button--quiet" type="button" onClick={applyClientWishes}>REPRENDRE LES SOUHAITS DU CLIENT</button>
      <p className="admin-work-note">Préremplissage de travail uniquement. Aucun droit n’est accordé tant que les paramètres ne sont pas expressément enregistrés et contractualisés.</p>
    </section>

    <form className="admin-contract-form" action={saveRightsGrantAction}>
      <input type="hidden" name="requestNumber" value={requestNumber} />
      <fieldset className="admin-rights-grant-fieldset">
        <legend>Paramètres retenus par LNX Beats</legend>
        <label>Droit
          <select name="kind" value={state.kind} onChange={(event) => setText("kind", event.target.value)}>
            {grantOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <div className="admin-choice-row">
          <label><input type="checkbox" name="authorized" checked={state.authorized} onChange={(event) => setFlag("authorized", event.target.checked)} /> Autorisé</label>
          <label><input type="checkbox" name="exclusive" checked={state.exclusive} onChange={(event) => setFlag("exclusive", event.target.checked)} /> Exclusif</label>
          <label><input type="checkbox" name="monetization" checked={state.monetization} onChange={(event) => setFlag("monetization", event.target.checked)} /> Monétisation</label>
          <label><input type="checkbox" name="adaptation" checked={state.adaptation} onChange={(event) => setFlag("adaptation", event.target.checked)} /> Adaptation</label>
          <label><input type="checkbox" name="advertising" checked={state.advertising} onChange={(event) => setFlag("advertising", event.target.checked)} /> Publicité</label>
          <label><input type="checkbox" name="audiovisualSync" checked={state.audiovisualSync} onChange={(event) => setFlag("audiovisualSync", event.target.checked)} /> Synchronisation</label>
          <label><input type="checkbox" name="contentId" checked={state.contentId} onChange={(event) => setFlag("contentId", event.target.checked)} /> Content ID</label>
          <label><input type="checkbox" name="sublicense" checked={state.sublicense} onChange={(event) => setFlag("sublicense", event.target.checked)} /> Sous-licence</label>
        </div>
        <label>Destination<textarea name="destination" maxLength={2000} value={state.destination} onChange={(event) => setText("destination", event.target.value)} /></label>
        <div className="admin-field-grid">
          <label>Plateformes / supports (séparés par virgules)<input name="platforms" maxLength={1000} value={state.platforms} onChange={(event) => setText("platforms", event.target.value)} /></label>
          <label>Territoire<input name="territory" maxLength={240} value={state.territory} onChange={(event) => setText("territory", event.target.value)} /></label>
          <label>Durée<input name="duration" maxLength={240} value={state.duration} onChange={(event) => setText("duration", event.target.value)} /></label>
        </div>
        <label>Crédit<textarea name="credit" maxLength={2000} value={state.credit} onChange={(event) => setText("credit", event.target.value)} /></label>
        <label>Restrictions<textarea name="restrictions" maxLength={4000} value={state.restrictions} onChange={(event) => setText("restrictions", event.target.value)} /></label>
        <button className="admin-button" type="submit">ENREGISTRER CE PARAMÈTRE</button>
      </fieldset>
    </form>
  </div>;
}
