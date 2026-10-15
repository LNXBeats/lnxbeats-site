"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DigitalExcerptSelection } from "@/lib/digital/excerpt-policy";
import { digitalImportStartMs } from "@/lib/digital/admin";
import { announceMediaPlayback, listenForOtherMediaPlayback } from "@/lib/media/playback-coordinator";
import { DigitalAdminPreview } from "./digital-admin";
import styles from "./digital-excerpt-review.module.css";

export type DigitalExcerptReviewTrack = { masterId: string; trackId: string; title: string; position: number;
  durationMs: number; provisionalStartMs: number; provisionalDurationMs: number; provisionalUrl: string | null;
  selection: DigitalExcerptSelection };
type Action = "save" | "generate" | "validate";
const stateLabel = (status: DigitalExcerptSelection["status"]) => status === "TO_LISTEN" ? "À écouter" : status === "VALIDATED" ? "Validé" : "À valider";
function time(milliseconds: number) {
  const ms = Math.max(0, Math.round(milliseconds));
  return `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
function seconds(milliseconds: number) { return (milliseconds / 1000).toFixed(3); }
function duration(milliseconds: number) { return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(milliseconds / 1000)} s`; }
async function requestSelection(masterId: string, input?: { action: Action; startMs: number; expectedRevisionId: string | null; idempotencyKey: string; attested: boolean }, signal?: AbortSignal): Promise<DigitalExcerptSelection> {
  const response = await fetch(`/api/admin/digital/excerpts/${masterId}`, { method: input ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal,
    ...(input ? { headers: { "content-type": "application/json" }, body: JSON.stringify(input) } : {}) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Le choix d’extrait n’a pas pu être enregistré.");
  return body.selection as DigitalExcerptSelection;
}

export function DigitalExcerptReview({ tracks }: { tracks: DigitalExcerptReviewTrack[] }) {
  const [active, setActive] = useState(0), [selections, setSelections] = useState(() => Object.fromEntries(tracks.map(track => [track.masterId, track.selection])));
  const validated = Object.values(selections).filter(selection => selection.status === "VALIDATED").length;
  return <div className={styles.review}>
    <section className={styles.navigation} aria-labelledby="excerpt-track-list">
      <div className={styles.heading}><h2 id="excerpt-track-list">Vos {tracks.length} titres</h2><p>{validated} / {tracks.length} extrait(s) validé(s)</p></div>
      <p>Vos choix enregistrés sont conservés d’une session à l’autre. Les passages actuels restent provisoires tant que vous ne les avez pas validés.</p>
      <ol className={styles.trackList}>{tracks.map((track, index) => <li key={track.masterId}><button type="button" className={styles.trackButton} aria-current={active === index ? "step" : undefined}
        onClick={() => setActive(index)}><span className={styles.trackNumber}>{String(track.position).padStart(2, "0")}</span><span className={styles.trackTitle}>{track.title}</span><span className={styles.badge} data-state={selections[track.masterId].status}>{stateLabel(selections[track.masterId].status)}</span></button></li>)}</ol>
    </section>
    <div className={styles.editors}>{tracks.map((track, index) => <ExcerptEditor key={track.masterId} track={track} active={index === active} index={index} count={tracks.length}
      selection={selections[track.masterId]} change={selection => setSelections(previous => ({ ...previous, [track.masterId]: selection }))}
      previous={() => setActive(index - 1)} next={() => setActive(index + 1)} />)}</div>
  </div>;
}

function ExcerptEditor({ track, active, index, count, selection, change, previous, next }: { track: DigitalExcerptReviewTrack; active: boolean; index: number; count: number;
  selection: DigitalExcerptSelection; change: (selection: DigitalExcerptSelection) => void; previous: () => void; next: () => void }) {
  const ownerId = `dcn-excerpt-master-${useId()}`, editor = useRef<HTMLElement>(null), audio = useRef<HTMLAudioElement>(null), segmentEnd = useRef<number | null>(null);
  const [offset, setOffset] = useState(seconds(selection.startMs)), [currentMs, setCurrentMs] = useState(0), [busy, setBusy] = useState<Action | "refresh" | null>(null);
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [attested, setAttested] = useState(false), [pollStopped, setPollStopped] = useState(false);
  const startMs = digitalImportStartMs(offset), valid = startMs !== null && startMs < track.durationMs;
  const previewDuration = valid ? Math.min(59_900, track.durationMs - startMs) : 0, changed = startMs !== selection.startMs;
  const queued = selection.status === "QUEUED", canValidate = selection.status === "READY" && !changed && !!selection.candidateUrl;
  useEffect(() => listenForOtherMediaPlayback(ownerId, () => audio.current?.pause()), [ownerId]);
  useEffect(() => { if (!active) editor.current?.querySelectorAll("audio").forEach(player => player.pause()); }, [active]);
  useEffect(() => {
    if (!queued || !active) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined, attempts = 0;
    const poll = async () => {
      try {
        const value = await requestSelection(track.masterId, undefined, controller.signal);
        if (controller.signal.aborted) return;
        change(value);
        if (value.status === "QUEUED" && ++attempts < 30) timer = setTimeout(() => void poll(), 2000);
        else if (value.status === "QUEUED") setPollStopped(true);
      } catch (cause) { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "L’état du traitement est indisponible."); setPollStopped(true); } }
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
    // The queue revision identifies one bounded polling cycle. A render must not restart its budget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, queued, selection.revisionId, track.masterId]);
  function edit(value: string) { setOffset(value); setAttested(false); setMessage(""); setError(""); }
  async function mutate(action: Action) {
    if (!valid || busy || queued || action === "validate" && (!canValidate || !attested)) return;
    setBusy(action); setError(""); setMessage("");
    if (action === "generate") setPollStopped(false);
    try {
      const value = await requestSelection(track.masterId, { action, startMs, expectedRevisionId: selection.revisionId, idempotencyKey: crypto.randomUUID(), attested: action === "validate" && attested });
      change(value); setOffset(seconds(value.startMs)); setAttested(false);
      setMessage(action === "save" ? "Brouillon enregistré. Vous pouvez poursuivre plus tard ou passer au titre suivant." : action === "generate" ? "Création du candidat demandée. Le master et l’extrait provisoire sont conservés." : "Votre choix d’extrait est validé et conservé. Aucune publication ni validation de droits n’a été effectuée.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement indisponible."); }
    finally { setBusy(null); }
  }
  async function refresh() {
    setBusy("refresh"); setError("");
    try { const value = await requestSelection(track.masterId); change(value); if (!changed) setOffset(seconds(value.startMs)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "État indisponible."); }
    finally { setBusy(null); }
  }
  function audition() {
    const player = audio.current; if (!player || !valid) return;
    segmentEnd.current = (startMs + previewDuration) / 1000; player.currentTime = startMs / 1000;
    void player.play().catch(() => { segmentEnd.current = null; setError("La lecture n’a pas démarré. Utilisez le lecteur privé ou réessayez."); });
  }
  return <article ref={editor} className={styles.editor} hidden={!active} aria-labelledby={`excerpt-${track.masterId}`}>
    <header className={styles.heading}><div><p className={styles.kicker}>Titre {track.position} sur {count}</p><h2 id={`excerpt-${track.masterId}`}>{track.title}</h2><p>Durée totale : {time(track.durationMs)} · WAV complet privé</p></div><span className={styles.badge} data-state={selection.status}>{stateLabel(selection.status)}</span></header>
    <section className={styles.section} aria-label="Écouter le master privé">
      <h3>1. Écouter la chanson</h3><p>Déplacez le curseur du lecteur pour explorer librement le morceau. Le fichier complet est réservé à votre session Admin.</p>
      <audio ref={audio} controls preload="none" src={`/api/admin/digital/masters/${track.masterId}`} aria-label={`Master privé de ${track.title}`}
        onPlay={() => announceMediaPlayback({ ownerId, kind: "audio" })} onPause={() => { segmentEnd.current = null; }}
        onTimeUpdate={event => { const player = event.currentTarget; setCurrentMs(Math.round(player.currentTime * 1000)); if (segmentEnd.current !== null && player.currentTime >= segmentEnd.current) player.pause(); }}
        onError={() => setError("Le master privé ne peut pas être lu. Vérifiez votre session Admin puis réessayez.")} />
      <div className={styles.inline}><output aria-label="Position dans la chanson">Position : {time(currentMs)}</output><button type="button" disabled={!!busy || queued || currentMs >= track.durationMs} onClick={() => edit(seconds(currentMs))}>Utiliser cette position comme début</button></div>
    </section>
    <section className={styles.section} aria-label="Choisir le passage">
      <h3>2. Choisir et écouter le passage</h3>
      <label className={styles.field} htmlFor={`start-${track.masterId}`}>Début souhaité, en secondes <span>Précision : 0,001 seconde.</span><input id={`start-${track.masterId}`} type="number" inputMode="decimal" min="0" max={seconds(track.durationMs - 1)} step="0.001" value={offset} disabled={!!busy || queued} onChange={event => edit(event.target.value)} aria-invalid={!valid} /></label>
      {valid ? <p className={styles.window}>Passage : <strong>{time(startMs)}</strong> → <strong>{time(startMs + previewDuration)}</strong> · {duration(previewDuration)} maximum avant encodage</p> : <p role="alert">Choisissez un début compris entre 0 et la fin du morceau, avec trois décimales maximum.</p>}
      {changed ? <p className={styles.help}>Cette saisie n’est pas encore enregistrée. Enregistrez le brouillon pour la retrouver après une reconnexion.</p> : null}
      <div className={styles.actions}><button type="button" className={styles.quiet} disabled={!valid} onClick={audition}>Écouter le passage choisi</button><button type="button" className={styles.quiet} onClick={() => audio.current?.pause()}>Arrêter l’écoute</button><button type="button" disabled={!valid || !!busy || queued} onClick={() => void mutate("save")}>{busy === "save" ? "Enregistrement…" : "Enregistrer le brouillon"}</button></div>
      <p className={styles.help}>Cette écoute utilise le master privé et s’arrête au bout du passage. Pour vérifier le fichier découpé exact, créez ensuite un candidat. Le brouillon ne remplace jamais l’extrait actuel.</p>
    </section>
    <section className={styles.section} aria-label="Extrait provisoire conservé"><h3>Extrait provisoire conservé</h3><p>Début : {time(track.provisionalStartMs)} · Durée mesurée : {duration(track.provisionalDurationMs)}</p>{track.provisionalUrl ? <DigitalAdminPreview src={track.provisionalUrl} title={`${track.title} — extrait provisoire`} /> : <p>Extrait provisoire indisponible.</p>}</section>
    <section className={styles.section} aria-label="Vérifier et valider le candidat">
      <h3>3. Vérifier puis valider votre choix</h3><div className={styles.actions}><button type="button" disabled={!valid || !!busy || queued} onClick={() => void mutate("generate")}>{busy === "generate" ? "Demande en cours…" : queued ? "Création du candidat en cours…" : "Créer l’extrait candidat privé"}</button>
        <button type="button" className={styles.quiet} disabled={!!busy} onClick={() => void refresh()}>Actualiser l’état</button></div>
      {queued ? <p role="status">Traitement audio en cours. {pollStopped ? "Le suivi automatique est arrêté après une minute ; utilisez « Actualiser l’état » pour consulter le résultat." : "Le résultat sera vérifié pendant une minute maximum, sans recommencer la génération."}</p> : null}
      {selection.status === "FAILED" ? <p role="alert">La création a échoué ({selection.errorCode ?? "traitement indisponible"}). Le brouillon, le master et le provisoire sont conservés. Vous pouvez réessayer explicitement.</p> : null}
      {selection.candidateUrl ? <div className={styles.candidate}><p>Début enregistré : {time(selection.startMs)} · Durée réelle : {selection.previewDurationMs ? duration(selection.previewDurationMs) : "à vérifier"}</p><DigitalAdminPreview src={selection.candidateUrl} title={`${track.title} — candidat privé`} />{changed ? <p>Le début saisi a changé : ce candidat correspond encore au choix enregistré. Générez un nouveau candidat avant de valider.</p> : null}</div> : <p className={styles.help}>Aucun nouveau candidat créé. L’extrait provisoire reste inchangé.</p>}
      {selection.status === "VALIDATED" && !changed ? <p className={styles.confirmed}>Choix validé par vous. Vous pouvez encore préparer un nouveau brouillon ; l’historique du choix précédent restera conservé.</p> : <><label className={styles.attestation}><input type="checkbox" checked={attested} disabled={!canValidate || !!busy} onChange={event => setAttested(event.target.checked)} /><span>J’ai écouté le fichier candidat et je valide ce passage pour cette version du titre. Cela ne valide ni les droits de vente ni la publication.</span></label><div className={styles.actions}><button type="button" disabled={!canValidate || !attested || !!busy} onClick={() => void mutate("validate")}>{busy === "validate" ? "Validation…" : "Valider définitivement ce choix d’extrait"}</button></div></>}
    </section>
    <div aria-live="polite">{message ? <p className={styles.feedback} role="status">{message}</p> : null}{error ? <p className={styles.error} role="alert">{error} Aucun nouveau choix n’est confirmé par ce message. Utilisez « Actualiser l’état » si une autre fenêtre a modifié la piste.</p> : null}</div>
    <nav className={styles.footer} aria-label="Parcourir les titres"><button type="button" className={styles.quiet} disabled={index === 0} onClick={previous}>← Titre précédent</button><span>{index + 1} / {count}</span><button type="button" className={styles.quiet} disabled={index === count - 1} onClick={next}>Titre suivant →</button></nav>
  </article>;
}
