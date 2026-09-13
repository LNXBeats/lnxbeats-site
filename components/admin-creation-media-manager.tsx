"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  CREATION_AUDIO_MAXIMUM_BYTES,
  CREATION_IMAGE_MAXIMUM_BYTES,
  CREATION_MEDIA_DELETION_CONFIRMATION,
  CREATION_VIDEO_MAXIMUM_BYTES,
  type CreationMediaRole,
} from "@/lib/creations/media-contract";

const endpoint = "/api/admin/creations/media";

const ROLE_DETAILS: Record<CreationMediaRole, {
  label: string;
  accept: string;
  hint: string;
  maximumBytes: number;
}> = {
  COVER: { label: "Cover", accept: "image/jpeg,image/png,image/webp", hint: "JPEG, PNG ou WebP · 10 Mo max.", maximumBytes: CREATION_IMAGE_MAXIMUM_BYTES },
  VIDEO_POSTER: { label: "Poster vidéo", accept: "image/jpeg,image/png,image/webp", hint: "JPEG, PNG ou WebP · 10 Mo max.", maximumBytes: CREATION_IMAGE_MAXIMUM_BYTES },
  AUDIO: { label: "Audio", accept: "audio/mpeg,.mp3", hint: "MP3 authentique · 80 Mo max.", maximumBytes: CREATION_AUDIO_MAXIMUM_BYTES },
  VIDEO: { label: "Vidéo", accept: "video/mp4,.mp4", hint: "MP4 H.264/AAC · 20 min et 200 Mo max.", maximumBytes: CREATION_VIDEO_MAXIMUM_BYTES },
};

const feedback: Record<string, string> = {
  "media-enregistre": "Le média a été enregistré.",
  "media-supprime": "Le média a été supprimé.",
  "media-trop-lourd": "Le fichier dépasse la limite autorisée pour cet emplacement.",
  "media-vide": "Choisissez un fichier avant de continuer.",
  "media-format": "Le format réel du fichier ne correspond pas au format autorisé.",
  "media-illisible": "Le média est illisible, corrompu ou utilise un codec non pris en charge.",
  "media-invalide": "La demande média est invalide. Rechargez la fiche puis réessayez.",
  "media-droits": "Confirmez les droits de diffusion avant l’envoi.",
  "media-conflit": "Le média ou la fiche a changé dans un autre onglet. Rechargez cette page.",
  "media-creation-absente": "Cette création est introuvable.",
  "media-creation-archivee": "Une création archivée est en lecture seule.",
  "media-absent": "Ce média n’existe plus. Rechargez la fiche.",
  "media-publication-bloquee": "Cette suppression rendrait une création publiée incomplète. Dépubliez-la ou choisissez d’abord un autre média principal.",
  "media-stockage": "Le stockage n’a pas confirmé l’intégrité du média.",
  "media-confirmation": "Confirmez explicitement la suppression du média.",
  "media-erreur": "Impossible de traiter ce média. Réessayez.",
};

export type AdminCreationMedia = {
  role: CreationMediaRole;
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  alt: string | null;
  updatedAt: string;
};

type MediaResponse = {
  ok?: boolean;
  state?: string;
  location?: string;
  currentAssetId?: string | null;
  currentLockVersion?: number;
};

