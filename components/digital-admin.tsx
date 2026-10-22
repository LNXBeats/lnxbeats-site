"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { runDirectMultipartUpload, uploadPartWithProgress, multipartFileSignature, waitUntilVisible, type MultipartDependencies, type MultipartProgress } from "@/lib/creations/direct-multipart-upload";
import { parseEuroCents } from "@/lib/digital/domain";
import { digitalBatchAssociationIssue, runDigitalBatch } from "@/lib/digital/admin";
import { announceMediaPlayback, listenForOtherMediaPlayback } from "@/lib/media/playback-coordinator";
import { digitalRequest } from "./digital-cart";
import styles from "./digital.module.css";
import admin from "./digital-admin.module.css";
import { digitalUiIsLive, type DigitalUiMode } from "./digital-mode-copy";
import { suggestExpressTrack } from "@/lib/digital/express-policy";
import { digitalUploadPhaseLabel, expressBatchPercent } from "@/lib/digital/express-presentation";
import { DigitalAudioDropzone } from "./digital-audio-dropzone";
import { appendLocalAudioFiles } from "@/lib/digital/local-audio-selection";
import { selectExpressTrackFile } from "@/lib/digital/express-audio-selection";
import { mergeBoundAudioQueue } from "@/lib/digital/bound-audio-queue";
import { automaticAudioStarts } from "@/lib/digital/automatic-audio-queue";

type Offer = { priceCents: number | null; version: number; active: boolean; rightsConfirmed: boolean; distribution: string };
export type DigitalAdminTrack = { id: string; title: string; position: number; publication: string; durationSeconds: number | null; version: number; previewStartMs: number; previewDurationMs: number | null; previewUrl: string | null; offer: Offer | null };
export function DigitalAdminPreview({ src, title }: { src: string; title: string }) {
  const id = `dcn-admin-${useId()}`, audio = useRef<HTMLAudioElement>(null);
  useEffect(() => listenForOtherMediaPlayback(id, () => audio.current?.pause()), [id]);
  return <audio ref={audio} controls preload="none" src={src} aria-label={`Contrôler l’extrait de ${title}`} onPlay={() => announceMediaPlayback({ ownerId: id, kind: "audio" })} />;
}
export function DigitalOfferForm({ projectId, trackId, offer, label, mode="TEST" }: { projectId: string; trackId: string | null; offer: Offer | null; label: string;mode?:DigitalUiMode }) {
  const live=digitalUiIsLive(mode);
  const router = useRouter();
  const [price, setPrice] = useState(offer?.priceCents ? String(offer.priceCents / 100) : ""), [active, setActive] = useState(offer?.active ?? false), [rights, setRights] = useState(offer?.rightsConfirmed ?? false), [distribution, setDistribution] = useState(offer?.distribution ?? "UNRELEASED"), [state, setState] = useState(""), [busy, setBusy] = useState(false);
  return <form className={`${styles.form} ${admin.offer}`} onSubmit={async e => {
    e.preventDefault(); setBusy(true);
    try { await digitalRequest("/api/admin/digital/offers", { projectId, trackId, priceCents: price.trim() ? parseEuroCents(price) : null, active, rightsConfirmed: rights, distribution, expectedVersion: offer?.version ?? 0 }); setState(live?"Offre enregistrée. Les contrôles serveur de publication, droits, extraits, contrat et disponibilité restent obligatoires.":"Offre enregistrée pour les tests. Vérifiez les points à compléter ; aucune vente réelle n’est ouverte."); router.refresh(); }
    catch (e) { setState(e instanceof Error ? e.message : "Enregistrement refusé."); } finally { setBusy(false); }
  }}>
    <h3>{label}</h3>
    <div className={admin.fields}><label>{live?"Prix (EUR)":"Prix (EUR) — TEST"}<input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="À définir" aria-describedby={`price-${trackId ?? projectId}`} maxLength={10} /></label>
      <label>Distribution externe<select value={distribution} onChange={e => setDistribution(e.target.value)}><option value="UNRELEASED">Inédit / non distribué</option><option value="DISTRIBUTED">Distribué sur plateformes</option></select></label></div>
    <small id={`price-${trackId ?? projectId}`} className={styles.note}>Vous fixez ce prix librement, sans montant par défaut. Il est indépendant des autres offres. Prix non validé ? Laissez le champ vide et l’offre inactive.{!live?" Les montants d’essai ne sont pas des tarifs de lancement.":""}</small>
    <label className={styles.checkbox}><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} /><span>J’ai vérifié les droits de vente et d’extrait, y compris co-auteurs, featurings et distribution. Cette déclaration est auditée.</span></label>
    <label className={styles.checkbox}><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /><span>{live?"Autoriser cette offre à la vente, sous réserve des contrôles serveur.":"Autoriser la vente en TEST."} Publication et médias prêts restent obligatoires.</span></label>
    <div className={styles.actions}><button type="submit" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer l’offre"}</button></div><p role="status">{state}</p>
  </form>;
}

