"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { AudioPreviewPlayer } from "@/components/audio-preview-player";

const audioFeedback: Record<string, string> = {
  "audio-enregistre": "Extrait audio enregistré.",
  "audio-supprime": "Extrait audio supprimé.",
  "audio-trop-lourd": "Le fichier dépasse la limite de 80 Mo.",
  "audio-format": "Format non pris en charge. Utilisez un MP3 ou un WAV authentique.",
  "audio-illisible": "Ce fichier audio n’a pas pu être analysé.",
  "audio-generation": "Impossible de générer l’extrait.",
  "audio-debut": "Le début choisi dépasse la durée du morceau.",
  "audio-duree": "La durée de l’extrait doit être comprise entre 1 et 60 secondes.",
  "audio-vide": "Sélectionnez un morceau MP3 ou WAV avant de continuer.",
  "audio-droits": "Confirmez les droits de diffusion avant de continuer.",
  "audio-conflit": "L’extrait audio a été modifié depuis l’ouverture de cette fiche.",
  "audio-etat-actualise": "L’état de l’extrait est actualisé. Vérifiez votre sélection puis relancez la génération.",
  "audio-invalide": "La demande d’envoi est invalide. Sélectionnez de nouveau le fichier.",
  "audio-absent": "Aucun extrait audio actif n’a été trouvé.",
  "audio-erreur": "Impossible de générer l’extrait. Réessayez.",
};

type AudioResponse = {
  ok?: boolean;
  state?: string;
  location?: string;
  currentAudioAssetId?: string | null;
  durationMs?: number | null;
  adjustedToSourceEnd?: boolean;
};

const endpoint = "/api/admin/catalogue/audio";

