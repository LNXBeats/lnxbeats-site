"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { loadExpressProject } from "@/lib/digital/express-service";
import { EXPRESS_DEFAULTS, type ExpressDefaults, type ExpressDraft } from "@/lib/digital/express-policy";
import { CATALOG_PRIMARY_ARTIST } from "@/lib/catalog/artist-identity";
import { parseEuroCents } from "@/lib/digital/domain";
import { expressCachedSnapshotMatches, expressEditorLocked, expressEditorTracks, expressDurationLabel, hasDistinctSingleTitle, recoverExpressAttempt, type ExpressEditorTrack } from "@/lib/digital/express-presentation";
import { DigitalAdminPreview, DigitalBatchUpload } from "./digital-admin";
import { DigitalRightsReview } from "./digital-rights-review";
import { OWNER_EXCERPTS_AT_PUBLICATION_POLICY, OWNER_PUBLICATION_POLICY } from "@/lib/digital/owner-declaration";
import { ExpressPublicationConfirmation } from "./express-publication-confirmation";
import { ExpressCollaborations } from "./express-collaborations";
import { ExpressVersionReview } from "./express-version-review";
import { CatalogCoverForm } from "./catalog-cover-form";
import { StudioReview } from "./studio-review";
import { DigitalAudioDropzone } from "./digital-audio-dropzone";
import { bindExpressTrackFiles, selectExpressTrackFile } from "@/lib/digital/express-audio-selection";
import type { StudioJobView } from "@/lib/digital/studio-presentation";
import styles from "./music-express.module.css";