export function DigitalTrackEditor({ projectId, track }: { projectId: string; track: DigitalAdminTrack }) {
  const router = useRouter();
  const [title, setTitle] = useState(track.title), [publication, setPublication] = useState(track.publication === "RELEASED" ? "released" : track.publication === "ANNOUNCED" ? "announced" : "unlisted"), [state, setState] = useState(""), [busy, setBusy] = useState(false);
  async function mutate(operation: "save" | "up" | "down") {
    setBusy(true);
    try { await digitalRequest(`/api/admin/digital/projects/${projectId}/tracks`, { trackId: track.id, operation, title, publication, durationSeconds: track.durationSeconds }); setState(operation === "save" ? "Titre et publication enregistrés. Les acquisitions historiques restent figées." : "Ordre enregistré. Les anciennes acquisitions conservent leur ordre acheté."); router.refresh(); }
    catch (e) { setState(e instanceof Error ? e.message : "Modification refusée."); } finally { setBusy(false); }
  }
  return <form className={`${styles.form} ${admin.compact}`} onSubmit={e => { e.preventDefault(); void mutate("save"); }}>
    <div className={admin.fields}><label>Titre de la piste<input value={title} maxLength={240} required onChange={e => setTitle(e.target.value)} /></label><label>Publication de la piste<select value={publication} onChange={e => setPublication(e.target.value)}><option value="released">Publiée</option><option value="announced">Annoncée — non vendue</option><option value="unlisted">Non listée — non vendue</option></select></label></div>
    <div className={styles.actions}><button disabled={busy}>Enregistrer la piste</button><button type="button" className={styles.quiet} disabled={busy || track.position <= 1} onClick={() => void mutate("up")}>Monter</button><button type="button" className={styles.quiet} disabled={busy} onClick={() => void mutate("down")}>Descendre</button></div><p role="status">{state}</p>
  </form>;
}

