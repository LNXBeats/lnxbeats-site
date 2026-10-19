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
    <div className="revenue-actions"><a className="admin-button" href={`/api/admin/recettes/export?${new URLSearchParams({ du: from, au: to, mode })}`}>Exporter le détail CSV</a><button className="admin-button" type="button" onClick={() => window.print()}>Imprimer / enregistrer en PDF</button></div>
    <p>Le CSV est modifiable dans votre tableur. Les factures d’origine et les écritures du site ne sont jamais modifiées.</p>
  </section>;
}