type Project = Awaited<ReturnType<typeof loadExpressProject>>;
type Row = ExpressEditorTrack & { clientKey?: string };
type PublicationAttempt = { projectId: string; reviewToken: string; confirmed: boolean; publishMode: "PREMIERE" | "SALE"; rightsDeclaration: string; artisticDeclaration?: string; idempotencyKey: string };
const transientRowKeys = new WeakMap<Row, string>();
function audioRowKey(track: Row) {
  if (track.id) return track.id;
  if (track.clientKey) return track.clientKey;
  let key = transientRowKeys.get(track);
  if (!key) { key = crypto.randomUUID(); transientRowKeys.set(track, key); }
  return key;
}
const euros = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const money = (c: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(c / 100);
const row = (price: number, title = ""): Row => ({ id: null, title, price: euros(price), expectedOfferVersion: 0 });
async function api<T>(operation: string, input: unknown): Promise<T> {
  const r = await fetch("/api/admin/digital/express", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, input }) });
  const v = await r.json(); if (!r.ok) {
    if (r.status < 500) throw new ExpressResponseError(v.error ?? "Enregistrement refusé. Vos saisies sont conservées.");
    throw Error("Résultat serveur à vérifier.");
  } return v;
}
class ExpressResponseError extends Error {}
export function MusicExpress({ initial, defaults: initialDefaults, mode, ownerId, reviewOnOpen = false }: { initial: Project | null; defaults: ExpressDefaults; mode: string; ownerId: string; reviewOnOpen?: boolean }) {
  const [project, setProject] = useState(initial), [defaults, setDefaults] = useState(initialDefaults), [title, setTitle] = useState(initial?.title ?? ""), [type, setType] = useState<"SINGLE" | "ALBUM">(initial?.type === "ALBUM" ? "ALBUM" : "SINGLE");
  const [releaseDate, setReleaseDate] = useState(initial?.releaseDate ?? "");
  const [membersPreviewEnabled, setMembersPreviewEnabled] = useState(initial?.membersPreviewEnabled ?? false);
  const [hasCollaborations, setHasCollaborations] = useState(initial?.hasCollaborations ?? false);
  const initialRows = (p: Project): Row[] => p.tracks.map(t => ({ id: t.id, title: t.title, price: euros(t.offer?.priceCents ?? EXPRESS_DEFAULTS.trackPriceCents), expectedOfferVersion: t.offer?.version ?? 0 }));
  const [tracks, setTracks] = useState<Row[]>(initial ? initialRows(initial) : [row(defaults.trackPriceCents)]), [count, setCount] = useState(String(initial?.tracks.length ?? 1)), [albumPrice, setAlbumPrice] = useState(initial?.albumOffer?.priceCents == null ? euros(defaults.albumPriceCents) : euros(initial.albumOffer.priceCents));
  // The shortcut reviews only the already-saved server snapshot. GET/render
  // never saves a draft or restores a consent; the final action remains explicit.
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [reviewing, setReviewing] = useState(!!initial && reviewOnOpen), [confirmed, setConfirmed] = useState(false), [cacheReady, setCacheReady] = useState(false);
  const [publishMode, setPublishMode] = useState<"PREMIERE" | "SALE">(reviewOnOpen ? "SALE" : "PREMIERE");
  const [publicationAttempt, setPublicationAttempt] = useState<PublicationAttempt | null>(null);
  const [defaultTrack, setDefaultTrack] = useState(euros(defaults.trackPriceCents)), [defaultAlbum, setDefaultAlbum] = useState(euros(defaults.albumPriceCents)), [profileName, setProfileName] = useState(defaults.artistName);
  const [artistName, setArtistName] = useState(CATALOG_PRIMARY_ARTIST);
  const [distinctSingleTitle, setDistinctSingleTitle] = useState(initial?.type === "SINGLE" && hasDistinctSingleTitle(initial.title, initial.tracks));
  const [uncertain, setUncertain] = useState(false), [preparedCover, setPreparedCover] = useState<File | null>(null);
  const [audioRequested, setAudioRequested] = useState(false);
  const [preparedAudio, setPreparedAudio] = useState<Record<string, File>>({});
  const audioPrepared = useCallback(() => setPreparedAudio({}), []);
  const [studioEnabled, setStudioEnabled] = useState(false), [studioRequested, setStudioRequested] = useState(true), [studioRevision, setStudioRevision] = useState(0), [studioAvailabilityKnown, setStudioAvailabilityKnown] = useState(false);
  const [studioJobs, setStudioJobs] = useState<StudioJobView[]>([]);
  const updateStudioJobs = useCallback((jobs: StudioJobView[]) => setStudioJobs(jobs), []);
  const studioAvailability = useCallback((enabled: boolean) => { setStudioEnabled(enabled); setStudioAvailabilityKnown(true); }, []);
  const pending = useRef<ExpressDraft | null>(null), inFlight = useRef(false), hydrated = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  const key = `lnx:express:${ownerId}:${project?.id ?? "nouveau"}`, revision = project?.updatedAt ?? null;
  const attemptKey = `lnx:express-attempt:${ownerId}:${project?.id ?? "nouveau"}`;
  useEffect(() => {
    const timer = setTimeout(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    // Reloading metadata never restores consent, rights approval or a selected File.
    try {
      const cached = JSON.parse(localStorage.getItem(key) ?? "null");
      if (cached && cached.updatedAt === revision && typeof cached.title === "string" && ["SINGLE", "ALBUM"].includes(cached.type) && Array.isArray(cached.tracks) && cached.tracks.length > 0 && cached.tracks.length <= 100
        && cached.tracks.every((t: Row) => t && typeof t.title === "string" && typeof t.price === "string")
        && !(reviewOnOpen && initial && expressCachedSnapshotMatches(cached, initial, initialDefaults))) {
        setReviewing(false); setConfirmed(false);
        setTitle(cached.title); setType(cached.type); setTracks(cached.tracks.map((track: Row) => ({ id: track.id, title: track.title, price: track.price, expectedOfferVersion: track.expectedOfferVersion }))); setCount(typeof cached.count === "string" ? cached.count : String(cached.tracks.length)); setAlbumPrice(cached.albumPrice);
        if (typeof cached.releaseDate === "string") setReleaseDate(cached.releaseDate);
        if (typeof cached.hasCollaborations === "boolean") setHasCollaborations(cached.hasCollaborations);
        setDistinctSingleTitle(cached.distinctSingleTitle ?? (cached.type === "SINGLE" && hasDistinctSingleTitle(cached.title, cached.tracks)));
        setMessage("Saisie récupérée sur cet appareil, pas encore enregistrée. Aucun droit ni consentement restauré.");
      }
      const attempt = recoverExpressAttempt(JSON.parse(localStorage.getItem(attemptKey) ?? "null"), project?.id ?? null);
      if (attempt) {
        setReviewing(false); setConfirmed(false);
        pending.current = attempt; setUncertain(true); setTitle(attempt.title); setType(attempt.type);
        setTracks(attempt.tracks.map(t => ({ ...t, price: euros(t.priceCents) }))); setCount(String(attempt.tracks.length)); setAlbumPrice(euros(attempt.albumPriceCents));
        if (attempt.releaseDate !== undefined) setReleaseDate(attempt.releaseDate ?? "");
        if (attempt.membersPreviewEnabled !== undefined) setMembersPreviewEnabled(attempt.membersPreviewEnabled);
        if (attempt.hasCollaborations !== undefined) setHasCollaborations(attempt.hasCollaborations);
        setDistinctSingleTitle(attempt.type === "SINGLE" && hasDistinctSingleTitle(attempt.title, attempt.tracks));
        setMessage("Enregistrement à reprendre : utilisez la même action pour retrouver ce brouillon avant de modifier la saisie.");
      }
    } catch { /* The server draft is authoritative when browser storage is unavailable. */ }
    setCacheReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [key, revision, attemptKey, project?.id, reviewOnOpen, initial, initialDefaults]);
  useEffect(() => {
    if (!cacheReady) return;
    try { localStorage.setItem(key, JSON.stringify({ title, type, releaseDate, hasCollaborations, tracks: tracks.map(({ id, title, price, expectedOfferVersion }) => ({ id, title, price, expectedOfferVersion })), count, albumPrice, distinctSingleTitle, updatedAt: revision })); } catch { /* Server saving remains available. */ }
  }, [title, type, releaseDate, hasCollaborations, tracks, count, albumPrice, distinctSingleTitle, key, cacheReady, revision]);
  useEffect(() => { const timer = setTimeout(() => { if (initial) setProject(initial); }, 0); return () => clearTimeout(timer); }, [initial]);
  function dirty() { setReviewing(false); setConfirmed(false); setMessage(""); pending.current = null; }
  function changedTrack(index: number, change: Partial<Row>) { dirty(); setTracks(old => old.map((t, i) => i === index ? { ...t, clientKey: audioRowKey(t), ...change } : t)); }
  function reorder(index: number, delta: number) { dirty(); setTracks(old => { const next = [...old], target = index + delta; if (target < 0 || target >= next.length) return old; [next[index], next[target]] = [next[target], next[index]]; return next; }); }
  function generate() {
    const n = Number(count);
    if (!Number.isSafeInteger(n) || n < 1 || n > 100 || type === "SINGLE" && n !== 1) { setMessage("Choisissez entre 1 et 100 pistes ; un single contient une piste."); return; }
    if (n < tracks.length) {
      if (tracks.slice(n).some(t => t.id || t.title.trim() || preparedAudio[audioRowKey(t)] || t.price !== euros(defaults.trackPriceCents))) { setMessage("Les lignes déjà saisies sont conservées. La suppression de pistes existantes reste dans le Catalogue avancé."); return; }
      dirty(); setTracks(old => old.slice(0,n)); return;
    }
    dirty(); setTracks(old => [...old, ...Array.from({ length: n - old.length }, () => row(defaults.trackPriceCents))]);
  }
  async function save() {
    if (inFlight.current || publicationAttempt) return null;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const input = pending.current ?? { projectId: project?.id ?? null, expectedUpdatedAt: project?.updatedAt ?? null, title, type, releaseDate: releaseDate || null, membersPreviewEnabled, hasCollaborations,
        tracks: expressEditorTracks(type, title, tracks, distinctSingleTitle),
        albumPriceCents: parseEuroCents(albumPrice), expectedAlbumOfferVersion: project?.albumOffer?.version ?? 0, idempotencyKey: crypto.randomUUID() };
      pending.current = input;
      try { localStorage.setItem(attemptKey, JSON.stringify(input)); } catch { /* Same-page retry remains idempotent. */ }
      const { project: p } = await api<{ project: Project }>("draft", input);
      const boundAudio = bindExpressTrackFiles(preparedAudio, tracks.map(track => ({ key: audioRowKey(track), id: track.id })), p.tracks);
      setPreparedAudio(Object.fromEntries(boundAudio.map(({ file, trackId }) => [trackId, file])));
      setProject(p); setTitle(p.title); setReleaseDate(p.releaseDate ?? ""); setMembersPreviewEnabled(p.membersPreviewEnabled ?? false); setHasCollaborations(p.hasCollaborations ?? false); setTracks(initialRows(p)); pending.current = null; setUncertain(false);
      setDistinctSingleTitle(p.type === "SINGLE" && hasDistinctSingleTitle(p.title, p.tracks));
      try { localStorage.removeItem(key); localStorage.removeItem(attemptKey); } catch { /* optional */ }
      window.history.replaceState(null, "", `/admin/musique/express?projet=${p.id}`);
      setMessage("Modifications sauvegardées. Les offres déjà actives sont conservées ; aucune nouvelle vente ouverte.");
      return p;
    } catch (error) {
      // A 5xx or transport failure can follow a committed draft. Preserve the exact attempt.
      if (error instanceof ExpressResponseError) { pending.current = null; setUncertain(false); try { localStorage.removeItem(attemptKey); } catch { /* optional */ } }
      else if (pending.current) setUncertain(true);
      setMessage(error instanceof ExpressResponseError ? error.message : pending.current ? "Résultat à vérifier. Reprenez cet enregistrement : le même identifiant sera utilisé, sans créer un autre projet." : error instanceof Error && error.message === "INVALID_PRICE" ? "Vérifiez les prix : utilisez un montant positif en euros, avec deux décimales maximum. Vos saisies sont conservées." : "Vérifiez le titre et les prix. Vos saisies sont conservées."); requestAnimationFrame(() => feedback.current?.focus()); return null;
    }
    finally { inFlight.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!audioRequested || !project) return;
    const timer = setTimeout(() => { const audio = document.getElementById("audio"); audio?.focus({ preventScroll: true }); audio?.scrollIntoView({ behavior: "smooth", block: "start" }); setAudioRequested(false); }, 0);
    return () => clearTimeout(timer);
  }, [audioRequested, project]);
  async function saveAndImport() { const p = await save(); if (p) setAudioRequested(true); }
  async function refreshFiles() {
    if (!project) return;
    try { const r = await fetch(`/api/admin/digital/express?projectId=${project.id}`, { cache: "no-store" }); if (!r.ok) throw Error(); const v = await r.json(); setProject(v.project); setReviewing(false); setConfirmed(false); setStudioRevision(old => old + 1); }
    catch { setMessage("Actualisation impossible. Le brouillon serveur et vos saisies sont conservés."); }
  }
  async function review(mode: "PREMIERE" | "SALE") {
    const p = await save(); if (!p) return;
    setPublishMode(mode); setReviewing(true); setConfirmed(false); document.getElementById("verification")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function confirmPublication() {
    if (!cacheReady || inFlight.current || !project || !confirmed || project.blockers.length) return;
    const input = publicationAttempt ?? { projectId: project.id, reviewToken: project.reviewToken, confirmed, publishMode, rightsDeclaration: OWNER_PUBLICATION_POLICY,
      ...(project.tracks.some(track => track.artisticAtPublication && track.artisticStatus !== "VALIDATED") ? { artisticDeclaration: OWNER_EXCERPTS_AT_PUBLICATION_POLICY } : {}), idempotencyKey: crypto.randomUUID() };
    inFlight.current = true; setBusy(true);
    try {
      const value = await api<{ project: Project; premiere?: boolean }>("publish", input);
      setProject(value.project); setConfirmed(false); setPublicationAttempt(null); setReviewing(false);
      setMessage(value.premiere ? "Avant-première membres publiée. Les offres et achats existants sont conservés." : "Publication enregistrée. Les achats et versions historiques sont conservés.");
    } catch (error) {
      if (error instanceof ExpressResponseError) { setPublicationAttempt(null); setConfirmed(false); setMessage(error.message); }
      else { setPublicationAttempt(input); setMessage("Résultat de publication à vérifier. Utilisez Reprendre la même publication, sans changer de version ni recommencer une autre demande."); }
    } finally { inFlight.current = false; setBusy(false); }
  }
  function trackAudioField(track: Row, index: number) {
    const rowKey = audioRowKey(track), selected = preparedAudio[rowKey];
    const heading = type === "SINGLE" ? "Audio de ce single" : `Audio du titre ${String(index + 1).padStart(2, "0")}`;
    if (project && track.id) return <div className={styles.rowAudio} aria-label={heading}>{selected ? <div className={styles.rowSelectedAudio}><span>{selected.name}<small>Sélection locale conservée jusqu’à son ajout à la file.</small></span><button type="button" className={styles.secondary} disabled={locked} aria-label={`Retirer la sélection en attente du titre ${index + 1}`} onClick={() => { setPreparedAudio(old => { const next = { ...old }; delete next[rowKey]; return next; }); setMessage(""); }}>Retirer la sélection</button></div> : null}<div id={`express-track-audio-${track.id}`} /><div id={`express-track-studio-${track.id}`} /></div>;
    return <div className={styles.rowAudio}><DigitalAudioDropzone compact minimal multiple={false} heading={heading} disabled={locked} onFiles={incoming => {
      const selection = selectExpressTrackFile(preparedAudio, rowKey, incoming);
      if (!selection.error) setTracks(old => old.map(row => row === track ? { ...row, clientKey: rowKey } : row));
      setPreparedAudio(selection.files);
      setMessage(selection.error ?? "Fichier choisi. Créer le brouillon lancera son envoi et son traitement automatique.");
    }} />{selected ? <div className={styles.rowSelectedAudio}><span>{selected.name}<small>{(selected.size / 1024 / 1024).toFixed(1)} Mio · sélection locale, pas encore envoyée</small></span><button type="button" className={styles.secondary} disabled={locked} aria-label={`Retirer le fichier du titre ${index + 1}`} onClick={() => { setPreparedAudio(old => { const next = { ...old }; delete next[rowKey]; return next; }); setMessage(""); }}>Retirer</button></div> : null}</div>;
  }
  const preparedAssignments = project ? project.tracks.flatMap(track => preparedAudio[track.id] ? [{ file: preparedAudio[track.id], trackId: track.id }] : []) : [];
  const audioTracks = project ? project.tracks.map(track => { const local = tracks.find(row => row.id === track.id); return { ...track, title: local ? type === "SINGLE" && !distinctSingleTitle ? title : local.title : track.title, position: Math.max(1, tracks.findIndex(row => row.id === track.id) + 1) }; }) : [];
  const active = project?.tracks.some(t => t.offer?.active) || project?.albumOffer?.active;
  const locked = expressEditorLocked(cacheReady, busy, !!active, uncertain) || !!publicationAttempt;
  const audioReady = !!project && project.tracks.every(t => t.strictReady);
  const rightsReady = !!project && project.tracks.every(t => t.review?.status === "APPROVED");
  const premiereOnly = !!project?.membersPreviewEnabled && publishMode === "PREMIERE";
  function previewTrack(t: NonNullable<Project>["tracks"][number]) {
    const job = studioJobs.find(job => job.trackId === t.id), prepared = job?.status === "READY" && job.artifacts.some(a => a.role === "MP3" && a.metadataVerified) && job.artifacts.some(a => a.role === "WAV_CD" && a.metadataVerified);
    const duration = t.durationMs ?? (prepared ? job.artifacts.find(a => a.role === "MP3")?.durationMs ?? null : null);
    const formats = !t.masterId && prepared ? job.sourceLossy ? "MP3 + WAV converti préparés — candidate privée" : "MP3 + WAV préparés — candidate privée" : t.formats;
    return <div key={t.id} style={{ gridColumn: "1/-1" }}><h3>{t.position}. {t.title} · {t.offer?.priceCents ? money(t.offer.priceCents) : "Prix à compléter"}</h3><p className={styles.muted}><span title={duration == null ? undefined : `${duration} ms`}>{expressDurationLabel(duration)}</span> · {formats}<br />{prepared && !t.masterId ? "Traitement terminé : écoutez les lecteurs sous le titre, puis utilisez ces fichiers." : `Droits : ${t.review?.status === "APPROVED" ? "enregistrés" : "avec la publication"} · Extrait : ${t.artisticStatus === "VALIDATED" ? "validé" : "à écouter"}`}</p>{t.previewUrl ? <DigitalAdminPreview src={t.previewUrl} title={t.title} /> : null}</div>;
  }
  return <main className={styles.root}>
    <Link href="/admin/musique">← Musique</Link>
    <header className={styles.top}><div><p className={styles.kicker}>LNX Beats · Studio Express</p><h1>{project ? "Préparer ma musique" : "Ajouter une musique"}</h1><p className={styles.muted}>Une fiche, vos fichiers, vos prix. Les contrôles restent en place.</p></div><span className={styles.badge}>{mode === "LIVE" ? "Administration" : "QA locale · aucune vente réelle"}</span></header>
    <p className={styles.banner}>{project?.membersPreviewEnabled ? active ? "Préachat · paiement et téléchargement immédiats. Les extraits d’avant-première restent réservés aux membres." : project.publicVisible ? "Avant-première réservée aux membres. Aucune vente ouverte pour le moment ; l’ouverture se confirme séparément." : "Avant-première en brouillon privé. Aucun accès membre ni vente avant votre confirmation." : project?.publicVisible ? "Édition publiée. Les nouvelles versions et les offres restent soumises aux contrôles de droits." : "Brouillon privé. Aucune vente avant votre confirmation et les contrôles de droits."}</p>
    {project?.membersPreviewEnabled ? <section className={styles.card} aria-labelledby="premiere-votes-heading"><h2 id="premiere-votes-heading">Les avis des membres</h2>
      {project.premiereVotes ? <p><span aria-hidden="true">👍</span> Plutôt oui : <strong>{project.premiereVotes.up}</strong> · <span aria-hidden="true">👎</span> Pas encore : <strong>{project.premiereVotes.down}</strong></p> : <p>Les avis ne sont pas encore chargés.</p>}
      <p className={styles.muted}>Un avis modifiable par compte. Ce sondage ne valide aucun droit et ne déclenche aucune publication ni mise en vente.</p>
    </section> : null}
    <p className={styles.muted}>Artiste principal affiché sur ce site : <strong>{CATALOG_PRIMARY_ARTIST}</strong>. Identité distincte des auteurs, compositeurs et titulaires de droits ; aucun crédit ni justificatif historique remplacé.</p>
    <nav aria-label="Étapes Express"><ol className={styles.steps}><li><a href="#identite">1. Musique</a></li><li>{project ? <a href="#audio">2. Audio · {audioReady ? "prêt" : "à compléter"}</a> : <span>2. Audio</span>}</li><li>{project ? <a href="#droits">3. Droits · {rightsReady ? "enregistrés" : "avec la publication"}</a> : <span>3. Droits</span>}</li><li>{project ? <a href="#verification">4. Vérification</a> : <span>4. Vérification</span>}</li></ol></nav>
    <section className={styles.card} id="identite"><h2>Votre single ou album</h2>
      <div className={styles.grid}><label>Type<select disabled={!!project || locked} value={type} onChange={e => { const next = e.target.value as "SINGLE" | "ALBUM"; if (next === "SINGLE" && tracks.length > 1) { setMessage("Conservez l’album : plusieurs pistes sont déjà saisies."); return; } dirty(); setType(next); }}><option value="SINGLE">Single · un titre</option><option value="ALBUM">Album · plusieurs titres</option></select></label><label>{type === "SINGLE" ? "Titre de la musique" : "Nom de l’album"}<input maxLength={240} value={title} disabled={locked} onChange={e => { dirty(); setTitle(e.target.value); }} placeholder="Le nom de votre prochaine sortie" /></label></div>
      <label className={styles.releaseDate}>Publication prévue sur les plateformes (facultatif)<input type="date" value={releaseDate} disabled={locked} onChange={e => { dirty(); setReleaseDate(e.target.value); }} /><small>Date de parution uniquement : aucun envoi vers DistroKid ou les plateformes, aucune mise en vente automatique.</small></label>
      <label className={styles.check}><input type="checkbox" checked={membersPreviewEnabled} disabled={locked} onChange={e => { dirty(); setMembersPreviewEnabled(e.target.checked); }} /><span>Avant-première réservée aux membres<small className={styles.previewHelp}>Pour une sortie future : seuls les extraits autorisés seront accessibles aux membres connectés. Cette option seule n’active aucune offre. La vente avant sortie se confirme séparément, avec paiement et téléchargement immédiats.</small></span></label>
      {project?.tracks.some(t => t.masterId) && releaseDate !== (project.releaseDate ?? "") ? <p className={styles.muted}>Une date modifiée après la préparation audio peut nécessiter une nouvelle vérification des métadonnées. Les anciennes versions et validations ne sont pas réécrites.</p> : null}
      {type === "ALBUM" ? <div className={styles.actions}><label>Nombre de pistes<input type="number" min={1} max={100} value={count} disabled={locked} onChange={e => setCount(e.target.value)} /></label><button className={styles.secondary} onClick={generate} disabled={locked}>Préparer les lignes</button><label>Prix de l’album (€)<input inputMode="decimal" value={albumPrice} onChange={e => { dirty(); setAlbumPrice(e.target.value); }} disabled={locked} /></label></div> : <label className={styles.singlePrice}>Prix du titre (€)<input inputMode="decimal" value={tracks[0]?.price ?? ""} onChange={e => changedTrack(0, { price: e.target.value })} disabled={locked} /></label>}
      {type === "ALBUM" ? <div>{tracks.map((t, i) => <div className={styles.track} key={audioRowKey(t)}><span>{String(i + 1).padStart(2, "0")}</span><label>Titre de la piste<input value={t.title} maxLength={240} onChange={e => changedTrack(i, { title: e.target.value })} disabled={locked} /></label><label>Prix (€)<input inputMode="decimal" value={t.price} onChange={e => changedTrack(i, { price: e.target.value })} disabled={locked} /></label><div className={styles.order}><button className={styles.secondary} aria-label={`Monter la piste ${i + 1}`} disabled={locked || i === 0} onClick={() => reorder(i, -1)}>↑</button><button className={styles.secondary} aria-label={`Descendre la piste ${i + 1}`} disabled={locked || i === tracks.length - 1} onClick={() => reorder(i, 1)}>↓</button></div>{trackAudioField(t, i)}</div>)}</div> : tracks[0] ? trackAudioField(tracks[0], 0) : null}
      {!project ? <details open={type === "ALBUM" || undefined}><summary>Pochette (facultative à cette étape)</summary><label className={styles.coverPick}>Choisir une pochette<input type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={e => setPreparedCover(e.target.files?.[0] ?? null)} /></label></details> : null}
      <div className={styles.actions}><button disabled={busy || !cacheReady || !!publicationAttempt} onClick={() => void saveAndImport()}>{uncertain ? "Reprendre le brouillon et l’import" : project ? "Enregistrer et continuer l’import" : "Créer le brouillon et importer mes musiques"}</button></div>
      {type === "SINGLE" ? <details open={distinctSingleTitle || undefined}><summary>Options avancées du single</summary><label className={styles.check}><input type="checkbox" checked={distinctSingleTitle} disabled={locked} onChange={e => { dirty(); setDistinctSingleTitle(e.target.checked); }} /><span>Utiliser un titre de piste différent du nom de la sortie</span></label>{distinctSingleTitle ? <label>Titre de piste distinct<input value={tracks[0]?.title ?? ""} disabled={locked} onChange={e => changedTrack(0, { title: e.target.value })} /></label> : null}</details> : null}
      {project ? <details id="pochette-express" open={!project.cover || !!preparedCover || undefined}><summary>Pochette — ajouter ou remplacer</summary>{project.cover ? <div className={styles.preview}><Image unoptimized width={240} height={240} src={project.cover.url} alt={project.cover.alt} /><p>Image actuelle conservée jusqu’à l’enregistrement explicite de la suivante.</p></div> : null}<fieldset disabled={!!publicationAttempt}><CatalogCoverForm key={project.cover?.id ?? "sans-pochette"} projectId={project.id} slug={project.slug} currentCoverAssetId={project.cover?.id ?? null} hasCover={!!project.cover} ownerDeclarationAtUpload={project.status === "DRAFT" && !project.publicVisible && !active} alt={project.cover?.alt ?? ""} altPlaceholder={`Pochette de ${project.title}`} preparedFile={preparedCover} onSaved={async () => { setPreparedCover(null); await refreshFiles(); }} returnTo={`/admin/musique/express?projet=${project.id}`} /></fieldset></details> : null}
    </section>
    {project ? <><section id="audio" tabIndex={-1} className={styles.card}><h2>Préparation audio</h2>{studioEnabled ? <details><summary>Options de préparation audio</summary><label className={styles.check}><input type="checkbox" checked={studioRequested} onChange={e => setStudioRequested(e.target.checked)} /> Appliquer LNX Beats Studio aux prochains fichiers choisis.</label></details> : null}{studioAvailabilityKnown ? <DigitalBatchUpload tracks={audioTracks} compact autoStart studio={studioEnabled && studioRequested} preparedAssignments={preparedAssignments} perTrackTargetPrefix="express-track-audio-" onInitialFilesAccepted={audioPrepared} onStudioQueued={() => setStudioRevision(old => old + 1)} onValidated={() => void refreshFiles()} /> : <div role="status"><p>Vérification de la préparation audio avant l’envoi des fichiers… Aucun transfert n’est démarré.</p><button type="button" className={styles.secondary} onClick={() => setStudioRevision(old => old + 1)}>Réessayer la vérification</button></div>}<StudioReview projectId={project.id} trackTargetPrefix="express-track-studio-" refreshRevision={studioRevision} onAvailability={studioAvailability} onJobsChanged={updateStudioJobs} onSaved={refreshFiles} /><div className={styles.actions}><Link href={`/admin/musique/${project.slug}/extraits?courants=1`}>Écouter les extraits →</Link><button className={styles.secondary} onClick={() => void refreshFiles()}>Actualiser les fichiers</button></div></section>
    <details id="droits" className={styles.card}><summary>Crédits et collaborations (options)</summary><p>Crédits par défaut : LNX Beats Studio · composition : Ludovic Mickaël Mathon. Les collaborations et crédits existants sont conservés.</p><ExpressVersionReview projectId={project.id} onSaved={refreshFiles} rightsOnPublication /><details><summary>Comprendre la déclaration et ses limites</summary><p>La confirmation finale conserve votre déclaration personnelle et les versions exactes, sans certification indépendante. Les collaborations, reprises, samples et restrictions restent traités séparément.</p></details>
      {project ? <><p>Crédits sources conservés en Admin : {project.credits.map(c => `${c.role} : ${c.name}`).join(" · ") || "à renseigner"}.</p><details><summary>Renseigner le nom artistique publié</summary><p>Action documentaire explicite seulement. Les variantes du nom principal déjà documentées ne créent pas de doublon. Ce crédit n’attribue aucun autre rôle et n’approuve aucun droit. Les collaborations et crédits détaillés restent dans le Catalogue.</p><label>Artiste crédité<input value={artistName} maxLength={180} placeholder="Nom artistique exact à publier" onChange={e => setArtistName(e.target.value)} /></label><button disabled={busy || !artistName.trim() || !!active} onClick={async () => { setBusy(true); try { const value = await api<{ project: Project }>("artist", { projectId: project.id, name: artistName }); setProject(value.project); setArtistName(CATALOG_PRIMARY_ARTIST); setReviewing(false); setMessage("Crédit artiste vérifié sans doublon ; identité d’affichage séparée, aucun droit commercial approuvé."); } catch (e) { setMessage(e instanceof Error ? e.message : "Crédit refusé."); } finally { setBusy(false); } }}>Confirmer ce crédit</button></details><p><a href={`/api/admin/digital/express?projectId=${project.id}&manifeste=1`}>Télécharger le manifeste technique privé</a> — inventaire des fichiers, pas preuve indépendante de propriété intellectuelle.</p><details><summary>Déclaration groupée des droits sur les versions contrôlées</summary><DigitalRightsReview projectId={project.id} tracks={project.tracks.flatMap(t => t.masterId && t.review ? [{ masterId: t.masterId, title: t.title, version: t.version, strictReady: t.strictReady, review: t.review }] : [])} /></details></> : <p>La revue sera liée aux identifiants et empreintes exacts des fichiers validés, jamais à un simple nom de piste.</p>}
    </details>
    <section id="verification" className={styles.card}><h2>Prévisualisation privée</h2>{project ? <><div className={styles.preview}>{project.cover ? <Image unoptimized width={240} height={240} src={project.cover.url} alt={project.cover.alt} /> : <span className={styles.badge}>Pochette à ajouter</span>}<div><h3>{project.title}</h3><p>{project.membersPreviewEnabled ? active ? "Préachat · paiement et téléchargement immédiats" : "Avant-première réservée aux membres · aucune offre activée" : project.type === "ALBUM" ? `Album · ${project.tracks.length} pistes · ${project.albumOffer?.priceCents ? money(project.albumOffer.priceCents) : "prix à compléter"}` : "Single · une seule offre titre"}</p><span className={styles.badge}>{project.publicVisible ? project.membersPreviewEnabled ? "Disponible aux membres" : "Déjà public" : project.membersPreviewEnabled ? "Avant-première en brouillon" : "Brouillon privé"}</span></div></div><div className={styles.summary}>{project.tracks.map(previewTrack)}</div>
      {reviewing ? <><h3>{premiereOnly ? "Derniers contrôles de l’avant-première" : project.membersPreviewEnabled ? "Derniers contrôles de la vente avant sortie" : "Derniers contrôles"}</h3>
        <ExpressPublicationConfirmation blockers={project.blockers} coverMissing={!project.cover} premiereOnly={premiereOnly} earlySale={!!project.membersPreviewEnabled && !premiereOnly} pendingExcerpts={project.tracks.filter(track => track.artisticAtPublication && track.artisticStatus !== "VALIDATED").length} missingRights={project.tracks.some(track => track.review?.status !== "APPROVED")} confirmed={confirmed} busy={busy || !cacheReady} retrying={!!publicationAttempt} onConfirm={setConfirmed} onPublish={() => void confirmPublication()} className={styles.check} /></> : <p className={styles.muted}>{project.membersPreviewEnabled ? "Choisissez l’avant-première seule ou la vente avant sortie. Chaque action enregistre le brouillon et demande sa propre confirmation ; aucun achat différé." : "« Vérifier et publier » enregistre d’abord le brouillon puis présente les blocages. Aucune ouverture sans confirmation."}</p>}</> : <p>Votre fiche apparaîtra ici après le premier enregistrement.</p>}</section>
    </> : null}
    <details className={styles.card}><summary>Options avancées</summary><label className={styles.check}><input type="checkbox" checked={hasCollaborations} disabled={locked} onChange={event => { dirty(); setHasCollaborations(event.target.checked); }} /> Cette sortie comporte une collaboration ou des crédits particuliers.</label>{project && (hasCollaborations || project.hasCollaborations) ? <ExpressCollaborations projectId={project.id} disabled={locked} onSaved={refreshFiles} /> : null}<details><summary>Paramètres pour les prochaines créations</summary><p>Ces valeurs préremplissent uniquement les nouvelles fiches. Aucun tarif existant ni droit ne sera modifié.</p><div className={styles.grid}><label>Titre par défaut (€)<input inputMode="decimal" value={defaultTrack} onChange={e => setDefaultTrack(e.target.value)} /></label><label>Album par défaut (€)<input inputMode="decimal" value={defaultAlbum} onChange={e => setDefaultAlbum(e.target.value)} /></label><label>Nom du profil interne (pas un crédit)<input value={profileName} maxLength={240} onChange={e => setProfileName(e.target.value)} /></label></div><div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={async () => { setBusy(true); try { const v = await api<{ defaults: ExpressDefaults }>("defaults", { trackPriceCents: parseEuroCents(defaultTrack), albumPriceCents: parseEuroCents(defaultAlbum), artistName: profileName }); setDefaults(v.defaults); setMessage("Paramètres enregistrés pour les prochaines créations seulement."); } catch (e) { setMessage(e instanceof Error ? e.message : "Paramètres refusés."); } finally { setBusy(false); } }}>Enregistrer les paramètres</button><button className={styles.secondary} onClick={() => { setDefaultTrack(euros(EXPRESS_DEFAULTS.trackPriceCents)); setDefaultAlbum(euros(EXPRESS_DEFAULTS.albumPriceCents)); setProfileName(EXPRESS_DEFAULTS.artistName); }}>Rétablir les valeurs par défaut</button></div></details>
    <details className={styles.card}><summary>Outils avancés et historique</summary><p>Crédits détaillés, dates, liens, équivalences, diagnostics et audits restent disponibles sans dupliquer le Catalogue.</p><div className={styles.actions}><Link href={project ? `/admin/catalogue/${project.slug}` : "/admin/catalogue"}>Catalogue historique</Link>{project ? <Link href={`/admin/musique/${project.slug}`}>Masters, offres et audits</Link> : null}</div></details>
    </details>
    <footer className={styles.footer}><div className={styles.actions}><button className={styles.secondary} disabled={busy || !cacheReady || !!publicationAttempt} onClick={() => void save()}>{busy ? "Enregistrement…" : uncertain ? "Reprendre l’enregistrement" : "Enregistrer les modifications"}</button><button className={membersPreviewEnabled ? styles.secondary : undefined} disabled={busy || uncertain || !cacheReady || !!publicationAttempt} onClick={() => void review(membersPreviewEnabled ? "PREMIERE" : "SALE")}>{membersPreviewEnabled ? "Vérifier l’avant-première" : "Vérifier et publier"}</button>{membersPreviewEnabled ? <button disabled={busy || uncertain || !cacheReady || !!publicationAttempt} onClick={() => void review("SALE")}>Vérifier la vente avant sortie</button> : null}</div><p ref={feedback} tabIndex={-1} role="status" aria-live="polite" className={styles.message}>{message || (active ? "Offres actives préservées : vous pouvez terminer les autres offres admissibles, sans les désactiver." : "Saisie conservée sur cet appareil · enregistrez votre brouillon pour la sauvegarder.")}</p></footer>
  </main>;
}
