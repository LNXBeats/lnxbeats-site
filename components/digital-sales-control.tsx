"use client";
import { useState } from "react";
import type { DigitalSalesControl } from "@/lib/digital/sales-control";
import styles from "./digital.module.css";

export function DigitalSalesControlPanel({ initial, configured }: { initial: DigitalSalesControl; configured: boolean }) {
  const [state, setState] = useState(initial), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function toggle() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/digital/sales-control", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !state.enabled, expectedEventId: state.eventId, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.code === "STALE_SALES_CONTROL" ? "L’état a changé. Actualisez cette page avant de recommencer." : result.error ?? "Changement indisponible.");
      setState(result); setMessage(result.enabled ? "Les nouveaux achats sont autorisés si la configuration LIVE est ouverte." : "Nouveaux achats suspendus. Les acquisitions existantes sont conservées.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Changement indisponible."); }
    finally { setBusy(false); }
  }
  return <section className={styles.panel} aria-labelledby="digital-sales-control"><h2 id="digital-sales-control">Nouveaux achats numériques</h2>
    <p>{configured && state.enabled ? "Ouverts pour les offres éligibles." : "Suspendus."}{state.reviewRequired ? " Dernière instruction à vérifier." : ""}</p>
    <p className={styles.note}>La suspension bloque les nouvelles commandes côté serveur, sans retirer les téléchargements acquis. Les paiements déjà engagés restent rapprochés ; ils ne sont pas annulés automatiquement.</p>
    {!configured ? <p className={styles.note}>L’ouverture nécessite aussi la configuration LIVE de l’hébergement.</p> : null}
    <button type="button" className="admin-row-action" disabled={busy} onClick={() => void toggle()}>{busy ? "Enregistrement…" : state.enabled ? "Suspendre les nouveaux achats" : "Autoriser les nouveaux achats"}</button>
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
