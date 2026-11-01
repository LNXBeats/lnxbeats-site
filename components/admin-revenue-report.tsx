"use client";
import { useState } from "react";

/** Editable cover/notes only. Never changes the ledger, invoices or contracts. */
export function AdminRevenueReport({ from, to, mode }: { from: string; to: string; mode: string }) {
  const [title, setTitle] = useState("Récapitulatif des recettes — LNX Beats");
  const [notes, setNotes] = useState("");
  return <section className="admin-panel revenue-report-cover">
    <label htmlFor="revenue-title">Titre du récapitulatif<input id="revenue-title" value={title} maxLength={160} onChange={e => setTitle(e.target.value)} /></label>
    <label htmlFor="revenue-notes">Notes personnelles (non enregistrées)<textarea id="revenue-notes" value={notes} maxLength={3000} onChange={e => setNotes(e.target.value)} placeholder="Observations destinées à votre comptable…" /></label>
    <div className="revenue-print-cover"><h1>{title}</h1><p>{from} au {to} · {mode} · Europe/Paris</p>{notes ? <p style={{ whiteSpace: "pre-wrap" }}>{notes}</p> : null}</div>
    <div className="revenue-actions"><a className="admin-button" href={`/api/admin/recettes/export?${new URLSearchParams({ du: from, au: to, mode })}`}>Exporter le détail CSV</a>{mode === "LIVE" ? <><a className="admin-button" href={`/api/admin/recettes/gestion?${new URLSearchParams({ du: from, au: to })}`}>Exporter les références Gestion</a><a className="admin-button" href={`/api/admin/recettes/gestion/package?${new URLSearchParams({ du: from, au: to })}`}>Exporter avec factures et avoirs</a></> : null}<button className="admin-button" type="button" onClick={() => window.print()}>Imprimer / enregistrer en PDF</button></div>
    <p>Le CSV est modifiable dans votre tableur. Les écritures et les snapshots du site ne sont jamais modifiés.</p>
    {mode === "LIVE" ? <p>Le paquet documentaire LNX Gestion ajoute les PDF vérifiés, leurs empreintes et les liens avoir–facture. Pour les commandes et la boutique, le PDF est rendu à la demande depuis le snapshot enregistré&nbsp;: il n’est pas présenté comme une copie octet pour octet d’un fichier historique. Les documents numériques déjà persistés conservent leurs octets vérifiés. Gestion archive ces pièces en privé sans créer d’écriture comptable ni inventer un traitement fiscal. Les justificatifs incertains restent à contrôler. Les soutiens, licences Rights et recettes externes restent à rapprocher séparément.</p> : null}
  </section>;
}
