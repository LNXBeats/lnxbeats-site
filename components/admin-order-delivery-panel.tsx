"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { deliveryFileSizeLabel, validateDeliveryFileSelection } from "@/lib/orders/delivery-file-selection";

type DeliverySummary = {
  id: string;
  assetType: "AUDIO" | "DOCUMENT" | "IMAGE";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  storageBackend: "LOCAL" | "OBJECT";
  storageProvider: string;
  visibility: "PUBLIC" | "PRIVATE";
  createdAt: string;
};

function formatDuration(durationMs: number | null) {
  if (!durationMs) return null;
  const seconds = Math.round(durationMs / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatMimeType(mimeType: string) {
  const labels: Record<string, string> = {
    "audio/mpeg": "MP3", "audio/wav": "WAV", "audio/flac": "FLAC",
    "application/zip": "ZIP", "application/pdf": "PDF",
    "image/jpeg": "JPEG", "image/png": "PNG",
  };
  return labels[mimeType] ?? "Fichier";
}

export function AdminOrderDeliveryPanel({ orderNumber, deliveries, canUpload, published, publishedAt }: {
  orderNumber: string;
  deliveries: DeliverySummary[];
  canUpload: boolean;
  published: boolean;
  publishedAt: string | null;
}) {
  const router = useRouter();
  const inputId = useId();
  const helpId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function upload() {
    if (!file || !canUpload) return;
    const validation = validateDeliveryFileSelection(file);
    if (!validation.ok) { setError(validation.message); return; }
    setBusy(true); setError(""); setMessage("Vérification et stockage privé en cours…");
    try {
      const body = new FormData();
      body.set("delivery", file, file.name);
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderNumber)}/delivery`, { method: "POST", body });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Le livrable n’a pas pu être enregistré.");
      setFile(null);
      setMessage("Livrable privé enregistré. Vous pouvez en ajouter un autre ou publier l’ensemble depuis l’action de statut.");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (caught) {
      setMessage(""); setError(caught instanceof Error ? caught.message : "Le livrable n’a pas pu être enregistré.");
    } finally { setBusy(false); }
  }

  async function remove(assetId: string) {
    if (!canUpload || published) return;
    setRemovingId(assetId); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderNumber)}/delivery/${encodeURIComponent(assetId)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Le livrable n’a pas pu être retiré.");
      setMessage("Livrable retiré avant publication. L’action a été inscrite dans l’historique interne.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Le livrable n’a pas pu être retiré.");
    } finally { setRemovingId(null); }
  }

  const selection = file ? validateDeliveryFileSelection(file) : null;
  const capacityReached = deliveries.length >= 8;

  return (
    <div className="admin-delivery-panel">
      <p className="admin-section-label">Livraison</p>
      <h2>{published ? "Livrables disponibles pour le client" : deliveries.length ? "Livrables prêts à publier" : "Aucun livrable"}</h2>
      {publishedAt ? <p>Publiée le {new Date(publishedAt).toLocaleString("fr-FR")}.</p> : null}
      {deliveries.length ? (
        <ul className="admin-delivery-panel__files">
          {deliveries.map((delivery, index) => {
            const duration = formatDuration(delivery.durationMs);
            return <li key={delivery.id}>
              <div className="admin-delivery-panel__file-heading"><strong>{index + 1}. {delivery.filename}</strong><span>{formatMimeType(delivery.mimeType)} · {deliveryFileSizeLabel(delivery.sizeBytes)}</span></div>
              <dl>
                {duration ? <div><dt>Durée</dt><dd>{duration}</dd></div> : null}
                {delivery.width && delivery.height ? <div><dt>Dimensions</dt><dd>{delivery.width} × {delivery.height} px</dd></div> : null}
                <div><dt>Ajout</dt><dd>{new Date(delivery.createdAt).toLocaleString("fr-FR")}</dd></div>
                <div><dt>Stockage</dt><dd>{delivery.storageBackend === "OBJECT" && delivery.storageProvider === "r2" && delivery.visibility === "PRIVATE" ? "R2 privé" : "Configuration à vérifier"}</dd></div>
              </dl>
              {delivery.assetType === "AUDIO" ? <audio controls preload="metadata" src={`/api/orders/${encodeURIComponent(orderNumber)}/delivery/${delivery.id}?lecture=1`}>Votre navigateur ne peut pas lire ce fichier audio.</audio> : null}
              <div className="admin-delivery-panel__file-actions">
                <a className="form-button" href={`/api/orders/${encodeURIComponent(orderNumber)}/delivery/${delivery.id}`}>Télécharger</a>
                {canUpload && !published ? <button className="form-button admin-danger-action" type="button" disabled={removingId !== null || busy} onClick={() => void remove(delivery.id)}>{removingId === delivery.id ? "Retrait…" : "Retirer avant publication"}</button> : null}
              </div>
            </li>;
          })}
        </ul>
      ) : <p>Ajoutez au moins un fichier avant de publier la livraison.</p>}

      {canUpload && !capacityReached ? (
        <div className="admin-delivery-panel__upload">
          <label className="admin-delivery-picker" htmlFor={inputId} data-has-file={file ? "true" : "false"}>
            <input ref={inputRef} className="admin-delivery-picker__input" id={inputId} type="file"
              accept="audio/mpeg,audio/mp3,audio/x-mpeg,audio/wav,audio/x-wav,audio/wave,audio/vnd.wave,audio/flac,audio/x-flac,application/zip,application/pdf,image/jpeg,image/png,.mp3,.wav,.flac,.zip,.pdf,.jpg,.jpeg,.png"
              aria-describedby={helpId} aria-invalid={selection?.ok === false} disabled={busy || removingId !== null}
              onChange={(event) => {
                const selected = event.currentTarget.files?.[0] ?? null;
                setFile(selected);
                const validation = selected ? validateDeliveryFileSelection(selected) : null;
                setError(validation && !validation.ok ? validation.message : ""); setMessage("");
              }} />
            <span className="admin-delivery-picker__content">
              <strong>Ajouter un livrable privé</strong><span>Master audio, archive, document ou visuel final</span>
              <small id={helpId}>MP3, WAV, FLAC, ZIP, PDF, JPEG ou PNG · 200 Mo maximum par fichier · 8 fichiers maximum</small>
              <span className="admin-delivery-picker__action" aria-hidden="true">Choisir un fichier</span>
            </span>
          </label>
          {file ? <dl className="admin-delivery-selection" aria-live="polite"><div><dt>Nom</dt><dd>{file.name}</dd></div><div><dt>Format</dt><dd>{selection?.ok ? selection.format : "Non pris en charge"}</dd></div><div><dt>Taille</dt><dd>{deliveryFileSizeLabel(file.size)}</dd></div></dl> : null}
          <p>Chaque fichier est vérifié côté serveur avant stockage R2 privé. Le dépôt n’envoie aucune notification ; la publication de l’ensemble reste une action séparée.</p>
          <button className="form-button form-button--primary" type="button" disabled={!file || selection?.ok !== true || busy || removingId !== null} onClick={() => void upload()}>{busy ? "Enregistrement…" : "Enregistrer ce livrable"}</button>
        </div>
      ) : published ? <p>La livraison publiée est immuable dans ce workflow.</p> : capacityReached ? <p>La limite de huit livrables est atteinte. Retirez un fichier avant publication pour en ajouter un autre.</p> : <p>Une commande payée et encore en cours est requise.</p>}
      {message ? <p className="form-message" role="status">{message}</p> : null}
      {error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
    </div>
  );
}