type Init = { filename: string; mimeType: string; sizeBytes: number; expectedVersion: number; previewStartMs: number; replaceConfirmed: boolean; studio?: true };
type UploadState = "waiting" | "busy" | "ready" | "paused" | "error";
type RegisteredUpload = { start: () => Promise<void>; stop: () => void; valid: boolean; state: UploadState; trackId: string };
type BatchEntry = { id: string; file: File; studio?: true; trackId?: string };
type SavedUpload = { token: string; signature: string; expiresAt: string; previewStartMs: number; expectedVersion: number; studio?: true };
function UploadFile({ entry, tracks, register, report, associate, remove, duplicate, batchBusy, compact = false, automatic = false, reportProgress, onValidated, onStudioQueued }: { entry: BatchEntry; tracks: DigitalAdminTrack[]; register: (id: string, row: RegisteredUpload | null) => void; report: (id: string, state: UploadState) => void; associate: (id: string, trackId: string) => void; remove: (id: string) => void; duplicate: boolean; batchBusy: boolean; compact?: boolean; automatic?: boolean; reportProgress: (id: string, progress: MultipartProgress) => void; onValidated?: () => void; onStudioQueued?: () => void }) {
  const file = entry.file;
  const [trackId, setTrackId] = useState(() => entry.trackId ?? suggestExpressTrack(file.name, tracks) ?? ""), [associationConfirmed, setAssociationConfirmed] = useState(!!entry.trackId), [confirmed, setConfirmed] = useState(false), [progress, setProgress] = useState<MultipartProgress | null>(null), [message, setMessage] = useState(""), [state, setState] = useState<UploadState>("waiting"), [hasSession, setHasSession] = useState(false);
  const controller = useRef<AbortController | null>(null), inFlight = useRef(false), memorySession = useRef<SavedUpload | null>(null), studioQueuedSession = useRef<string | null>(null), router = useRouter();
  const track = tracks.find(t => t.id === trackId), startMs = 0, valid = !!track && associationConfirmed && !duplicate && (hasSession || !track.version || confirmed);
  const api = useCallback(async <T,>(id: string, op: string, b: unknown, signal?: AbortSignal) => {
    const r = await fetch(`/api/admin/digital/tracks/${id}/${op}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(b), signal });
    const v = await r.json(); if (!r.ok) throw Error(v.error ?? "Transfert refusé."); return v as T;
  }, []);
  function changeState(s: UploadState) { setState(s); report(entry.id, s); }
  async function upload() {
    if (!track || !valid || startMs === null || inFlight.current || state === "ready") return;
    const c = new AbortController(); controller.current = c; inFlight.current = true; changeState("busy"); setMessage(""); let token = "";
    const key = `lnx:dcn:upload:${trackId}`; let saved = memorySession.current;
    try { saved ??= JSON.parse(localStorage.getItem(key) ?? "null"); } catch { /* optional resume aid */ }
    const deps: MultipartDependencies<Init> = {
      init: b => api(trackId, "init", b, c.signal), partUrl: (sessionToken, partNumber) => api(trackId, "part-url", { sessionToken, partNumber }, c.signal), status: sessionToken => api(trackId, "status", { sessionToken }, c.signal), complete: sessionToken => api(trackId, "complete", { sessionToken }, c.signal),
      uploadPart: input => {
        if (!input.url.startsWith("/api/admin/digital/")) return uploadPartWithProgress(input);
        return new Promise((resolve, reject) => {
          const x = new XMLHttpRequest(), abort = () => x.abort(), clean = () => input.signal.removeEventListener("abort", abort);
          x.open("PUT", input.url, true); x.setRequestHeader("x-dcn-upload-token", token);
          x.upload.onprogress = e => input.onProgress(Math.min(input.body.size, e.loaded));
          x.onload = () => { clean(); const etag = x.getResponseHeader("etag"); if (x.status >= 200 && x.status < 300 && etag) resolve({ etag }); else reject(Error("Partie refusée.")); };
          x.onerror = () => { clean(); reject(Error("Réseau interrompu.")); }; x.onabort = () => { clean(); reject(new DOMException("Transfert suspendu", "AbortError")); }; input.signal.addEventListener("abort", abort, { once: true }); x.send(input.body);
        });
      },
      wait: (ms, signal) => new Promise((resolve, reject) => { const timer = setTimeout(done, ms); function done() { signal.removeEventListener("abort", abort); resolve(); } function abort() { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("Pause", "AbortError")); } signal.addEventListener("abort", abort, { once: true }); }), waitUntilVisible,
    };
    try {
      // Resume binds the exact file, track and excerpt settings, never another association.
      const resume = saved?.signature === multipartFileSignature(file) && !!saved.studio === !!entry.studio && saved.previewStartMs === startMs && Number.isSafeInteger(saved.expectedVersion) && Date.parse(saved.expiresAt) > Date.now() ? saved.token : undefined;
      const expectedVersion = resume && saved ? saved.expectedVersion : track.version;
      await runDirectMultipartUpload({ file, init: { filename: file.name, mimeType: file.type, sizeBytes: file.size, expectedVersion, previewStartMs: startMs, replaceConfirmed: confirmed, ...(entry.studio ? { studio: true as const } : {}) }, signal: c.signal, resumeSessionToken: resume, dependencies: deps,
        onSession: s => { token = s.sessionToken; setHasSession(true); memorySession.current = { token, signature: multipartFileSignature(file), expiresAt: s.expiresAt, previewStartMs: startMs, expectedVersion, ...(entry.studio ? { studio: true } : {}) }; try { localStorage.setItem(key, JSON.stringify(memorySession.current)); } catch { /* Same-page resume remains available when storage is disabled. */ } if (entry.studio && studioQueuedSession.current !== s.sessionToken) { studioQueuedSession.current = s.sessionToken; onStudioQueued?.(); } }, onProgress: p => { setProgress(p); reportProgress(entry.id, p); } });
      try { localStorage.removeItem(key); } catch { /* optional browser aid */ } memorySession.current = null; setHasSession(false); changeState("ready"); setMessage(entry.studio ? "Source privée reçue pour LNX Beats Studio. Consultez le traitement, les fichiers et les contrôles dans l’atelier ci-dessous ; aucune validation d’écoute, de droits ou de publication automatique." : /\.mp3$/i.test(file.name) ? "MP3 privé vérifié, source compressée conservée sans faux WAV. Consultez les formats et l’état de cette version dans la fiche ; aucune offre ni aucun droit n’est activé automatiquement." : "WAV privé vérifié, MP3 et extrait prêts. L’extrait reste à écouter ; droits et publication à confirmer."); if (onValidated) onValidated(); else router.refresh();
    } catch (e) {
      changeState(c.signal.aborted ? "paused" : "error"); setMessage(c.signal.aborted ? "Transfert suspendu. Reprendre conserve les parties reçues et ne relance pas les autres fichiers." : e instanceof Error ? e.message : "Transfert interrompu.");
      if (token && !c.signal.aborted) {
        try { const result = await api<{ status: string; errorCode?: string }>(trackId, "status", { sessionToken: token }); if (["REJECTED", "ABORTED", "EXPIRED"].includes(result.status)) { try { localStorage.removeItem(key); } catch { /* optional browser aid */ } memorySession.current = null; setHasSession(false); setMessage(result.errorCode === "INVALID_AUDIO"
          ? `Le contrôle audio de ce ${/\.mp3$/i.test(file.name) ? "MP3" : "WAV"} a échoué. Aucun nouveau master n’a été associé. Vérifiez le fichier ou choisissez un autre export complet avant de recommencer. Les autres fichiers et les versions historiques sont conservés. ${/\.mp3$/i.test(file.name) ? "Un MP3 ne devient vendable que si cette version exacte est explicitement autorisée ; aucun faux WAV n’est créé." : ""}`
          : `Import arrêté (${result.errorCode ?? result.status}). Les autres fichiers et les versions historiques sont conservés. Vérifiez ce motif avant de recommencer avec un fichier valide.`); } } catch { /* Unknown stays resumable, never blindly abandon it. */ }
      }
    } finally { inFlight.current = false; }
  }
  useEffect(() => { register(entry.id, { start: upload, stop: () => controller.current?.abort(), valid, state, trackId }); return () => register(entry.id, null); });
  useEffect(() => () => controller.current?.abort(), []);
  if (automatic && state === "ready") return null;
  return <article className={admin.upload} data-state={state} aria-label={`Import ${file.name}`}>
    <div className={admin.status}><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} Mio · {state === "waiting" && entry.trackId ? "Prêt à envoyer" : ({ waiting: "À associer", busy: "Traitement", ready: "Prêt", paused: "Suspendu", error: "À reprendre" })[state]}{entry.studio ? " · LNX Beats Studio" : ""}</span></div>
    <div className={styles.form}>{entry.trackId ? automatic ? null : <p>Rattaché directement à <strong>{track?.title ?? "cette piste"}</strong>. Aucun rapprochement par nom de fichier.</p> : <div className={admin.fields}><label>Associer ce fichier à une piste<select disabled={state === "busy" || hasSession || state === "ready" || batchBusy} value={trackId} onChange={e => { setTrackId(e.target.value); associate(entry.id, e.target.value); setAssociationConfirmed(!!e.target.value); setConfirmed(false); }}><option value="">Choisir explicitement</option>{tracks.map(t => <option key={t.id} value={t.id}>{t.position}. {t.title}</option>)}</select></label></div>}
      {trackId && !associationConfirmed ? <label className={styles.checkbox}><input type="checkbox" onChange={e => { setAssociationConfirmed(e.target.checked); associate(entry.id, trackId); }} /><span>Je confirme l’association proposée avec « {track?.title} ». Le nom seul ne prouve pas l’identité du master.</span></label> : null}
      {duplicate ? <p role="alert">Cette piste est associée à plusieurs fichiers. Corrigez l’association ou retirez une ligne avant l’envoi.</p> : null}
      {track?.version ? <label className={styles.checkbox}><input type="checkbox" checked={confirmed} disabled={state === "busy" || state === "ready"} onChange={e => setConfirmed(e.target.checked)} /><span>Créer une nouvelle version. Les fichiers et extraits acquis antérieurement sont conservés.</span></label> : null}
      <div className={styles.actions}>{!automatic || state === "paused" || state === "error" ? <button type="button" disabled={!valid || state === "busy" || state === "ready" || batchBusy} onClick={() => void upload()}>{state === "paused" || state === "error" ? "Reprendre ce fichier" : state === "ready" ? "Fichier prêt" : "Envoyer ce fichier"}</button> : null}{state === "busy" ? <button type="button" className={styles.quiet} onClick={() => controller.current?.abort()}>Suspendre ce fichier</button> : null}<button type="button" className={styles.quiet} disabled={batchBusy || state === "busy" || hasSession} onClick={() => remove(entry.id)}>Retirer du lot{state === "ready" ? " (master conservé)" : ""}</button></div>
      {progress && !compact ? <><progress className={styles.progress} aria-label={`Envoi de ${file.name}`} max={100} value={progress.percent} /><span role="status">{state === "error" ? "Traitement arrêté — voir le motif ci-dessous" : `${digitalUploadPhaseLabel(progress.phase, file.name)} · ${Math.round(progress.percent)} %`}</span></> : null}
      {progress && compact ? <p>{state === "error" ? "Traitement arrêté — voir le motif ci-dessous" : digitalUploadPhaseLabel(progress.phase, file.name)}</p> : null}
      <p role={state === "error" ? "alert" : "status"}>{message}</p>
    </div>
  </article>;
}
export function DigitalBatchUpload({ tracks, compact = false, studio = false, autoStart = false, initialFiles = [], preparedAssignments = [], perTrackTargetPrefix, onInitialFilesAccepted, onValidated, onStudioQueued }: { tracks: DigitalAdminTrack[]; compact?: boolean; studio?: boolean; autoStart?: boolean; initialFiles?: File[]; preparedAssignments?: Array<{ file: File; trackId: string }>; perTrackTargetPrefix?: string; onInitialFilesAccepted?: () => void; onValidated?: () => void; onStudioQueued?: () => void }) {
  // Only a local queue is restored here. Studio mode is fixed once capability is known;
  // upload, track association and replacement still require their existing explicit actions.
  const [entries, setEntries] = useState<BatchEntry[]>(() => { const legacy = appendLocalAudioFiles([], initialFiles).files.map(file => ({ id: crypto.randomUUID(), file, ...(studio ? { studio: true as const } : {}) })); return mergeBoundAudioQueue(legacy, preparedAssignments, tracks.map(track => track.id), studio, () => crypto.randomUUID()).entries; }), [states, setStates] = useState<Record<string, UploadState>>({}), [associations, setAssociations] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const initialQueuePending = useRef(initialFiles.length > 0);
  useEffect(() => { if (!initialQueuePending.current) return; const timer = setTimeout(() => { initialQueuePending.current = false; onInitialFilesAccepted?.(); }, 0); return () => clearTimeout(timer); }, [onInitialFilesAccepted]);
  const rows = useRef(new Map<string, RegisteredUpload>()), stop = useRef(false);
  const attempted = useRef(new Set<string>()), running = useRef(new Set<string>()), mounted = useRef(true);
  const rowSignatures = useRef(new Map<string, string>());
  const [queueRevision, setQueueRevision] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [progresses, setProgresses] = useState<Record<string, MultipartProgress>>({});
  const [targets, setTargets] = useState<Record<string, HTMLElement>>({}), [trackError, setTrackError] = useState<{ trackId: string; message: string } | null>(null);
  useEffect(() => {
    if (!perTrackTargetPrefix) return;
    const timer = setTimeout(() => { const next: Record<string, HTMLElement> = {}; for (const track of tracks) { const target = document.getElementById(`${perTrackTargetPrefix}${track.id}`); if (target) next[track.id] = target; }
      setTargets(old => Object.keys(old).length === Object.keys(next).length && Object.entries(next).every(([id, target]) => old[id] === target) ? old : next); }, 0);
    return () => clearTimeout(timer);
  }, [perTrackTargetPrefix, tracks]);
  useEffect(() => {
    if (!preparedAssignments.length) return;
    const timer = setTimeout(() => {
      const allQueued = preparedAssignments.every(item => entries.some(entry => entry.trackId === item.trackId && multipartFileSignature(entry.file) === multipartFileSignature(item.file)));
      if (allQueued) { onInitialFilesAccepted?.(); return; }
      const merged = mergeBoundAudioQueue(entries, preparedAssignments, tracks.map(track => track.id), studio, () => crypto.randomUUID());
      if (merged.error) { setMessage(merged.error); return; }
      // Merge against the latest queue, not this timer's snapshot. A simultaneous
      // per-track drop must never be overwritten; acknowledge only on a later
      // render that actually contains all the requested bindings.
      setEntries(current => mergeBoundAudioQueue(current, preparedAssignments, tracks.map(track => track.id), studio, () => crypto.randomUUID()).entries);
    }, 0);
    return () => clearTimeout(timer);
  }, [preparedAssignments, entries, tracks, studio, onInitialFilesAccepted]);
  const reportProgress = useCallback((id: string, p: MultipartProgress) => setProgresses(old => ({ ...old, [id]: p })), []);
  const register = useCallback((id: string, row: RegisteredUpload | null) => {
    if (row) rows.current.set(id, row); else rows.current.delete(id);
    if (row) {
      const signature = `${row.valid}:${row.state}:${row.trackId}`;
      if (rowSignatures.current.get(id) !== signature) { rowSignatures.current.set(id, signature); setQueueRevision(value => value + 1); }
    }
  }, []);
  useEffect(() => {
    if (!autoStart || !perTrackTargetPrefix || busy) return;
    const timer = setTimeout(() => {
      const snapshot = [...rows.current].map(([id, row]) => ({ id, ...row }));
      for (const id of automaticAudioStarts(snapshot, entries, attempted.current, running.current.size)) {
        const row = rows.current.get(id); if (!row) continue;
        attempted.current.add(id); running.current.add(id);
        void row.start().finally(() => { running.current.delete(id); if (mounted.current) setQueueRevision(value => value + 1); });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [autoStart, perTrackTargetPrefix, busy, entries, states, queueRevision]);
  const report = useCallback((id: string, state: UploadState) => setStates(previous => ({ ...previous, [id]: state })), []);
  const associate = useCallback((id: string, trackId: string) => setAssociations(previous => ({ ...previous, [id]: trackId })), []);
  const remove = useCallback((id: string) => { setEntries(previous => previous.filter(row => row.id !== id)); setStates(previous => { const next = { ...previous }; delete next[id]; return next; }); setAssociations(previous => { const next = { ...previous }; delete next[id]; return next; }); }, []);
  function addFiles(incoming: File[]) {
    const selection = appendLocalAudioFiles(entries.map(entry => entry.file), incoming);
    if (selection.error) { setMessage(selection.error); return; }
    setEntries(old => { const latest = appendLocalAudioFiles(old.map(entry => entry.file), incoming); if (latest.error) return old;
      const present = new Set(old.map(entry => entry.file));
      return [...old, ...latest.files.filter(file => !present.has(file)).map(file => ({ id: crypto.randomUUID(), file, ...(studio ? { studio: true as const } : {}) }))]; });
  }
  function addTrackFile(trackId: string, incoming: File[]) {
    const selected = selectExpressTrackFile({}, trackId, incoming);
    if (selected.error) { setTrackError({ trackId, message: selected.error }); return; }
    const binding = [{ trackId, file: selected.files[trackId] }];
    const merged = mergeBoundAudioQueue(entries, binding, tracks.map(track => track.id), studio, () => crypto.randomUUID());
    if (merged.error) { setTrackError({ trackId, message: merged.error }); return; }
    setEntries(old => mergeBoundAudioQueue(old, binding, tracks.map(track => track.id), studio, () => crypto.randomUUID()).entries);
    setTrackError(null);
  }
  async function batch() {
    const registered = [...rows.current.values()], issue = digitalBatchAssociationIssue(registered);
    if (registered.some(row => row.state === "busy") || running.current.size) { setMessage("Un envoi est déjà en cours. Attendez sa fin avant une reprise manuelle."); return; }
    if (issue) { setMessage(issue); return; }
    const pending = registered.filter(row => row.state !== "ready" && row.valid);
    stop.current = false; setBusy(true); setMessage("Import groupé : deux fichiers maximum en traitement. Chaque résultat reste indépendant.");
    await runDigitalBatch(pending, row => row.start(), () => stop.current); setBusy(false); setMessage("Lot arrêté ou terminé. Les fichiers prêts sont conservés ; reprenez seulement les lignes en erreur/suspendues.");
  }
  const ready = Object.values(states).filter(s => s === "ready").length, errors = Object.values(states).filter(s => s === "error").length;
  const automaticBusy = autoStart && Object.values(states).some(state => state === "busy");
  const renderEntry = (entry: BatchEntry) => <UploadFile key={entry.id} entry={entry} tracks={tracks} register={register} report={report} associate={associate} remove={remove} duplicate={!!(entry.trackId ?? associations[entry.id]) && entries.filter(row => (row.trackId ?? associations[row.id]) === (entry.trackId ?? associations[entry.id])).length > 1} batchBusy={busy || automaticBusy} compact={compact} automatic={autoStart && !!perTrackTargetPrefix} reportProgress={reportProgress} onValidated={onValidated} onStudioQueued={onStudioQueued} />;
  return <section className={`${styles.panel} ${admin.workflow}`}><h2>Importer vos fichiers audio</h2><p className={styles.muted}>{studio ? "LNX Beats Studio sera appliqué aux prochains fichiers choisis : analyse, formats privés, puis validation humaine. Une conversion issue d’un MP3 ne restaure pas la qualité perdue. Les fichiers déjà sélectionnés gardent leur mode initial." : "Déposez vos WAV ou MP3, puis confirmez les associations. Fichiers complets privés ; les MP3 sans autorisation commerciale propre à leur version restent en brouillon. Aucun faux WAV n’est créé."}</p>
    {perTrackTargetPrefix ? <p>{autoStart ? "Le fichier choisi sous un titre est envoyé et traité automatiquement. Les erreurs ne sont pas relancées sans votre action." : "Déposez un fichier sous chaque titre ci-dessus. Les pistes sont déjà désignées ; lancez chaque envoi ou le lot complet ci-dessous."}</p> : <DigitalAudioDropzone compact={compact} disabled={busy} onFiles={addFiles} description="Confirmez les associations ci-dessous, puis lancez l’envoi. Le dépôt seul ne transfère aucun fichier." />}
    {compact ? <p>{entries.length} fichier(s) · {ready} vérifié(s) · {errors} à reprendre</p> : <div className={admin.summary}><div><span>Dans le lot</span><strong>{entries.length} fichier(s)</strong></div><div><span>Validés</span><strong>{ready} prêt(s)</strong></div><div><span>Reprise ciblée</span><strong>{errors} erreur(s)</strong></div></div>}
    {compact && Object.keys(progresses).length > 0 ? <div><label>Progression de l’import<progress className={styles.progress} aria-label="Progression de l’import" max={100} value={expressBatchPercent(progresses, entries.map(e => e.id), states)} /></label><p role="status">{expressBatchPercent(progresses, entries.map(e => e.id), states)} % · {ready}/{entries.length} fichier(s) vérifié(s). {errors ? `${errors} traitement(s) arrêté(s) : consultez les motifs avant de reprendre.` : ""}</p></div> : null}
    <div className={styles.actions}>{!autoStart || errors ? <button type="button" disabled={busy || automaticBusy || !entries.length} onClick={() => void batch()}>{busy ? "Lot en cours…" : autoStart ? "Reprendre les fichiers en erreur" : perTrackTargetPrefix ? "Envoyer tous les fichiers sélectionnés" : "Envoyer / reprendre le lot associé"}</button> : null}{busy ? <button type="button" className={styles.quiet} onClick={() => { stop.current = true; for (const row of rows.current.values()) row.stop(); }}>Suspendre le lot</button> : null}</div><p role="status">{message}</p>
    {perTrackTargetPrefix ? tracks.map(track => targets[track.id] ? createPortal(<><DigitalAudioDropzone compact minimal multiple={false} heading={`Audio du titre ${String(track.position).padStart(2, "0")}`} disabled={busy} onFiles={incoming => addTrackFile(track.id, incoming)} />{trackError?.trackId === track.id ? <p role="alert">{trackError.message}</p> : null}{entries.filter(entry => entry.trackId === track.id).map(renderEntry)}</>, targets[track.id], track.id) : null) : entries.map(renderEntry)}
    <details className={admin.details}><summary>Limites et versions des fichiers</summary><p>Depuis un WAV : source privée, MP3 privé créé automatiquement (320 kbit/s par défaut) et extrait borné. Depuis un MP3 : source compressée conservée, sans faux master WAV ni qualité supérieure annoncée. 512 Mio par WAV · 50 fichiers sélectionnés · 2 traitements au maximum · nouveaux extraits depuis 0 seconde, 60 s maximum. Une association déjà validée ne se modifie pas : sa correction exige une nouvelle version et une vérification. Aucun fichier déjà acquis n’est remplacé.</p></details>
  </section>;
}
