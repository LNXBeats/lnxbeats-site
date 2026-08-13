"use client";

import { useRef, useState, type FormEvent } from "react";

const coverFeedback: Record<string, string> = {
  "cover-enregistree": "Cover enregistrée.",
  "cover-trop-lourde": "Le fichier dépasse la limite de 10 Mo.",
  "cover-format": "Format non pris en charge. Utilisez un JPEG, PNG ou WebP authentique.",
  "cover-illisible": "Cette image n’a pas pu être lue.",
  "cover-dimensions": "Cette image dépasse la limite de 40 millions de pixels.",
  "cover-vide": "Sélectionnez une image avant de continuer.",
  "cover-droits": "Confirmez les droits de publication avant de continuer.",
  "cover-conflit": "La cover a été modifiée depuis l’ouverture de cette fiche.",
  "cover-etat-actualise": "L’état de la cover est actualisé. Vérifiez votre sélection puis relancez l’envoi.",
  "cover-invalide": "La demande d’envoi est invalide. Sélectionnez de nouveau l’image.",
  "cover-erreur": "Impossible d’enregistrer la cover. Réessayez.",
  "cover-supprimee": "La cover est supprimée. Le visuel de repli public est de nouveau utilisé.",
  "cover-suppression-refusee": "La cover n’a pas été supprimée. Rechargez la fiche pour vérifier son état actuel.",
};

type CoverResponse = {
  ok?: boolean;
  state?: string;
  location?: string;
  currentCoverAssetId?: string | null;
};

const coverUploadEndpoint = "/api/admin/catalogue/cover";

export function CatalogCoverForm({
  projectId,
  slug,
  currentCoverAssetId,
  alt,
  altPlaceholder,
  hasCover,
  initialState,
}: {
  projectId: string;
  slug: string;
  currentCoverAssetId: string | null;
  alt: string;
  altPlaceholder: string;
  hasCover: boolean;
  initialState?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [state, setState] = useState(initialState);
  const [selectedFile, setSelectedFile] = useState<{ count: number; size: number } | null>(null);
  const [expectedCoverAssetId, setExpectedCoverAssetId] = useState(currentCoverAssetId);
  const [coverPresent, setCoverPresent] = useState(hasCover);
  const [conflictingCover, setConflictingCover] = useState<{ known: boolean; assetId: string | null }>({ known: false, assetId: null });

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending) return;

    const form = formRef.current;
    const input = fileInputRef.current;
    const file = input?.files?.[0];
    if (!form || !input || input.files?.length !== 1 || !(file instanceof File) || file.size <= 0) {
      setState("cover-vide");
      return;
    }

    const rights = form.elements.namedItem("rightsConfirmed");
    if (!(rights instanceof HTMLInputElement) || !rights.checked) {
      setState("cover-droits");
      return;
    }

    setPending(true);
    setState(undefined);
    try {
      // Materialize the selected Safari File before constructing FormData.
      // The real Safari failure exposed File metadata but transmitted a
      // multipart request with Content-Length: 0.
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength <= 0 || bytes.byteLength !== file.size) {
        setState("cover-invalide");
        return;
      }
      const uploadFile = new File([bytes], file.name, { type: file.type, lastModified: file.lastModified });
      const altInput = form.elements.namedItem("alt");
      const body = new FormData();
      body.set("projectId", projectId);
      body.set("slug", slug);
      body.set("expectedCoverAssetId", expectedCoverAssetId ?? "");
      body.set("rightsConfirmed", "on");
      body.set("alt", altInput instanceof HTMLInputElement ? altInput.value : "");
      body.set("cover", uploadFile, uploadFile.name);
      const response = await fetch(coverUploadEndpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "x-lnx-cover-upload": "browser",
        },
        body,
      });
      const payload = response.headers.get("content-type")?.includes("application/json")
        ? await response.json() as CoverResponse
        : null;

      if (!response.ok || !payload?.ok) {
        if (payload?.state === "cover-conflit" && Object.prototype.hasOwnProperty.call(payload, "currentCoverAssetId")) {
          setConflictingCover({ known: true, assetId: payload.currentCoverAssetId ?? null });
        }
        setState(payload?.state && coverFeedback[payload.state] ? payload.state : "cover-erreur");
        return;
      }

      window.location.assign(payload.location ?? `/admin/catalogue/${encodeURIComponent(slug)}?etat=cover-enregistree`);
    } catch {
      setState("cover-erreur");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {state && coverFeedback[state] ? <p className="admin-feedback" role="status">{coverFeedback[state]}</p> : null}
      <form
        ref={formRef}
        className="admin-catalogue-form"
        onSubmit={submit}
        data-selected-file-count={selectedFile?.count ?? 0}
        data-selected-file-size={selectedFile?.size ?? 0}
      >
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="expectedCoverAssetId" value={expectedCoverAssetId ?? ""} />
        <div className="admin-form-grid">
          <label className="admin-form-wide">
            <span>Choisir le fichier · JPEG, PNG ou WebP · 10 Mo max.</span>
            <input
              ref={fileInputRef}
              name="cover"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              required
              onChange={(event) => {
                const current = event.currentTarget.files?.[0];
                setSelectedFile(current ? { count: event.currentTarget.files?.length ?? 0, size: current.size } : null);
                setState((currentState) => currentState === "cover-conflit" ? currentState : undefined);
              }}
            />
          </label>
          <label className="admin-checkbox admin-form-wide">
            <input name="rightsConfirmed" type="checkbox" required />
            <span>Je confirme disposer des droits nécessaires pour publier cette image.</span>
          </label>
        </div>
        <details className="admin-secondary-fields">
          <summary>Options avancées</summary>
          <div>
            <label>
              <span>Personnaliser le texte alternatif</span>
              <input name="alt" maxLength={500} defaultValue={alt} placeholder={altPlaceholder} />
              <small>Sans personnalisation : {altPlaceholder}</small>
            </label>
          </div>
        </details>
        {state === "cover-conflit" && conflictingCover.known ? <button type="button" disabled={pending} onClick={() => {
          setExpectedCoverAssetId(conflictingCover.assetId);
          setCoverPresent(conflictingCover.assetId !== null);
          setConflictingCover({ known: false, assetId: null });
          setState("cover-etat-actualise");
        }}>Actualiser l’état de la cover</button> : null}
        <button type="button" disabled={pending} onClick={() => void submit()}>{pending ? "Enregistrement…" : coverPresent ? "Remplacer la cover" : "Ajouter la cover"}</button>
      </form>
    </>
  );
}
