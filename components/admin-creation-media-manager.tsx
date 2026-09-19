"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  CREATION_AUDIO_MAXIMUM_BYTES,
  CREATION_IMAGE_MAXIMUM_BYTES,
  CREATION_MEDIA_DELETION_CONFIRMATION,
  CREATION_VIDEO_MAXIMUM_BYTES,
  creationVideoMimeForFilename,
  type CreationMediaRole,
} from "@/lib/creations/media-contract";
import {
  abortDirectMultipartVideoUpload,
  clearStoredMultipartSession,
  DirectMultipartUploadError,
  multipartFileSignature,
  readStoredMultipartSession,
  runDirectMultipartVideoUpload,
  shouldClearStoredMultipartSession,
  writeStoredMultipartSession,
  type MultipartProgress,
  type StoredMultipartSession,
} from "@/lib/creations/direct-multipart-upload";

const endpoint = "/api/admin/creations/media";

const ROLE_DETAILS: Record<CreationMediaRole, {
  label: string;
  accept: string;
  hint: string;
  maximumBytes: number;
}> = {
  COVER: { label: "Cover", accept: "image/jpeg,image/png,image/webp", hint: `JPEG, PNG ou WebP · ${formatBytes(CREATION_IMAGE_MAXIMUM_BYTES)} max.`, maximumBytes: CREATION_IMAGE_MAXIMUM_BYTES },
  VIDEO_POSTER: { label: "Poster vidéo", accept: "image/jpeg,image/png,image/webp", hint: `JPEG, PNG ou WebP · ${formatBytes(CREATION_IMAGE_MAXIMUM_BYTES)} max.`, maximumBytes: CREATION_IMAGE_MAXIMUM_BYTES },
  AUDIO: { label: "Audio", accept: "audio/mpeg,.mp3", hint: `MP3 authentique · ${formatBytes(CREATION_AUDIO_MAXIMUM_BYTES)} max.`, maximumBytes: CREATION_AUDIO_MAXIMUM_BYTES },
  VIDEO: { label: "Vidéo", accept: "video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm", hint: `MP4, MOV, M4V ou WebM · 20 min et ${formatBytes(CREATION_VIDEO_MAXIMUM_BYTES)} max.`, maximumBytes: CREATION_VIDEO_MAXIMUM_BYTES },
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
  "media-reseau": "La connexion a été interrompue. Vous pouvez reprendre l’envoi sans renvoyer les parties déjà reçues.",
  "media-session": "La session d’envoi n’est plus valide. Relancez un nouvel envoi.",
  "media-reselection": "Resélectionnez le même fichier pour reprendre l’envoi.",
  "media-expire": "La session d’envoi a expiré. Relancez un nouvel envoi.",
  "media-annule": "L’envoi a été annulé et la quarantaine est en cours de nettoyage.",
  "media-direct-requis": "Les vidéos doivent utiliser l’envoi direct sécurisé.",
  "media-analyse": "Analyse du fichier en cours.",
  "media-conversion": "Conversion de la vidéo pour le web en cours.",
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
  if (value < 1_024 * 1_024) return `${(value / 1_024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Kio`;
  return `${(value / (1_024 * 1_024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mio`;
}