function formatBytes(value: number) {
  if (value < 1_024) return `${value} octets`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Ko`;
  return `${(value / (1_024 * 1_024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

function formatDuration(durationMs: number | null) {
  if (!durationMs || durationMs <= 0) return "Non renseignée";
  const seconds = Math.round(durationMs / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function payload(response: Response) {
  return response.headers.get("content-type")?.includes("application/json")
    ? await response.json() as MediaResponse
    : null;
}

function CurrentPreview({ media, title }: { media: AdminCreationMedia; title: string }) {
  const source = `/api/admin/creations/media/${encodeURIComponent(media.id)}?version=${encodeURIComponent(media.updatedAt)}`;
  if (media.role === "COVER" || media.role === "VIDEO_POSTER") {
    return <div className="admin-product-image__preview">
      {/* Authenticated media intentionally bypasses the public image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={source} alt={media.alt || `Visuel de ${title}`} />
    </div>;
  }
  if (media.role === "AUDIO") {
    return <audio controls preload="metadata" src={source} aria-label={`Écouter ${title} dans l’administration`} />;
  }
  return <video controls playsInline preload="metadata" src={source} aria-label={`Voir ${title} dans l’administration`} />;
}

function LocalPreview({ role, url, title }: { role: CreationMediaRole; url: string; title: string }) {
  if (role === "COVER" || role === "VIDEO_POSTER") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={`Aperçu local du ${ROLE_DETAILS[role].label.toLowerCase()} de ${title}`} />;
  }
  if (role === "AUDIO") return <audio controls preload="metadata" src={url} aria-label="Aperçu audio local" />;
  return <video controls playsInline preload="metadata" src={url} aria-label="Aperçu vidéo local" />;
}

function MediaEditor({
  creationId,
  slug,
  title,
  lockVersion,
  role,
  current,
  editable,
}: {
  creationId: string;
  slug: string;
  title: string;
  lockVersion: number;
  role: CreationMediaRole;
  current: AdminCreationMedia | null;
  editable: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<{ file: File; url: string } | null>(null);
  const [state, setState] = useState<string>();
  const [pending, setPending] = useState<"upload" | "delete" | null>(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [alt, setAlt] = useState(current?.alt ?? title);
  const details = ROLE_DETAILS[role];

  useEffect(() => () => {
    if (selected) URL.revokeObjectURL(selected.url);
  }, [selected]);

  function choose(file: File | null) {
    setSelected((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return file ? { file, url: URL.createObjectURL(file) } : null;
    });
    setState(undefined);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !editable) return;
    const file = selected?.file ?? inputRef.current?.files?.[0];
    const form = formRef.current;
    if (!file || file.size <= 0 || !form) {
      setState("media-vide");
      return;
    }
    if (file.size > details.maximumBytes) {
      setState("media-trop-lourd");
      return;
    }
    const rights = form.elements.namedItem("rightsConfirmed");
    if (!(rights instanceof HTMLInputElement) || !rights.checked) {
      setState("media-droits");
      return;
    }
    setPending("upload");
    setState(undefined);
    try {
      const body = new FormData();
      body.set("creationId", creationId);
      body.set("slug", slug);
      body.set("expectedLockVersion", String(lockVersion));
      body.set("expectedAssetId", current?.id ?? "");
      body.set("role", role);
      body.set("rightsConfirmed", "on");
      body.set("alt", role === "COVER" || role === "VIDEO_POSTER" ? alt : "");
      body.set("media", file, file.name);
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "x-lnx-creation-media-role": role },
        body,
      });
      const result = await payload(response);
      if (!response.ok || !result?.ok) {
        setState(result?.state && feedback[result.state] ? result.state : "media-erreur");
        return;
      }
      window.location.assign(result.location ?? window.location.href);
    } catch {
      setState("media-erreur");
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (pending || !editable || !current || !deleteConfirmed) {
      setState("media-confirmation");
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
          creationId,
          slug,
          role,
          expectedLockVersion: lockVersion,
          expectedAssetId: current.id,
          confirmation: CREATION_MEDIA_DELETION_CONFIRMATION,
        }),
      });
      const result = await payload(response);
      if (!response.ok || !result?.ok) {
        setState(result?.state && feedback[result.state] ? result.state : "media-erreur");
        return;
      }
      window.location.assign(result.location ?? window.location.href);
    } catch {
      setState("media-erreur");
    } finally {
      setPending(null);
    }
  }

  return <article className="admin-panel admin-creation-media" data-role={role}>
    <div className="admin-panel__heading">
      <h3>{details.label}</h3>
      <span>{current ? "Attaché" : "À ajouter"}</span>
    </div>
    {selected ? <div className="admin-creation-media__preview">
      <LocalPreview role={role} url={selected.url} title={title} />
      <p><strong>Aperçu local</strong> · {selected.file.name} · {formatBytes(selected.file.size)}</p>
    </div> : current ? <div className="admin-creation-media__preview">
      <CurrentPreview media={current} title={title} />
      <dl className="admin-product-image__facts">
        <div><dt>Fichier</dt><dd>{current.filename}</dd></div>
        <div><dt>Type</dt><dd>{current.mimeType}</dd></div>
        <div><dt>Taille</dt><dd>{formatBytes(Number(current.sizeBytes))}</dd></div>
        {(current.width || current.height) ? <div><dt>Dimensions</dt><dd>{current.width ?? "?"} × {current.height ?? "?"} px</dd></div> : null}
        {current.durationMs ? <div><dt>Durée</dt><dd>{formatDuration(current.durationMs)}</dd></div> : null}
      </dl>
    </div> : <p className="admin-muted">Aucun fichier pour cet emplacement.</p>}

    {state && feedback[state] ? <p className="admin-feedback" role="status">{feedback[state]}</p> : null}
    {editable ? <form ref={formRef} className="admin-catalogue-form" onSubmit={upload}>
      <label className="admin-delivery-picker admin-product-image__picker">
        <input
          ref={inputRef}
          className="admin-delivery-picker__input"
          type="file"
          name="media"
          accept={details.accept}
          disabled={pending !== null}
          onChange={(event) => choose(event.currentTarget.files?.length === 1 ? event.currentTarget.files[0] ?? null : null)}
        />
        <span className="admin-delivery-picker__content">
          <strong>{current ? `Remplacer ${details.label.toLowerCase()}` : `Ajouter ${details.label.toLowerCase()}`}</strong>
          <span>{selected?.file.name ?? details.hint}</span>
          <span className="admin-delivery-picker__action">Parcourir les fichiers</span>
        </span>
      </label>
      {(role === "COVER" || role === "VIDEO_POSTER") ? <label>
        <span>Texte alternatif</span>
        <input value={alt} onChange={(event) => setAlt(event.currentTarget.value)} maxLength={500} />
      </label> : null}
      <label className="admin-checkbox">
        <input name="rightsConfirmed" type="checkbox" required disabled={pending !== null} />
        <span>Je confirme disposer des droits nécessaires pour diffuser ce média.</span>
      </label>
      <button className="admin-button" type="submit" disabled={pending !== null || !selected}>
        {pending === "upload" ? "Téléversement en cours…" : current ? "Remplacer" : "Téléverser"}
      </button>
    </form> : null}

    {editable && current ? <div className="admin-creation-media__delete">
      <label className="admin-check">
        <input
          type="checkbox"
          checked={deleteConfirmed}
          disabled={pending !== null}
          onChange={(event) => setDeleteConfirmed(event.currentTarget.checked)}
        />
        <span>Je confirme la suppression de ce média.</span>
      </label>
      <button className="admin-button admin-button--danger" type="button" disabled={pending !== null || !deleteConfirmed} onClick={remove}>
        {pending === "delete" ? "Suppression…" : "Supprimer ce média"}
      </button>
    </div> : null}
  </article>;
}

export function AdminCreationMediaManager({
  creationId,
  slug,
  title,
  lockVersion,
  status,
  media,
  initialState,
}: {
  creationId: string;
  slug: string;
  title: string;
  lockVersion: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  media: readonly AdminCreationMedia[];
  initialState?: string;
}) {
  const editable = status !== "ARCHIVED";
  const byRole = new Map(media.map((item) => [item.role, item]));
  return <>
    {initialState && feedback[initialState] ? <p className="admin-feedback" role="status">{feedback[initialState]}</p> : null}
    <div className="admin-creation-media-grid">
    {(Object.keys(ROLE_DETAILS) as CreationMediaRole[]).map((role) => <MediaEditor
      key={role}
      creationId={creationId}
      slug={slug}
      title={title}
      lockVersion={lockVersion}
      role={role}
      current={byRole.get(role) ?? null}
      editable={editable}
    />)}
    </div>
  </>;
}