function timeLabel(seconds: number) {
  const bounded = Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(bounded / 60)}:${String(bounded % 60).padStart(2, "0")}`;
}

export function CatalogAudioForm({
  projectId,
  slug,
  title,
  currentAudioAssetId,
  durationMs,
  updatedAt,
  initialState,
}: {
  projectId: string;
  slug: string;
  title: string;
  currentAudioAssetId: string | null;
  durationMs: number | null;
  updatedAt: string | null;
  initialState?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [state, setState] = useState(initialState);
  const [selectedFile, setSelectedFile] = useState<{ count: number; size: number; file: File } | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [sourceDurationSeconds, setSourceDurationSeconds] = useState(0);
  const [currentSourceTime, setCurrentSourceTime] = useState(0);
  const [offsetSeconds, setOffsetSeconds] = useState(0);
  const [previewDurationSeconds, setPreviewDurationSeconds] = useState(60);
  const [expectedAudioAssetId, setExpectedAudioAssetId] = useState(currentAudioAssetId);
  const [conflictingAudio, setConflictingAudio] = useState<{ known: boolean; assetId: string | null }>({ known: false, assetId: null });

  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);

  function handleFailure(payload: AudioResponse | null) {
    if (payload?.state === "audio-conflit" && Object.prototype.hasOwnProperty.call(payload, "currentAudioAssetId")) {
      setConflictingAudio({ known: true, assetId: payload.currentAudioAssetId ?? null });
    }
    setState(payload?.state && audioFeedback[payload.state] ? payload.state : "audio-erreur");
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending) return;
    const form = formRef.current;
    const input = fileInputRef.current;
    const file = input?.files?.[0];
    if (!form || !input || input.files?.length !== 1 || !(file instanceof File) || file.size <= 0) {
      setState("audio-vide");
      return;
    }
    const rights = form.elements.namedItem("rightsConfirmed");
    if (!(rights instanceof HTMLInputElement) || !rights.checked) {
      setState("audio-droits");
      return;
    }
    if (!sourceDurationSeconds || offsetSeconds < 0 || offsetSeconds >= sourceDurationSeconds) {
      setState("audio-debut");
      return;
    }

    setPending(true);
    setState(undefined);
    try {
      const body = new FormData();
      body.set("projectId", projectId);
      body.set("slug", slug);
      body.set("expectedAudioAssetId", expectedAudioAssetId ?? "");
      body.set("rightsConfirmed", "on");
      body.set("offsetMs", String(Math.round(offsetSeconds * 1_000)));
      body.set("requestedDurationMs", String(Math.round(previewDurationSeconds * 1_000)));
      body.set("audio", file, file.name);
      const result = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "x-lnx-audio-upload": "browser" },
        body,
      });
      const payload = result.headers.get("content-type")?.includes("application/json")
        ? await result.json() as AudioResponse
        : null;
      if (!result.ok || !payload?.ok) { handleFailure(payload); return; }
      const suffix = payload.adjustedToSourceEnd ? "&ajustee=fin" : "";
      router.push(`${payload.location ?? `/admin/catalogue/${encodeURIComponent(slug)}?etat=audio-enregistre`}${suffix}`);
    } catch {
      setState("audio-erreur");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (pending || !expectedAudioAssetId) return;
    setPending(true);
    setState(undefined);
    try {
      const result = await fetch(endpoint, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ projectId, slug, expectedAudioAssetId }),
      });
      const payload = result.headers.get("content-type")?.includes("application/json")
        ? await result.json() as AudioResponse
        : null;
      if (!result.ok || !payload?.ok) { handleFailure(payload); return; }
      router.push(payload.location ?? `/admin/catalogue/${encodeURIComponent(slug)}?etat=audio-supprime`);
    } catch {
      setState("audio-erreur");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="admin-audio-preview">
      {state && audioFeedback[state] ? <p className="admin-feedback" role="status">{audioFeedback[state]}</p> : null}
      {currentAudioAssetId ? (
        <div className="admin-audio-current">
          <AudioPreviewPlayer src={`/api/admin/catalogue/audio/${currentAudioAssetId}`} title={title} durationMs={durationMs} />
          <p>Extrait publié{updatedAt ? ` · mis à jour le ${new Date(updatedAt).toLocaleDateString("fr-FR")}` : ""}</p>
        </div>
      ) : <p className="admin-muted">Aucun extrait audio.</p>}

      <form ref={formRef} className="admin-catalogue-form" onSubmit={submit} data-selected-file-count={selectedFile?.count ?? 0} data-selected-file-size={selectedFile?.size ?? 0}>
        <div className="admin-audio-guidance">
          <strong>{currentAudioAssetId ? "Remplacer l’extrait" : "Ajouter un extrait"}</strong>
          <p>Ajoutez votre morceau complet en MP3 ou WAV. LNX Studio générera un extrait de 60 secondes maximum.</p>
        </div>
        <label>
          <span>Choisir le morceau · MP3 ou WAV · 80 Mo max.</span>
          <input
            ref={fileInputRef}
            name="audio"
            type="file"
            accept="audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
            required
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              setSelectedFile(file ? { count: event.currentTarget.files?.length ?? 0, size: file.size, file } : null);
              setLocalUrl(file ? URL.createObjectURL(file) : null);
              setSourceDurationSeconds(0);
              setCurrentSourceTime(0);
              setOffsetSeconds(0);
              setPreviewDurationSeconds(60);
              setState((current) => current === "audio-conflit" ? current : undefined);
            }}
          />
        </label>
        {localUrl && selectedFile ? <div className="admin-audio-local">
          <span>Morceau sélectionné · {selectedFile.file.name}</span>
          <p>Durée du morceau : <strong>{sourceDurationSeconds ? timeLabel(sourceDurationSeconds) : "analyse locale…"}</strong></p>
          <AudioPreviewPlayer
            src={localUrl}
            title={`Source locale de ${title}`}
            onTimeUpdate={setCurrentSourceTime}
            onDuration={(seconds) => {
              setSourceDurationSeconds(seconds);
              setPreviewDurationSeconds(Math.min(60, Math.max(1, Math.floor(seconds))));
            }}
          />
          <div className="admin-audio-selection-grid">
            <label>
              <span>Début de l’extrait</span>
              <input type="number" min="0" max={Math.max(0, Math.floor(sourceDurationSeconds) - 1)} step="1" value={offsetSeconds} onChange={(event) => setOffsetSeconds(Math.max(0, Number(event.currentTarget.value) || 0))} />
              <small>{timeLabel(offsetSeconds)}</small>
            </label>
            <label>
              <span>Durée de l’extrait</span>
              <input type="number" min="1" max="60" step="1" value={previewDurationSeconds} onChange={(event) => setPreviewDurationSeconds(Math.min(60, Math.max(1, Number(event.currentTarget.value) || 1)))} />
              <small>{previewDurationSeconds} s maximum ; ajustée automatiquement à la fin du morceau.</small>
            </label>
          </div>
          <button type="button" onClick={() => setOffsetSeconds(Math.floor(currentSourceTime))}>Utiliser la position actuelle comme début</button>
        </div> : null}
        <label className="admin-checkbox">
          <input name="rightsConfirmed" type="checkbox" required />
          <span>Je confirme disposer des droits nécessaires pour diffuser cet extrait audio.</span>
        </label>
        {state === "audio-conflit" && conflictingAudio.known ? <button type="button" disabled={pending} onClick={() => {
          setExpectedAudioAssetId(conflictingAudio.assetId);
          setConflictingAudio({ known: false, assetId: null });
          setState("audio-etat-actualise");
        }}>Actualiser l’état de l’extrait</button> : null}
        <button type="button" disabled={pending || !sourceDurationSeconds} onClick={() => void submit()}>{pending ? "Création de l’extrait…" : currentAudioAssetId ? "Générer et remplacer l’extrait" : "Générer et publier l’extrait"}</button>
      </form>

      {currentAudioAssetId ? <details className="admin-audio-delete">
        <summary>Supprimer l’extrait</summary>
        <p>Le lecteur disparaîtra du site public. Cette action ne modifie ni le projet ni les pistes.</p>
        <button type="button" disabled={pending} onClick={() => void remove()}>Confirmer la suppression</button>
      </details> : null}
    </div>
  );
}
