"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { PRODUCT_IMAGE_DELETION_CONFIRMATION } from "@/lib/shop/product-domain";

const PRODUCT_IMAGE_MAXIMUM_BYTES = 10 * 1024 * 1024;

const feedback: Record<string, string> = {
  "image-enregistree": "Le visuel du produit est enregistré.",
  "image-alt-enregistre": "Le texte alternatif est enregistré.",
  "image-supprimee": "Le visuel du produit est supprimé.",
  "image-trop-lourde": "Le fichier dépasse la limite de 10 Mo.",
  "image-format": "Format refusé. Choisissez un JPEG, PNG ou WebP authentique.",
  "image-illisible": "Cette image est illisible ou corrompue.",
  "image-dimensions": "Cette image dépasse la limite de 40 millions de pixels.",
  "image-vide": "Choisissez une image avant de continuer.",
  "image-droits": "Confirmez les droits de publication avant l’envoi.",
  "image-alt": "Renseignez un texte alternatif de 1 à 500 caractères.",
  "image-partagee": "Ce visuel est partagé. Remplacez-le avant de modifier son texte alternatif.",
  "image-conflit": "Le visuel a changé. Rechargez la fiche avant de réessayer.",
  "image-produit-publie": "Dépubliez d’abord le produit pour modifier son visuel.",
  "image-produit-absent": "Ce produit est introuvable.",
  "image-confirmation": "Confirmez explicitement la suppression du visuel.",
  "image-invalide": "La demande est invalide. Sélectionnez de nouveau l’image.",
  "image-erreur": "Impossible d’enregistrer le visuel. Réessayez.",
};

type ProductImageResponse = {
  ok?: boolean;
  state?: string;
  location?: string;
  assetId?: string;
  currentAssetId?: string | null;
  currentLockVersion?: number;
};

type CurrentImage = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: string;
  width: number | null;
  height: number | null;
  alt: string;
  updatedAt: string;
};

