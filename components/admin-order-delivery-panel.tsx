"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { deliveryFileSizeLabel, validateDeliveryFileSelection } from "@/lib/orders/delivery-file-selection";

type DeliverySummary = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  createdAt: string;
};

function formatDuration(durationMs: number | null) {
  if (!durationMs) return "Durée non documentée";
  const seconds = Math.round(durationMs / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function AdminOrderDeliveryPanel({
  orderNumber,
  delivery,
  canUpload,
  published,
}: {
  orderNumber: string;
  delivery: DeliverySummary | null;
  canUpload: boolean;
  published: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const helpId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function upload() {
    if (!file || !canUpload) return;
    const validation = validateDeliveryFileSelection(file);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Vérification et stockage privé en cours…");
    try {
      const body = new FormData();
      body.set("delivery", file, file.name);
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderNumber)}/delivery`, {
        method: "POST",
        body,
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Le master n’a pas pu être enregistré.");
      setFile(null);
      setMessage(delivery ? "Master remplacé et remplacement audité." : "Master privé enregistré. Publiez-le depuis l’action de statut quand la finalisation est terminée.");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (caught) {
      setMessage("");
      setError(caught instanceof Error ? caught.message : "Le master n’a pas pu être enregistré.");
    } finally {
      setBusy(false);
    }
  }

  const selection = file ? validateDeliveryFileSelection(file) : null;

  return (
    <div className="admin-delivery-panel">
      <p className="admin-section-label">Livraison</p>
      <h2>{published ? "Disponible pour le client" : delivery ? "Master prêt à publier" : "Non disponible"}</h2>
      {delivery ? (
        <>
          <dl>
            <div><dt>Fichier</dt><dd>{delivery.filename}</dd></div>
            <div><dt>Format</dt><dd>{delivery.mimeType === "audio/wav" ? "WAV" : "MP3"}</dd></div>
            <div><dt>Taille</dt><dd>{(delivery.sizeBytes / (1024 * 1024)).toFixed(1)} Mo</dd></div>
            <div><dt>Durée</dt><dd>{formatDuration(delivery.durationMs)}</dd></div>
            <div><dt>Ajout</dt><dd>{new Date(delivery.createdAt).toLocaleString("fr-FR")}</dd></div>
          </dl>
          <audio controls preload="metadata" src={`/api/orders/${encodeURIComponent(orderNumber)}/delivery/${delivery.id}?lecture=1`}>Votre navigateur ne peut pas lire ce fichier audio.</audio>
          <a className="form-button" href={`/api/orders/${encodeURIComponent(orderNumber)}/delivery/${delivery.id}`}>Télécharger le master</a>
        </>
      ) : <p>Aucun master audio n’est lié à cette commande.</p>}

      {canUpload ? (
        <div className="admin-delivery-panel__upload">
          <label className="admin-delivery-picker" htmlFor={inputId} data-has-file={file ? "true" : "false"}>
            <input
              ref={inputRef}
              className="admin-delivery-picker__input"
              id={inputId}
              type="file"
              accept="audio/mpeg,audio/mp3,audio/x-mpeg,audio/wav,audio/x-wav,audio/wave,audio/vnd.wave,.mp3,.wav"
              aria-describedby={helpId}
              aria-invalid={selection?.ok === false}
              disabled={busy}
              onChange={(event) => {
                const selected = event.currentTarget.files?.[0] ?? null;
                setFile(selected);
                const validation = selected ? validateDeliveryFileSelection(selected) : null;
                setError(validation && !validation.ok ? validation.message : "");
                setMessage("");
              }}
            />
            <span className="admin-delivery-picker__content">
              <strong>Master audio final</strong>
              <span>{delivery ? "Choisir un nouveau master privé" : "Déposer le master final"}</span>
              <small id={helpId}>MP3 ou WAV · maximum 200 Mo · stockage R2 privé</small>
              <span className="admin-delivery-picker__action" aria-hidden="true">Choisir un fichier</span>
            </span>
          </label>
          {file ? (
            <dl className="admin-delivery-selection" aria-live="polite">
              <div><dt>Nom</dt><dd>{file.name}</dd></div>
              <div><dt>Format</dt><dd>{selection?.ok ? selection.format : "Non pris en charge"}</dd></div>
              <div><dt>Taille</dt><dd>{deliveryFileSizeLabel(file.size)}</dd></div>
            </dl>
          ) : null}
          <p>Le remplacement est enregistré dans l’historique interne. Le serveur vérifie le type réel, la signature et le décodage audio complet avant stockage.</p>
          <button className="form-button form-button--primary" type="button" disabled={!file || selection?.ok !== true || busy} onClick={() => void upload()}>
            {busy ? "Enregistrement…" : delivery ? "Remplacer le master" : "Enregistrer le master"}
          </button>
        </div>
      ) : published ? <p>La livraison publiée ne peut plus être remplacée depuis ce workflow.</p> : <p>Une commande payée et encore en cours est requise.</p>}
      {message ? <p className="form-message" role="status">{message}</p> : null}
      {error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
    </div>
  );
}
