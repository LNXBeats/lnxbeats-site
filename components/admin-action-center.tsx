"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AdminIcon } from "@/components/admin-icons";
import { AdminStatusBadge } from "@/components/admin-v21-ui";

export type AdminActionView = Readonly<{ key: string; domain: string; type: string; reference: string; label: string; priority: "CRITICAL" | "HIGH" | "NORMAL"; date: string; href: string }>;

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "Europe/Paris" });

export function AdminActionCenter({ actions, total }: { actions: readonly AdminActionView[]; total: number }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [showSelection, setShowSelection] = useState(false);
  const selectedActions = useMemo(() => actions.filter((action) => selected.has(action.key)), [actions, selected]);
  const compatible = selectedActions.length > 0 && selectedActions.every((action) => action.domain === selectedActions[0].domain && action.label === selectedActions[0].label);
  function toggle(key: string) {
    setShowSelection(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  return <section className="admin-v21-action-center" aria-labelledby="admin-actions-title">
    <div className="admin-v21-action-center__heading">
      <div><p className="admin-kicker">Centre d’action</p><h2 id="admin-actions-title">À traiter maintenant <span>{total}</span></h2></div>
      <div className="admin-v21-bulk">
        <button type="button" disabled={!compatible} aria-expanded={showSelection} aria-controls="admin-v21-selection" onClick={() => setShowSelection((current) => !current)}>Actions groupées <span aria-hidden="true">⌄</span></button>
        <small aria-live="polite">{selectedActions.length === 0 ? "Sélectionnez des dossiers de même type et état." : compatible ? `${selectedActions.length} dossier${selectedActions.length === 1 ? "" : "s"} compatible${selectedActions.length === 1 ? "" : "s"} · navigation seulement` : "Sélection incompatible : type ou état différent."}</small>
      </div>
    </div>
    {showSelection && compatible ? <div id="admin-v21-selection" className="admin-v21-selection" role="region" aria-label="Dossiers sélectionnés">
      <p>Aucune décision métier n’est appliquée en lot depuis le cockpit. Ouvrez chaque dossier pour utiliser ses actions autorisées.</p>
      <ul>{selectedActions.map((action) => <li key={action.key}><Link href={action.href}>{action.reference} <AdminIcon name="arrow" /></Link></li>)}</ul>
    </div> : null}
    {actions.length ? <div className="admin-v21-action-list" role="list">
      {actions.map((action) => <div className="admin-v21-action-row" role="listitem" key={action.key} data-priority={action.priority.toLowerCase()}>
        <label className="admin-v21-action-row__select"><input type="checkbox" checked={selected.has(action.key)} onChange={() => toggle(action.key)} aria-label={`Sélectionner ${action.reference}`} /></label>
        <span className="admin-v21-action-row__type"><small>Type</small><strong>{action.type}</strong></span>
        <span className="admin-v21-action-row__identity"><small>Référence</small><strong>{action.reference}</strong><em>{action.label}</em></span>
        <span className="admin-v21-action-row__status"><small>État</small><AdminStatusBadge label={action.priority === "CRITICAL" ? "Critique" : action.priority === "HIGH" ? "À examiner" : "À planifier"} tone={action.priority === "CRITICAL" ? "critical" : "attention"} /></span>
        <span className="admin-v21-action-row__date"><small>Date</small>{dateFormatter.format(new Date(action.date))}</span>
        <Link className="admin-v21-action-row__link" href={action.href} aria-label={`Ouvrir ${action.reference}`}>Traiter <AdminIcon name="arrow" /></Link>
      </div>)}
    </div> : <div className="admin-empty"><h3>Rien à traiter.</h3><p>Les traitements automatiques ne sont pas présentés comme des décisions humaines.</p></div>}
    {total > actions.length ? <p className="admin-v21-action-center__more">{actions.length} dossiers prioritaires affichés sur {total}. Consultez chaque espace pour la liste complète.</p> : null}
  </section>;
}
