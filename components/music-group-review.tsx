"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { GroupReviewView } from "@/lib/digital/group-review-service";
import { announceMediaPlayback, listenForOtherMediaPlayback } from "@/lib/media/playback-coordinator";
import { DigitalRightsReview } from "./digital-rights-review";
import common from "./digital.module.css";
import styles from "./music-group-review.module.css";
const fields = { authors: "Auteur(s) des paroles", composers: "Compositeur(s)", masterOwner: "Titulaire et producteur du master", performers: "Voix / interprètes et autorisations", toolsLicenses: "Outils utilisés et licences applicables", evidenceReferences: "Références des preuves privées vérifiées" };
const blank = Object.fromEntries(Object.keys(fields).map(k => [k, ""])) as Record<keyof typeof fields, string>;
const duration = (ms: number | null) => ms === null ? "Non établie" : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")} (${(ms / 1000).toLocaleString("fr-FR")} s)`;
async function api(payload: Record<string, unknown>) {
  const response = await fetch("/api/admin/digital/group-review", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json(); if (!response.ok) throw Object.assign(new Error(body.error ?? "Revue indisponible"), { definitive: response.status < 500 }); return body;
}
export function MusicGroupReview({ initial }: { initial: GroupReviewView }) {
  const [project, setProject] = useState(initial), [selected, setSelected] = useState<string[]>([]), [active, setActive] = useState(0), [continuous, setContinuous] = useState(true);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [artAttested, setArtAttested] = useState(false);
  const [facts, setFacts] = useState(blank), [controlled, setControlled] = useState(false), [noThirdParty, setNoThirdParty] = useState(false), [noRestriction, setNoRestriction] = useState(false), [rightsAttested, setRightsAttested] = useState(false);
  const player = useRef<HTMLAudioElement>(null), ticket = useRef<{ masterId: string; value: string } | null>(null), starting = useRef(false), autoplay = useRef(false), pending = useRef<Record<string, unknown> | null>(null);
  const track = project.tracks[active], chosen = project.tracks.filter(t => t.masterId && selected.includes(t.masterId));
  const artistic = chosen.filter(t => t.selection?.status !== "VALIDATED"), heard = project.tracks.filter(t => t.listened || t.selection?.status === "VALIDATED").length;
  useEffect(() => listenForOtherMediaPlayback("dcn-group-review", () => player.current?.pause()), []);
  useEffect(() => { const a = player.current; if (!a) return; ticket.current = null; starting.current = false; a.load(); if (autoplay.current) { autoplay.current = false; void a.play().catch(() => setMessage("Touchez le lecteur pour poursuivre ; aucune validation automatique.")); } }, [track?.masterId]);
  function changeSelection(ids: string[]) { setSelected(ids); setArtAttested(false); setRightsAttested(false); }
  async function refresh() {
    const response = await fetch(`/api/admin/digital/group-review?projectId=${project.id}`, { credentials: "same-origin", cache: "no-store" }); const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "États indisponibles"); setProject(body.project as GroupReviewView);
  }
  async function start() {
    const a = player.current; if (!a || !track?.masterId) return; announceMediaPlayback({ ownerId: "dcn-group-review", kind: "audio" });
    if (project.protectedLive || track.listened || track.selection?.status === "VALIDATED" || ticket.current?.masterId === track.masterId) return;
    if (a.muted || a.volume === 0 || a.playbackRate !== 1) { a.pause(); setMessage("Activez le son et la vitesse normale pour examiner cet extrait."); return; }
    a.pause(); if (starting.current) return; starting.current = true; a.currentTime = 0;
    const masterId = track.masterId;
    try { const value = await api({ operation: "listen-start", projectId: project.id, masterId }); if (player.current === a && a.getAttribute("data-master") === masterId) { ticket.current = { masterId, value: value.ticket }; await a.play(); } }
    catch (e) { setMessage(e instanceof Error ? e.message : "Lecture indisponible"); } finally { starting.current = false; }
  }
  async function ended() {
    const a = player.current, current = track; if (!a || !current?.masterId) return;
    let saved = current.listened || current.selection?.status === "VALIDATED";
    if (!project.protectedLive && !saved) {
      try {
        if (ticket.current?.masterId !== current.masterId) throw new Error("Lecture incomplète : reprenez cet extrait depuis le début.");
        const playedRangesMs = Array.from({ length: a.played.length }, (_, i) => [a.played.start(i) * 1000, a.played.end(i) * 1000]);
        const result = await api({ operation: "listen-finish", projectId: project.id, masterId: current.masterId, ticket: ticket.current.value, playedRangesMs });
        setProject(old => ({ ...old, tracks: old.tracks.map(t => t.masterId === current.masterId ? { ...t, listened: true, receiptId: result.receiptId } : t) })); saved = true;
        setMessage("Lecture complète enregistrée pour votre compte et ce fichier exact. Votre validation artistique reste à confirmer.");
      } catch (e) { setMessage(e instanceof Error ? e.message : "La lecture n’est pas confirmée."); }
    }
    if (continuous && saved) { const next = project.tracks.findIndex((t, i) => i > active && t.ready && t.previewUrl); if (next >= 0) { autoplay.current = true; setActive(next); } }
  }
  async function submit(operation: "artistic" | "original-rights", retry = false) {
    if (busy || project.protectedLive || !chosen.length || uncertain && !retry) return;
    const list = operation === "artistic" ? artistic : chosen;
    if (!retry && (operation === "artistic" ? !artAttested || !list.length || list.some(t => !t.listened) : !rightsAttested || !controlled || !noThirdParty || !noRestriction)) return;
    const payload = retry && pending.current ? pending.current : { operation, projectId: project.id, masterIds: list.map(t => t.masterId),
      expectedBindings: list.map(t => ({ masterId: t.masterId, bindingHash: t.bindingHash })), idempotencyKey: crypto.randomUUID(), attested: true,
      ...(operation === "artistic" ? { expectedSelections: list.map(t => ({ masterId: t.masterId, revisionId: t.selection?.revisionId ?? null })) } : { expectedReviews: list.map(t => ({ masterId: t.masterId, reviewId: t.review?.reviewId ?? null })), facts: { ...facts, originalControlled: controlled, noCollaborationSampleCover: noThirdParty, noIncompatibleRestriction: noRestriction } }) };
    pending.current = payload; setBusy(true); setMessage("");
    try { await api(payload); pending.current = null; setUncertain(false); changeSelection([]); setControlled(false); setNoThirdParty(false); setNoRestriction(false); await refresh(); setMessage("Décision enregistrée dans le workflow existant, pour les seules versions sélectionnées. Aucune vente ouverte, aucun fichier remplacé."); }
    catch (e) { const definitive = (e as { definitive?: boolean }).definitive; if (definitive) pending.current = null; else setUncertain(true); setMessage((e instanceof Error ? e.message : "Résultat incertain") + (definitive ? " Rechargez les états avant de réessayer." : " Ne changez pas la sélection : réessayez la même demande avec sa clé conservée.")); }
    finally { setBusy(false); }
  }
  const rightsTracks = project.tracks.flatMap(t => t.masterId && t.review ? [{ masterId: t.masterId, title: t.title, version: t.version!, strictReady: t.ready, review: t.review }] : []);
  return <main className={`admin-main ${styles.shell}`}><Link className="admin-row-action" href="/admin/musique/a-terminer">← À terminer</Link>
    <header className="admin-page-heading"><div><p className="admin-kicker">Écoute privée · décisions séparées</p><h1>Examiner par projet.</h1></div><p>Aucun prix, achat ou fichier modifié par cette revue.</p></header>
    <section className={common.panel}><div className={styles.summary}>{project.cover ? <Image className={styles.art} src={project.cover.url} unoptimized alt={`Pochette de ${project.title}`} width={96} height={96}/> : null}<div><h2>{project.title}</h2><p>{project.type === "ALBUM" ? "Album" : "Single"} · {project.tracks.length} pistes · pochette {project.cover?.rights ?? "à examiner"}</p></div></div>
      <p>Crédits documentés : {project.credits.length ? project.credits.map(c => `${c.role} : ${c.name} (${c.confidence})`).join(" · ") : "Non renseignés. Aucun rôle n’est attribué automatiquement."}</p>
      <p className={styles.small}>Les collaborateurs absents des crédits ne sont pas réputés inexistants. Leurs autorisations restent à vérifier dans les justificatifs particuliers.</p>
      {project.protectedLive ? <p role="status">Projet déjà vendu : ses validations sont conservées et les nouvelles décisions sont désactivées dans cette interface.</p> : null}
    </section>
    <section className={styles.sticky} aria-label="Écoute continue"><h2>{track?.title ?? "Aucune piste"}</h2><p>{track?.ready ? `Titre ${track.position} · durée totale ${duration(track.durationMs)} · extrait ${duration(track.previewDurationMs)}` : "Version exacte non disponible — aucun import repris automatiquement."}</p>
      {track?.previewUrl ? <audio ref={player} data-master={track.masterId} className={styles.player} controls preload="metadata" src={track.previewUrl} aria-label={`Extrait privé de ${track.title}`} onPlay={() => void start()} onEnded={() => void ended()}
        onVolumeChange={() => { const a = player.current; if (a && !project.protectedLive && !track.listened && (a.muted || a.volume === 0)) { a.pause(); ticket.current = null; setMessage("Lecture interrompue sans son : reprenez cet extrait pour confirmer son examen."); } }}
        onRateChange={() => { const a = player.current; if (a && !project.protectedLive && !track.listened && a.playbackRate !== 1) { a.pause(); ticket.current = null; setMessage("Reprenez à vitesse normale ; cette lecture n’est pas encore complète."); } }} /> : <p>Écoute indisponible pour cette version.</p>}
      <label className={common.checkbox}><input type="checkbox" checked={continuous} onChange={e => setContinuous(e.target.checked)}/><span>Enchaîner les extraits disponibles, sans les valider automatiquement.</span></label>
      <progress className={styles.progress} value={heard} max={Math.max(1, project.tracks.length)} aria-label="Progression des écoutes"/><p>{heard}/{project.tracks.length} extraits écoutés ou déjà validés · {project.tracks.filter(t => t.selection?.status === "VALIDATED").length} validations artistiques conservées.</p>
      <div className={styles.actions}><button type="button" onClick={() => { player.current?.pause(); setActive(Math.max(0, active - 1)); }} disabled={active === 0}>Précédent</button><button type="button" onClick={() => { player.current?.pause(); setActive(Math.min(project.tracks.length - 1, active + 1)); }} disabled={active >= project.tracks.length - 1}>Suivant</button></div>
    </section>
    <section className={common.panel}><h2>Versions réellement examinées</h2><p>La sélection seule n’approuve rien. Les écoutes sont liées à votre compte, au master et à l’empreinte de l’extrait. Une lecture déclarée par le navigateur n’est pas une preuve indépendante d’écoute humaine ; votre attestation personnelle reste obligatoire.</p>
      <div className={styles.actions}><button disabled={busy || uncertain || project.protectedLive} onClick={() => changeSelection(project.tracks.filter(t => t.ready).map(t => t.masterId!))}>Tout sélectionner pour examen</button><button disabled={busy || uncertain} onClick={() => changeSelection(project.tracks.filter(t => t.ready && t.listened && t.selection?.status !== "VALIDATED").map(t => t.masterId!))}>Sélectionner les extraits écoutés à valider</button><button disabled={busy || uncertain} onClick={() => changeSelection([])}>Tout désélectionner</button></div>
      <ol className={styles.list}>{project.tracks.map((t, i) => <li key={t.id} className={styles.track} data-active={i === active}><div className={styles.heading}><label><input type="checkbox" aria-label={`Examiner ${t.title}`} checked={!!t.masterId && selected.includes(t.masterId)} disabled={!t.ready || project.protectedLive || busy || uncertain} onChange={e => changeSelection(e.target.checked ? [...selected, t.masterId!] : selected.filter(id => id !== t.masterId))}/><strong>{t.position}. {t.title}</strong></label><button disabled={!t.previewUrl} onClick={() => { player.current?.pause(); setActive(i); }}>Afficher le lecteur</button></div>
        <p className={styles.badges}><span>{t.ready ? `READY · V${t.version} · WAV + MP3` : "Identité/source à confirmer"}</span><span>{duration(t.durationMs)}</span><span>{t.selection?.status === "VALIDATED" ? "Extrait validé" : t.listened ? "Écouté · à valider personnellement" : "À écouter"}</span><span>Droits : {t.review?.status ?? "PENDING"}</span></p>
        <p className={styles.small}>Crédits piste : {t.credits.length ? t.credits.map(c => `${c.role} : ${c.name} (${c.confidence})`).join(" · ") : "Non documentés"} · Preuve de droits : {t.review?.reviewId ? `${t.review.reviewId} · ${t.review.reviewedAt ?? "date à vérifier"}` : "Aucune décision établie pour ce master"}</p>
        <details><summary>Version et empreintes exactes</summary><div className={styles.proof}>Master : {t.masterId ?? "non associé"}<br/>WAV : {t.wavSha256 ?? "absent"}<br/>MP3 : {t.mp3Sha256 ?? "absent"}<br/>Extrait : {t.previewSha256 ?? "absent"}<br/>Début : {t.previewStartMs ?? "—"} ms · Trace d’écoute : {t.receiptId ?? "aucune"}</div></details>
        <Link className="text-link" href={`/admin/musique/express?projet=${project.id}#${t.ready ? "droits" : "audio"}`}>Ouvrir la correction dans Express</Link>
      </li>)}</ol>
    </section>
    {!project.protectedLive ? <>
      <section className={common.panel} id="validation-artistique"><h2>Valider les extraits sélectionnés</h2><p>{artistic.length} extrait(s) non encore validé(s) dans votre sélection. {artistic.filter(t => !t.listened).length} écoute(s) complète(s) restent nécessaires.</p><label className={common.checkbox}><input type="checkbox" checked={artAttested} disabled={busy || uncertain} onChange={e => setArtAttested(e.target.checked)}/><span>J’ai personnellement écouté chacun des extraits sélectionnés et je valide ces passages exacts. Cette décision ne valide pas les droits de vente.</span></label><button disabled={busy || uncertain || !artAttested || !artistic.length || artistic.some(t => !t.listened)} onClick={() => void submit("artistic")}>Valider artistiquement ces {artistic.length} extraits</button></section>
      <section className={common.panel} id="droits-originaux"><h2>Déclaration groupée · originaux entièrement contrôlés</h2><p>{chosen.length} version(s) sélectionnée(s). Renseignez les faits communs vérifiés. Une déclaration privée datée, liée aux IDs/versions/SHA, sera conservée ; ce n’est pas une approbation juridique indépendante. Aucun droit ne provient du seul fichier ou crédit.</p>
        <form className={common.form} onSubmit={e => { e.preventDefault(); void submit("original-rights"); }}><fieldset disabled={busy || uncertain}><legend>Faits et preuves privées</legend><div className={styles.facts}>{Object.entries(fields).map(([key, label]) => <label key={key}>{label}<textarea required minLength={2} maxLength={1200} value={facts[key as keyof typeof facts]} onChange={e => setFacts(old => ({ ...old, [key]: e.target.value }))}/></label>)}</div>
          <p className={styles.small}>Indiquez les références d’archive ou de licence, jamais de mot de passe, clé privée ou document client. Aucun texte n’est prérempli pour déduire des titulaires.</p>
          <label className={common.checkbox}><input type="checkbox" required checked={controlled} onChange={e => setControlled(e.target.checked)}/><span>Ces créations originales sont intégralement contrôlées par LNX Beats pour les utilisations déclarées.</span></label>
          <label className={common.checkbox}><input type="checkbox" required checked={noThirdParty} onChange={e => setNoThirdParty(e.target.checked)}/><span>Aucune collaboration, reprise, sample ou autre contribution de tiers n’impose un circuit particulier. Sinon, je n’utilise pas cette déclaration simplifiée.</span></label>
          <label className={common.checkbox}><input type="checkbox" required checked={noRestriction} onChange={e => setNoRestriction(e.target.checked)}/><span>J’ai vérifié les licences d’outils, mandats et restrictions ; aucune restriction incompatible n’est connue.</span></label>
          <label className={common.checkbox}><input type="checkbox" required checked={rightsAttested} onChange={e => setRightsAttested(e.target.checked)}/><span>J’atteste avoir vérifié les autorisations œuvre, master, voix/interprétation et extraits publics nécessaires à la vente et au téléchargement privé WAV/MP3 aux particuliers de France métropolitaine et Corse. Je confirme cette décision pour les seules versions sélectionnées.</span></label>
          <button disabled={!chosen.length || busy || uncertain}>Enregistrer les droits de ces {chosen.length} versions, sans ouvrir la vente</button></fieldset></form>
      </section>
      <details className={common.panel} id="droits-particuliers"><summary>Collaborations, samples, reprises ou restrictions · justificatifs particuliers</summary><p>Conservez les autorisations privées correspondantes. Ce circuit reste distinct de la déclaration simplifiée et ne présume aucun titulaire.</p><DigitalRightsReview key={`${project.id}:${project.tracks.map(t => t.review?.reviewId ?? "").join(",")}`} projectId={project.id} tracks={rightsTracks} externalSelection={{ ids: selected, change: changeSelection }} onRecorded={() => void refresh().then(() => setMessage("Revue particulière ajoutée au journal. Les états sont actualisés ; aucune offre activée.")).catch(e => setMessage(e.message))}/></details>
    </> : null}
    <div className={common.panel} role="status" aria-live="polite"><p>{message || "Aucune validation automatique. Les décisions enregistrées seront retrouvées à la prochaine connexion."}</p><div className={styles.actions}>{uncertain ? <button disabled={busy} onClick={() => void submit(pending.current?.operation as "artistic" | "original-rights", true)}>Réessayer la même demande</button> : null}<button disabled={busy} onClick={() => void refresh().catch(e => setMessage(e.message))}>Recharger les états enregistrés</button></div></div>
  </main>;
}