function formatBytes(value: number) {
  if (value < 1_024) return `${value} octets`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Ko`;
  return `${(value / (1_024 * 1_024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

async function responsePayload(response: Response) {
  return response.headers.get("content-type")?.includes("application/json")
    ? await response.json() as ProductImageResponse
    : null;
}

export function AdminProductImageForm({
  productId,
  lockVersion,
  productTitle,
  currentImage,
  status,
  initialState,
}: {
  productId: string;
  lockVersion: number;
  productTitle: string;
  currentImage: CurrentImage | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  initialState?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<{ file: File; url: string } | null>(null);
  const [pending, setPending] = useState<"upload" | "alt" | "delete" | null>(null);
  const [state, setState] = useState(initialState);
  const [alt, setAlt] = useState(currentImage?.alt || productTitle);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const endpoint = `/api/admin/boutique/products/${encodeURIComponent(productId)}/image`;
  const editable = status === "DRAFT";

  useEffect(() => () => {
    if (selected) URL.revokeObjectURL(selected.url);
  }, [selected]);

  function chooseFile(file: File | null) {
    setSelected((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return file ? { file, url: URL.createObjectURL(file) } : null;
    });
    setState(undefined);
  }

  async function upload(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending || !editable) return;
    const file = selected?.file ?? fileInputRef.current?.files?.[0];
    const form = formRef.current;
    if (!file || file.size <= 0 || !form) {
      setState("image-vide");
      return;
    }
    if (file.size > PRODUCT_IMAGE_MAXIMUM_BYTES) {
      setState("image-trop-lourde");
      return;
    }
    if (!alt.trim()) {
      setState("image-alt");
      return;
    }
    const rights = form.elements.namedItem("rightsConfirmed");
    if (!(rights instanceof HTMLInputElement) || !rights.checked) {
      setState("image-droits");
      return;
    }

    setPending("upload");
    setState(undefined);
    try {
      // Safari can expose valid File metadata while transmitting an empty
      // multipart body. Materializing the bytes closes that WebKit failure.
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength <= 0 || bytes.byteLength !== file.size) {
        setState("image-invalide");
        return;
      }
      const materialized = new File([bytes], file.name, {
        type: file.type,
        lastModified: file.lastModified,
      });
      const body = new FormData();
      body.set("expectedLockVersion", String(lockVersion));
      body.set("expectedAssetId", currentImage?.id ?? "");
      body.set("alt", alt);
      body.set("rightsConfirmed", "on");
      body.set("image", materialized, materialized.name);
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "x-lnx-product-image-upload": "browser" },
        body,
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload?.ok) {
        setState(payload?.state && feedback[payload.state] ? payload.state : "image-erreur");
        return;
      }
      window.location.assign(payload.location ?? window.location.href);
    } catch {
      setState("image-erreur");
    } finally {
      setPending(null);
    }
  }

  async function saveAlt() {
    if (pending || !editable || !currentImage) return;
    if (!alt.trim()) {
      setState("image-alt");
      return;
    }
    setPending("alt");
    setState(undefined);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ expectedLockVersion: lockVersion, expectedAssetId: currentImage.id, alt }),
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload?.ok) {
        setState(payload?.state && feedback[payload.state] ? payload.state : "image-erreur");
        return;
      }
      window.location.assign(payload.location ?? window.location.href);
    } catch {
      setState("image-erreur");
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (pending || !editable || !currentImage || !deleteConfirmed) {
      setState("image-confirmation");
      return;
    }
    setPending("delete");
    setState(undefined);
    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          expectedLockVersion: lockVersion,
          expectedAssetId: currentImage.id,
          confirmation: PRODUCT_IMAGE_DELETION_CONFIRMATION,
        }),
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload?.ok) {
        setState(payload?.state && feedback[payload.state] ? payload.state : "image-erreur");
        return;
      }
      window.location.assign(payload.location ?? window.location.href);
    } catch {
      setState("image-erreur");
    } finally {
      setPending(null);
    }
  }

  const preview = selected?.url ?? (currentImage
    ? `${endpoint}?version=${encodeURIComponent(currentImage.updatedAt)}`
    : null);

  return <div className="admin-product-image">
    {state && feedback[state] ? <p className="admin-feedback" role="status">{feedback[state]}</p> : null}
    {preview ? <div className="admin-product-image__preview">
      {/* This authenticated source intentionally bypasses the Next image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview} alt={selected ? "Aperçu local du visuel sélectionné" : currentImage?.alt || productTitle} />
      <div>
        <strong>{selected ? "Aperçu avant enregistrement" : "Visuel principal actuel"}</strong>
        {selected ? <dl className="admin-product-image__facts">
          <div><dt>Nom</dt><dd>{selected.file.name}</dd></div>
          <div><dt>Type</dt><dd>{selected.file.type || "Non déclaré"}</dd></div>
          <div><dt>Taille</dt><dd>{formatBytes(selected.file.size)}</dd></div>
        </dl> : currentImage ? <dl className="admin-product-image__facts">
          <div><dt>Fichier</dt><dd>{currentImage.filename}</dd></div>
          <div><dt>Format</dt><dd>{currentImage.mimeType}</dd></div>
          <div><dt>Dimensions</dt><dd>{currentImage.width && currentImage.height ? `${currentImage.width} × ${currentImage.height} px` : "Non renseignées"}</dd></div>
          <div><dt>Taille</dt><dd>{formatBytes(Number(currentImage.sizeBytes))}</dd></div>
        </dl> : null}
      </div>
    </div> : <p className="admin-alert">Aucun visuel.</p>}

    {editable ? <form ref={formRef} className="admin-catalogue-form" onSubmit={upload}>
      <label className="admin-delivery-picker admin-product-image__picker">
        <input
          ref={fileInputRef}
          className="admin-delivery-picker__input"
          name="image"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={pending !== null}
          onChange={(event) => chooseFile(event.currentTarget.files?.length === 1 ? event.currentTarget.files[0] ?? null : null)}
        />
        <span className="admin-delivery-picker__content">
          <strong>{currentImage ? "Remplacer le visuel" : "Choisir une image"}</strong>
          <span>{selected?.file.name ?? "JPEG, PNG ou WebP"}</span>
          <small>10 Mo maximum · 40 millions de pixels maximum</small>
          <span className="admin-delivery-picker__action">Parcourir les fichiers</span>
        </span>
      </label>
      <label>
        <span>Texte alternatif</span>
        <input value={alt} onChange={(event) => setAlt(event.currentTarget.value)} maxLength={500} required />
        <small>Décrivez brièvement ce qui est visible. Ce texte est obligatoire avant publication.</small>
      </label>
      <label className="admin-checkbox">
        <input name="rightsConfirmed" type="checkbox" required={Boolean(selected)} disabled={!selected || pending !== null} />
        <span>Je confirme disposer des droits nécessaires pour publier cette image.</span>
      </label>
      <div className="admin-product-image__actions">
        <button type="submit" disabled={!selected || pending !== null}>
          {pending === "upload" ? "Enregistrement…" : "Enregistrer le visuel"}
        </button>
        {currentImage && !selected ? <button type="button" className="admin-button admin-button--quiet" disabled={pending !== null || alt.trim() === currentImage.alt} onClick={() => void saveAlt()}>
          {pending === "alt" ? "Enregistrement…" : "Enregistrer le texte alternatif"}
        </button> : null}
      </div>
    </form> : <p className="admin-alert">{status === "PUBLISHED" ? "Dépubliez d’abord le produit pour remplacer ou supprimer son visuel." : "Un produit archivé est conservé en lecture seule."}</p>}

    {editable && currentImage ? <details className="admin-product-image__delete">
      <summary>Supprimer le visuel</summary>
      <p>Le produit restera en brouillon et ne pourra pas être publié sans nouveau visuel admissible.</p>
      <label className="admin-checkbox">
        <input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.currentTarget.checked)} />
        <span>Je confirme la suppression de ce visuel.</span>
      </label>
      <button type="button" disabled={!deleteConfirmed || pending !== null} onClick={() => void remove()}>
        {pending === "delete" ? "Suppression…" : "Supprimer le visuel"}
      </button>
    </details> : null}
  </div>;
}
