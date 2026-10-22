"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { announceMediaPlayback, listenForOtherMediaPlayback } from "@/lib/media/playback-coordinator";
import { studioApprovalAvailable, studioAuditionGains, studioAuditionTime, studioExistingSourceRequest, studioFormatLabel, studioJobPending, studioPhaseLabel, studioPrivateAudioUrl, studioReplacementConfirmed, studioRestoreRequest, type StudioArtifactRole, type StudioArtifactView, type StudioExistingSourceView, type StudioJobView } from "@/lib/digital/studio-presentation";
import styles from "./studio-review.module.css";

type Action = "approve" | "reject" | "retry" | "restore";
const outputs: StudioArtifactRole[] = ["ORIGINAL", "MP3", "WAV_CD", "WAV_24"];
const decimal = (value: number | null, suffix: string) => value !== null && Number.isFinite(value) ? `${value.toFixed(2)} ${suffix}` : "Non mesuré";
const duration = (value: number | null) => value !== null && Number.isFinite(value) ? `${Math.floor(value / 60000)}:${String(Math.floor(value / 1000) % 60).padStart(2, "0")}` : "À analyser";
function playerVolume(audio: HTMLAudioElement, value: number) {
  const expected = Math.min(1, Math.max(0, value));
  try { audio.volume = expected; return Math.abs(audio.volume - expected) < 0.001; } catch { return false; }
}
function auditionArtifact(role: StudioArtifactRole, artifacts: StudioArtifactView[], encoded: boolean) {
  return (encoded && (role === "WAV_24" || role === "WAV_CD") ? artifacts.find(a => a.role === `AUDITION_${role}`) : null) ?? artifacts.find(a => a.role === role);
}