function formatDuration(durationMs: number | null) {
  if (!durationMs || durationMs <= 0) return "Non renseignée";
  const seconds = Math.round(durationMs / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function AdminCreationUploadProgress({
  progress,
  onCancel,
}: {
  progress: MultipartProgress;
  onCancel?: () => void;
}) {
  const validating = progress.phase === "validating";
  const analyzing = progress.phase === "analyzing";
  const transcoding = progress.phase === "transcoding";
  const processing = validating || analyzing || transcoding;
  return <div className="admin-creation-upload" aria-live="polite">
    <div className="admin-creation-upload__heading">
      <strong>{progress.phase === "ready" ? "Prêt" : transcoding ? "Conversion vidéo" : analyzing ? "Analyse du fichier" : validating ? "Validation intégrale" : progress.phase === "finalizing" ? "Finalisation" : progress.phase === "retrying" ? "Nouvelle tentative" : progress.phase === "initializing" ? "Préparation" : "Envoi direct vers le stockage"}</strong>
      <span>{processing ? "Traitement en cours" : progress.phase === "ready" ? "Terminé" : `${progress.percent.toLocaleString("fr-FR")} %`}</span>
    </div>
    {processing
      ? <progress max={100} aria-label={transcoding ? "Conversion de la vidéo en cours" : analyzing ? "Analyse de la vidéo en cours" : "Validation de la vidéo en cours"} />
      : <progress max={100} value={progress.percent}>{progress.percent} %</progress>}
    <small>{processing
      ? `Envoi terminé · ${progress.completedParts}/${progress.partCount} parties confirmées · ${transcoding ? "conversion web" : analyzing ? "inspection du format et des pistes" : "décodage intégral"} en cours`
      : progress.phase === "ready"
        ? "Validation réussie et média attaché"
        : `${progress.completedParts}/${progress.partCount || "…"} parties confirmées · ${formatBytes(progress.confirmedBytes)} confirmés · ${formatBytes(progress.inFlightBytes)} en cours · ${formatBytes(progress.totalBytes)} au total`}</small>
    {onCancel && !processing && progress.phase !== "ready"
      ? <button className="admin-button admin-button--danger" type="button" onClick={onCancel}>Annuler l’envoi</button>
      : null}
  </div>;
}

export function AdminCreationUploadFeedback({ state }: { state: string }) {
  return feedback[state] ? <p className="admin-feedback" role="status">{feedback[state]}</p> : null;
}

export function AdminCreationUploadResume({
  filename,
  onResume,
}: {
  filename: string;
  onResume?: () => void;
}) {
  return <div className="admin-creation-upload-resume">
    <p className="admin-form-note">Une session interrompue est disponible. Resélectionnez <strong>{filename}</strong> pour reprendre les parties manquantes, ou vérifiez si sa validation est déjà en cours.</p>
    <button className="admin-button" type="button" onClick={onResume}>Reprendre la session</button>
  </div>;
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
  const [directProgress, setDirectProgress] = useState<MultipartProgress | null>(null);
  const [resume, setResume] = useState<StoredMultipartSession | null>(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [alt, setAlt] = useState(current?.alt ?? title);
  const uploadController = useRef<AbortController | null>(null);
  const sessionToken = useRef<string | null>(null);
  const details = ROLE_DETAILS[role];

  useEffect(() => () => {
    if (selected) URL.revokeObjectURL(selected.url);
  }, [selected]);

  useEffect(() => {
    if (role !== "VIDEO") return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const stored = readStoredMultipartSession(window.sessionStorage, creationId);
      setResume(stored);
      sessionToken.current = stored?.sessionToken ?? null;
    });
    return () => { active = false; };
  }, [creationId, role]);

  function choose(file: File | null) {
    setSelected((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return file ? { file, url: URL.createObjectURL(file) } : null;
    });
    setState(undefined);
  }

  async function uploadVideo(file: File, rightsConfirmed: boolean) {
    const controller = new AbortController();
    uploadController.current = controller;
    const stored = readStoredMultipartSession(window.sessionStorage, creationId, file);
    const mimeType = creationVideoMimeForFilename(file.name, file.type);
    if (!mimeType) throw new DirectMultipartUploadError("media-format");
    const input = {
      creationId,
      slug,
      expectedLockVersion: lockVersion,
      expectedAssetId: current?.id ?? "",
      rightsConfirmed: true as const,
      alt: "",
      role: "VIDEO" as const,
      filename: file.name,
      mimeType,
      sizeBytes: file.size,
    };
    if (!rightsConfirmed) throw new DirectMultipartUploadError("media-droits");
    try {
      const result = await runDirectMultipartVideoUpload({
        file,
        init: input,
        resumeSessionToken: stored?.sessionToken,
        signal: controller.signal,
        onSession(session) {
          sessionToken.current = session.sessionToken;
          const value: StoredMultipartSession = {
            sessionToken: session.sessionToken,
            expiresAt: session.expiresAt,
            creationId,
            role: "VIDEO",
            fileSignature: multipartFileSignature(file),
            filename: file.name,
            mimeType,
            sizeBytes: file.size,
            lastModified: file.lastModified,
          };
          writeStoredMultipartSession(window.sessionStorage, value);
          setResume(value);
        },
        onProgress: setDirectProgress,
      });
      clearStoredMultipartSession(window.sessionStorage, creationId);
      setResume(null);
      window.location.assign(result.location ?? window.location.href);
    } finally {
      uploadController.current = null;
    }
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
      if (role === "VIDEO") {
        await uploadVideo(file, rights.checked);
        return;
      }
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
    } catch (error) {
      setDirectProgress(null);
      if (shouldClearStoredMultipartSession(error)) {
        clearStoredMultipartSession(window.sessionStorage, creationId);
        sessionToken.current = null;
        setResume(null);
      }
      if (error instanceof DirectMultipartUploadError && feedback[error.state]) setState(error.state);
      else if (error instanceof DOMException && error.name === "AbortError") setState("media-annule");
      else setState("media-erreur");
    } finally {
      setPending(null);
    }
  }

  async function cancelVideoUpload() {
    if (role !== "VIDEO" || !sessionToken.current) return;
    uploadController.current?.abort();
    const controller = new AbortController();
    try {
      await abortDirectMultipartVideoUpload(sessionToken.current, controller.signal);
      clearStoredMultipartSession(window.sessionStorage, creationId);
      sessionToken.current = null;
      setResume(null);
      setDirectProgress(null);
      setState("media-annule");
    } catch (error) {
      setState(error instanceof DirectMultipartUploadError && feedback[error.state] ? error.state : "media-erreur");
    }
  }

  async function resumeVideoValidation() {
    if (role !== "VIDEO" || !resume || pending) return;
    const controller = new AbortController();
    uploadController.current = controller;
    setPending("upload");
    setState(undefined);
    try {
      const result = await runDirectMultipartVideoUpload({
        init: {
          creationId, slug, expectedLockVersion: lockVersion, expectedAssetId: current?.id ?? "",
          rightsConfirmed: true, alt: "", role: "VIDEO", filename: resume.filename,
          mimeType: resume.mimeType, sizeBytes: resume.sizeBytes,
        },
        resumeSessionToken: resume.sessionToken,
        signal: controller.signal,
        onProgress: setDirectProgress,
      });
      clearStoredMultipartSession(window.sessionStorage, creationId);
      window.location.assign(result.location ?? window.location.href);
    } catch (error) {
      setDirectProgress(null);
      if (shouldClearStoredMultipartSession(error)) {
        clearStoredMultipartSession(window.sessionStorage, creationId);
        sessionToken.current = null;
        setResume(null);
      }
      if (error instanceof DirectMultipartUploadError && feedback[error.state]) setState(error.state);
      else if (error instanceof DOMException && error.name === "AbortError") setState("media-annule");
      else setState("media-erreur");
    } finally {
      uploadController.current = null;
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

    {state ? <AdminCreationUploadFeedback state={state} /> : null}
    {role === "VIDEO" && directProgress
      ? <AdminCreationUploadProgress progress={directProgress} onCancel={cancelVideoUpload} />
      : null}
    {role === "VIDEO" && resume && !pending && !directProgress
      ? <AdminCreationUploadResume filename={resume.filename} onResume={resumeVideoValidation} />
      : null}
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
        {pending === "upload" ? (role === "VIDEO" ? "Envoi ou validation en cours…" : "Téléversement en cours…") : resume && role === "VIDEO" ? "Reprendre l’envoi" : current ? "Remplacer" : "Téléverser"}
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
    {initialState ? <AdminCreationUploadFeedback state={initialState} /> : null}
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