export function StudioJob({ job, onChanged, compact = false }: { job: StudioJobView; onChanged: () => Promise<void>; compact?: boolean }) {
  const ownerId = `studio-${useId()}`, players = useRef(new Map<StudioArtifactRole, HTMLAudioElement>()), inFlight = useRef(false);
  const [listened, setListened] = useState(false), [replacement, setReplacement] = useState(false), [purchases, setPurchases] = useState(false);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [volume, setVolume] = useState(0.8), [matchLevel, setMatchLevel] = useState(true);
  const [comparison, setComparison] = useState<StudioArtifactRole>("MP3"), [encoded, setEncoded] = useState<StudioArtifactRole[]>([]);
  const original = job.artifacts.find(a => a.role === "ORIGINAL"), final = job.artifacts.find(a => a.role === comparison);
  const gains = studioAuditionGains(original?.integratedLufs ?? null, final?.integratedLufs ?? null);
  const rejected = job.decision === "REJECTED" || job.status === "REJECTED";
  const ready = studioApprovalAvailable(job), replacementConfirmed = studioReplacementConfirmed(job, replacement, purchases);
  const restoreRequest = studioRestoreRequest(job, restoreConfirmed, purchases), restoreAvailable = !!studioRestoreRequest(job, true, true);
  useEffect(() => listenForOtherMediaPlayback(ownerId, () => { for (const audio of players.current.values()) audio.pause(); }), [ownerId]);
  function updateVolumes(level = volume, match = matchLevel, format = comparison) {
    const measured = studioAuditionGains(original?.integratedLufs ?? null, job.artifacts.find(a => a.role === format)?.integratedLufs ?? null);
    for (const [role, audio] of players.current) if (!playerVolume(audio, level * (match && measured ? role === "ORIGINAL" ? measured.original : role === format ? measured.final : 1 : 1))) {
      setMessage("Ce navigateur ne permet pas de régler ce volume d’écoute : la comparaison à niveau harmonisé n’est pas démontrée ici. Utilisez ses contrôles natifs ; aucun fichier n’est modifié.");
    }
  }
  function play(audio: HTMLAudioElement, role: StudioArtifactRole) {
    for (const [otherRole, other] of players.current) if (role !== otherRole) other.pause();
    announceMediaPlayback({ ownerId, kind: "audio" });
    void audio.play().catch(() => setMessage("Lecture non démarrée : utilisez le lecteur de la version choisie. Aucun fichier n’est approuvé."));
  }
  function seek(role: StudioArtifactRole, at: number, start = false) {
    const audio = players.current.get(role); if (!audio) return;
    const update = () => { try { audio.currentTime = studioAuditionTime(at, audio.duration); if (start) play(audio, role); } catch { setMessage("Ce passage n’est pas encore disponible : attendez le chargement du lecteur."); } };
    if (audio.readyState >= 1) update(); else { audio.addEventListener("loadedmetadata", update, { once: true }); audio.load(); }
  }
  function compare(role: "ORIGINAL" | "final") {
    const target = role === "ORIGINAL" ? "ORIGINAL" : comparison, other = players.current.get(role === "ORIGINAL" ? comparison : "ORIGINAL");
    seek(target, other?.currentTime ?? 0, true);
  }
  async function mutate(action: Action, explicitListeningConfirmation = false) {
    const humanListened = listened || compact && explicitListeningConfirmation;
    if (inFlight.current || action === "approve" && (!ready || !humanListened || !replacementConfirmed) || action === "restore" && !restoreRequest) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const request = action === "restore" ? restoreRequest : { action, jobId: job.id, expectedBinding: job.binding, confirmReplacement: replacement, confirmExistingPurchases: purchases, humanListened };
      const response = await fetch("/api/admin/digital/studio", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      const value = await response.json(); if (!response.ok) throw Error(value.error ?? "Cette décision n’a pas été enregistrée.");
      setListened(false); setReplacement(false); setPurchases(false); setRestoreConfirmed(false); await onChanged();
      setMessage(action === "approve" ? "Validation humaine enregistrée. Les contrôles de droits et de publication restent indépendants ; aucun prix modifié." : action === "reject" ? "Versions refusées, original et versions antérieures conservés." : action === "retry" ? "Nouvelle tentative demandée depuis l’original privé, sans nouvel import." : "Préparation privée demandée ou retrouvée, décision PENDING. Le master courant n’est pas remplacé : écoutez et validez personnellement la nouvelle candidate avant toute autre décision.");
    } catch (error) { setMessage(`${error instanceof Error ? error.message : "Résultat à vérifier"} Actualisez l’état avant toute autre décision ; aucun nouveau paiement n’est demandé.`); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (compact) return <article className={styles.compactJob} aria-label={`Fichiers audio — ${job.title}`}>
    <p className={styles.compactStatus} role="status">{job.approved ? "Fichiers prêts — écoute validée" : rejected ? "Versions refusées" : studioPhaseLabel(job.phase ?? job.status)}</p>
    {job.sourceLossy ? <p className={styles.compactNotice}>Source MP3 · le WAV est une conversion, pas un original sans perte.</p> : null}
    {job.errorCode ? <p role="alert">Traitement à vérifier : {job.errorCode}. Votre fichier reste conservé.</p> : null}
    <div className={styles.compactPlayers}>{(["MP3", "WAV_CD"] as const).map(role => {
      const actual = job.artifacts.find(a => a.role === role);
      if (!actual) return null;
      const audition = auditionArtifact(role, job.artifacts, encoded.includes(role)), url = studioPrivateAudioUrl(audition?.audioUrl);
      const fallback = role === "WAV_CD" && job.artifacts.some(a => a.role === "AUDITION_WAV_CD");
      const label = role === "MP3" ? "MP3" : encoded.includes(role) ? "Écoute compatible du WAV" : job.sourceLossy ? "WAV converti" : "WAV";
      return <section className={styles.compactPlayer} key={role}><h4>{label} <span>· {duration(actual.durationMs)} · fichier entier</span></h4>
        {url ? <audio key={`${url}:${encoded.includes(role)}`} ref={node => { if (node) players.current.set(role, node); else players.current.delete(role); }} controls preload="metadata" src={url} aria-label={`Écouter le fichier entier ${label} de ${job.title}`} onPlay={() => { for (const [otherRole, other] of players.current) if (otherRole !== role) other.pause(); announceMediaPlayback({ ownerId, kind: "audio" }); }} onError={() => setMessage(`Lecture ${label} indisponible dans ce navigateur.${fallback ? " Essayez l’écoute compatible du WAV." : " Aucun fichier n’est approuvé."}`)} /> : <p>Lecture privée indisponible.</p>}
        {fallback ? <button className={styles.compactFallback} type="button" onClick={() => setEncoded(old => old.includes(role) ? old.filter(value => value !== role) : [...old, role])}>{encoded.includes(role) ? "Revenir au WAV" : "Écoute compatible du WAV"}</button> : null}
      </section>;
    })}</div>
    {!job.approved && !rejected && job.baseMasterId ? <label className={styles.confirm}><input type="checkbox" checked={replacement} disabled={busy} onChange={event => setReplacement(event.target.checked)} /> Remplacer le choix courant, en conservant les versions et achats antérieurs.</label> : null}
    {!job.approved && !rejected && (job.baseMasterId || job.hasAcquisitions) ? <label className={styles.confirm}><input type="checkbox" checked={purchases} disabled={busy} onChange={event => setPurchases(event.target.checked)} /> {job.hasAcquisitions ? "Je confirme la conservation des fichiers déjà achetés." : "Autoriser les formats supplémentaires aux achats de la source strictement identique (facultatif)."}</label> : null}
    <div className={styles.actions}>{!job.approved && !rejected ? <button type="button" disabled={busy || !ready || !replacementConfirmed} onClick={() => void mutate("approve", true)}>{busy ? "Enregistrement…" : "J’ai écouté — utiliser ces fichiers"}</button> : null}{["FAILED", "ERROR", "REJECTED"].includes(job.status) || rejected ? <button type="button" disabled={busy} onClick={() => void mutate("retry")}>Réessayer le traitement</button> : null}</div>
    <details className={styles.compactDetails}><summary>Détails audio</summary><p>Les lecteurs lisent les fichiers complets privés. L’extrait public reste distinct. Utiliser ces fichiers enregistre votre confirmation d’écoute, sans publication automatique.</p><pre className={styles.report}>{JSON.stringify(job.report ?? { statut: "Rapport pas encore disponible" }, null, 2)}</pre></details>
    {message ? <p role="status" aria-live="polite">{message}</p> : null}
  </article>;
  return <article className={styles.job} aria-label={`Atelier audio — ${job.title}`}>
    <div className={styles.heading}><h3 translate="no" className="notranslate">{job.title}</h3><span className={styles.badge}>{rejected ? studioPhaseLabel("REJECTED") : job.approved ? "Validation d’écoute enregistrée" : studioPhaseLabel(job.phase ?? job.status)}</span></div>
    {Number.isSafeInteger(job.attempt) && job.attempt! > 0 ? <p>Tentative {job.attempt}</p> : null}
    <p className={styles.notice}>Traitement technique : {job.status === "READY" ? "réussi" : studioPhaseLabel(job.status)} · Écoute administrateur : {rejected ? "refusée" : job.approved ? "approuvée" : "en attente"}. Droits et publication : décisions séparées.</p>
    {job.sourceLossy ? <p className={styles.warning}>Source MP3 avec pertes. Les WAV dérivés n’en restaurent pas la qualité perdue et ne sont pas des masters originaux non compressés.</p> : null}
    {job.errorCode ? <p role="alert">{["FAILED", "ERROR"].includes(job.status) ? "Traitement arrêté" : "Point à résoudre avant mise à disposition commerciale"} : {job.errorCode}. Aucune approbation commerciale automatique.</p> : null}
    <div className={styles.versions}>{outputs.map(role => {
      const actual = job.artifacts.find(a => a.role === role); if (!actual) return <section key={role} className={styles.version}><h4>{studioFormatLabel({ role, bitrateKbps: null, sampleRate: null })}</h4><p>Pas encore disponible.</p></section>;
      const audition = auditionArtifact(role, job.artifacts, encoded.includes(role)), url = studioPrivateAudioUrl(audition?.audioUrl);
      const fallback = job.artifacts.some(a => a.role === `AUDITION_${role}`);
      return <section key={role} className={styles.version}><h4>{studioFormatLabel(actual)}</h4><p translate="no" className="notranslate">{actual.filename}</p><p>{duration(actual.durationMs)} · {(actual.sizeBytes / 1048576).toFixed(2)} Mio · {actual.sampleRate ? `${actual.sampleRate / 1000} kHz` : "Fréquence non mesurée"}{actual.bitDepth ? ` · ${actual.bitDepth} bits` : ""}</p><p>Sonie : {decimal(actual.integratedLufs, "LUFS")} · Crête réelle : {decimal(actual.truePeakDbtp, "dBTP")}</p><p>Métadonnées : {actual.metadataVerified ? "vérifiées" : "contrôle à compléter"}</p>
        {encoded.includes(role) && fallback ? <p className={styles.warning}>Écoute encodée privée dérivée de ce WAV exact. Le contrôle technique porte sur le WAV téléchargeable, pas sur cette écoute.</p> : null}
        {url ? <><audio key={`${url}:${encoded.includes(role)}`} ref={node => { if (node) players.current.set(role, node); else players.current.delete(role); }} controls preload="none" src={url} aria-label={`Écouter ${studioFormatLabel(actual)} de ${job.title}`} onPlay={() => { for (const [otherRole, other] of players.current) if (otherRole !== role) other.pause(); announceMediaPlayback({ ownerId, kind: "audio" }); updateVolumes(); }} onError={() => setMessage("Ce navigateur n’a pas pu lire cette version. Utilisez l’écoute encodée si elle a été produite ; la compatibilité réelle Safari doit être vérifiée.")} /><div className={styles.actions}><button type="button" aria-label={`Revenir au début de ${studioFormatLabel(actual)} — ${job.title}`} onClick={() => seek(role, 0)}>Début</button><button type="button" aria-label={`Écouter les quinze dernières secondes de ${studioFormatLabel(actual)} — ${job.title}`} onClick={() => seek(role, Math.max(0, (actual.durationMs ?? 0) / 1000 - 15))}>Fin − 15 s</button></div></> : <p>Lecture privée indisponible — aucun lien public utilisé.</p>}
        {fallback ? <label><input type="checkbox" checked={encoded.includes(role)} onChange={e => setEncoded(old => e.target.checked ? [...old, role] : old.filter(v => v !== role))} /> Utiliser l’écoute encodée compatible</label> : null}
      </section>;
    })}</div>
    <details className={styles.compare}><summary>Comparer l’original et une version finale</summary><p>Les boutons démarrent uniquement l’écoute demandée, au même passage. L’harmonisation atténue le volume d’écoute ; elle ne modifie aucun fichier.</p><label>Version comparée<select value={comparison} onChange={e => { const value = e.target.value as StudioArtifactRole; setComparison(value); updateVolumes(volume, matchLevel, value); }}>{outputs.filter(r => r !== "ORIGINAL").map(role => <option key={role} value={role}>{studioFormatLabel(job.artifacts.find(a => a.role === role) ?? { role, bitrateKbps: null, sampleRate: null })}</option>)}</select></label><label>Volume d’écoute<input type="range" min="0" max="1" step="0.01" value={volume} onChange={e => { const value = Number(e.target.value); setVolume(value); updateVolumes(value); }} /></label><label><input type="checkbox" checked={matchLevel} disabled={!gains} onChange={e => { setMatchLevel(e.target.checked); updateVolumes(volume, e.target.checked); }} /> Harmoniser selon les LUFS mesurés</label>{!gains ? <p>Comparaison à niveau harmonisé indisponible : sonie d’au moins une version non mesurée. Aucune mesure inventée.</p> : null}<div className={styles.actions}><button type="button" disabled={!studioPrivateAudioUrl(original?.audioUrl)} onClick={() => compare("ORIGINAL")}>A · Original</button><button type="button" disabled={!studioPrivateAudioUrl(final?.audioUrl)} onClick={() => compare("final")}>B · Version finale</button></div></details>
    <details><summary>Rapport technique privé</summary><p>Contrôles automatiques uniquement : ils ne remplacent pas votre écoute critique.</p><pre className={styles.report}>{JSON.stringify(job.report ?? { statut: "Rapport pas encore disponible" }, null, 2)}</pre></details>
    {!job.approved && !rejected && job.status === "READY" ? <label className={styles.confirm}><input type="checkbox" checked={listened} disabled={busy} onChange={e => setListened(e.target.checked)} /> J’ai personnellement écouté l’original et les versions finales exactes ; je confirme leur qualité audio. Ceci ne valide ni les droits ni la publication.</label> : null}
    {!job.approved && !rejected && job.baseMasterId ? <><p className={styles.warning}>Ce nouveau master exige une nouvelle vérification de ses droits et de son extrait. Si le titre est déjà en vente, les nouvelles ventes peuvent être suspendues jusqu’à ces validations. Les achats déjà acquis et leurs fichiers restent conservés.</p><label className={styles.confirm}><input type="checkbox" checked={replacement} disabled={busy} onChange={e => setReplacement(e.target.checked)} /> Je confirme explicitement la mise à disposition de cette version à la place du choix courant, sans supprimer les versions antérieures.</label></> : null}
    {!job.approved && !rejected && (job.baseMasterId || job.hasAcquisitions) ? <><label className={styles.confirm}><input type="checkbox" checked={purchases} disabled={busy} onChange={e => setPurchases(e.target.checked)} /> {job.hasAcquisitions ? "Confirmation nécessaire pour les achats existants : " : "Facultatif : "}Je confirme cette nouvelle version sans remplacer les fichiers déjà acquis. Si la source est strictement identique, j’autorise aussi l’ajout de ces formats aux achats de cette version.</label><p>Les anciens achats conservent toujours leurs fichiers et contrats acquis. L’ajout de formats nécessite une empreinte source strictement identique vérifiée par le serveur ; aucune nouvelle version sonore ne bénéficie automatiquement d’anciens droits.</p></> : null}
    {job.approved && restoreAvailable ? <><p className={styles.notice}>Ce retour prépare seulement une nouvelle candidate privée, décision PENDING, depuis les fichiers exacts de cette version. Le master courant (version {job.restoreCurrent!.version}) et les achats acquis restent inchangés. Votre nouvelle écoute puis votre validation explicites seront nécessaires ; un éventuel nouveau master exigera ensuite la revue des droits et de son extrait avant les nouvelles ventes.</p><label className={styles.confirm}><input type="checkbox" checked={restoreConfirmed} disabled={busy} onChange={e => setRestoreConfirmed(e.target.checked)} /> Je demande uniquement cette préparation privée, sans rétablir une approbation ni remplacer le master courant.</label>{job.restoreCurrent!.hasAcquisitions ? <label className={styles.confirm}><input type="checkbox" checked={purchases} disabled={busy} onChange={e => setPurchases(e.target.checked)} /> Je confirme la conservation des fichiers et contrats déjà acquis de la version courante. Aucun accès historique ne sera remplacé par cette préparation.</label> : null}</> : null}
    <div className={styles.actions}><button type="button" disabled={busy || !ready || !listened || !replacementConfirmed} onClick={() => void mutate("approve")}>Valider les fichiers</button>{!job.approved && !rejected ? <button type="button" disabled={busy || studioJobPending(job.status)} onClick={() => void mutate("reject")}>Refuser les versions</button> : null}{["FAILED", "ERROR", "REJECTED"].includes(job.status) || job.decision === "REJECTED" ? <button type="button" disabled={busy} onClick={() => void mutate("retry")}>Retraiter l’original privé</button> : null}{job.approved ? <button type="button" disabled={busy || !restoreRequest} onClick={() => void mutate("restore")}>Préparer le retour vers cette version</button> : null}</div>
    {job.approved && !restoreAvailable ? <p>Préparation du retour indisponible pour cette version : le serveur doit confirmer une ancienne version approuvée, une source exacte et des métadonnées toujours compatibles. Le master courant, les versions approuvées et les achats historiques restent conservés.</p> : null}
    <p role="status" aria-live="polite">{message}</p>
  </article>;
}

export function StudioExistingSource({ source, onQueued }: { source: StudioExistingSourceView; onQueued: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), inFlight = useRef(false);
  const request = studioExistingSourceRequest(source);
  async function prepare() {
    if (inFlight.current || !request) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/digital/studio/prepare-existing", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ sources: [request] }) });
      const value = await response.json(); if (!response.ok) throw Error(value.error ?? "La préparation n’a pas été enregistrée.");
      await onQueued(); setMessage("Préparation privée demandée ou retrouvée, sans nouvel import. Écoutez ensuite les résultats avant toute validation ; le fichier courant et les achats existants ne sont pas remplacés.");
    } catch (error) { setMessage(`${error instanceof Error ? error.message : "Résultat à vérifier"} Actualisez l’atelier avant de reprendre ; aucune publication automatique.`); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <article className={styles.job}><h3 translate="no" className="notranslate">{source.title}</h3><p>Fichier actuel · version {source.expectedVersion}. L’original privé est réutilisé sans nouvel envoi et sans remplacer les versions déjà acquises.</p><button type="button" disabled={busy || !request} onClick={() => void prepare()}>{busy ? "Préparation demandée…" : "Préparer les formats depuis le fichier actuel"}</button><p role="status" aria-live="polite">{message}</p></article>;
}

export function StudioReview({ projectId, refreshRevision = 0, onAvailability, onSaved, onJobsChanged, trackTargetPrefix }: { projectId: string; refreshRevision?: number; onAvailability: (enabled: boolean) => void; onSaved: () => Promise<void>; onJobsChanged?: (jobs: StudioJobView[]) => void; trackTargetPrefix?: string }) {
  const [jobs, setJobs] = useState<StudioJobView[]>([]), [enabled, setEnabled] = useState(false), [message, setMessage] = useState("");
  const [existingSources, setExistingSources] = useState<StudioExistingSourceView[]>([]);
  const [targets, setTargets] = useState<Record<string, HTMLElement>>({});
  const loading = useRef(false), alive = useRef(true);
  const refresh = useCallback(async () => {
    if (loading.current) return; loading.current = true;
    try {
      const response = await fetch(`/api/admin/digital/studio?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store", credentials: "same-origin" });
      const value = await response.json(); if (!response.ok) throw Error(value.error ?? "Atelier indisponible");
      if (alive.current) { const available = value.enabled === true, availableJobs = available && Array.isArray(value.jobs) ? value.jobs as StudioJobView[] : []; setEnabled(available); onAvailability(available); setJobs(availableJobs); onJobsChanged?.(availableJobs); setExistingSources(available && Array.isArray(value.existingSources) ? value.existingSources : []); setMessage(""); }
    } catch { if (alive.current) { setMessage("L’état de l’atelier ne peut pas être actualisé. Aucun traitement ni validation n’a été déclenché."); } }
    finally { loading.current = false; }
  }, [projectId, onAvailability, onJobsChanged]);
  useEffect(() => { alive.current = true; const timer = setTimeout(() => void refresh(), 0); return () => { clearTimeout(timer); alive.current = false; }; }, [refresh, refreshRevision]);
  const reviewJobs = trackTargetPrefix ? jobs.filter((job, index) => jobs.findIndex(candidate => candidate.trackId === job.trackId) === index) : jobs;
  const pending = reviewJobs.some(job => studioJobPending(job.status));
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible); return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [pending, refresh]);
  useEffect(() => {
    if (!trackTargetPrefix) return;
    const timer = setTimeout(() => {
      const next: Record<string, HTMLElement> = {};
      for (const job of jobs) {
        const target = document.getElementById(`${trackTargetPrefix}${job.trackId}`);
        if (target) next[job.trackId] = target;
      }
      setTargets(current => Object.keys(current).length === Object.keys(next).length && Object.keys(next).every(id => current[id] === next[id]) ? current : next);
    }, 0);
    return () => clearTimeout(timer);
  }, [jobs, trackTargetPrefix, refreshRevision]);
  if (!enabled) return message ? <p role="status">{message}</p> : null;
  if (trackTargetPrefix) {
    return <>{reviewJobs.map(job => {
      const player = <StudioJob compact job={job} onChanged={async () => { await refresh(); await onSaved(); }} />;
      return targets[job.trackId] ? createPortal(player, targets[job.trackId], `${job.id}:${job.binding}`) : <div key={`${job.id}:${job.binding}`}><h3 translate="no" className="notranslate">{job.title}</h3>{player}</div>;
    })}{message ? <p role="status">{message}</p> : null}</>;
  }
  return <section className={styles.root} aria-label="LNX Beats Studio"><header className={styles.heading}><div><p className={styles.kicker}>LNX Beats Studio · préparation privée</p><h2>Écouter, comparer, puis décider</h2></div><button type="button" onClick={() => void refresh()}>Actualiser l’atelier</button></header><p>Aucun morceau existant n’est retraité sans action explicite. Un traitement réussi ne publie rien et ne remplace pas une validation humaine.</p>{existingSources.length ? <details><summary>Préparer depuis les fichiers privés actuels</summary><p>Chaque bouton prépare uniquement la version exacte affichée. Aucun lancement collectif ou remplacement automatique.</p>{existingSources.map(source => <StudioExistingSource key={`${source.masterId}:${source.expectedMetadataHash}`} source={source} onQueued={async () => { await refresh(); await onSaved(); }} />)}</details> : null}{jobs.length ? jobs.map(job => <StudioJob key={`${job.id}:${job.binding}:${job.restoreCurrent?.binding ?? "no-current-binding"}`} job={job} onChanged={async () => { await refresh(); await onSaved(); }} />) : <p>Aucun traitement Studio pour ce projet. Activez l’atelier avant de choisir les prochains fichiers à importer.</p>}<p role="status">{message}</p></section>;
}
