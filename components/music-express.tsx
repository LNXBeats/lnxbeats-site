"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { loadExpressProject } from "@/lib/digital/express-service";
import { EXPRESS_DEFAULTS, type ExpressDefaults, type ExpressDraft } from "@/lib/digital/express-policy";
import { CATALOG_PRIMARY_ARTIST } from "@/lib/catalog/artist-identity";
import { parseEuroCents } from "@/lib/digital/domain";
import { expressEditorLocked, expressEditorTracks, expressDurationLabel, hasDistinctSingleTitle, recoverExpressAttempt, type ExpressEditorTrack } from "@/lib/digital/express-presentation";
import { DigitalAdminPreview, DigitalBatchUpload } from "./digital-admin";
import { DigitalRightsReview } from "./digital-rights-review";
import { OWNER_ORIGINAL_CONFIRMATION, OWNER_PUBLICATION_POLICY } from "@/lib/digital/owner-declaration";
import { ExpressVersionReview } from "./express-version-review";
import { CatalogCoverForm } from "./catalog-cover-form";
import { StudioReview } from "./studio-review";
import styles from "./music-express.module.css";

type Project = Awaited<ReturnType<typeof loadExpressProject>>;
type Row = ExpressEditorTrack;
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
export function MusicExpress({ initial, defaults: initialDefaults, mode, ownerId }: { initial: Project | null; defaults: ExpressDefaults; mode: string; ownerId: string }) {
  const [project, setProject] = useState(initial), [defaults, setDefaults] = useState(initialDefaults), [title, setTitle] = useState(initial?.title ?? ""), [type, setType] = useState<"SINGLE" | "ALBUM">(initial?.type === "ALBUM" ? "ALBUM" : "SINGLE");
  const initialRows = (p: Project): Row[] => p.tracks.map(t => ({ id: t.id, title: t.title, price: euros(t.offer?.priceCents ?? EXPRESS_DEFAULTS.trackPriceCents), expectedOfferVersion: t.offer?.version ?? 0 }));
  const [tracks, setTracks] = useState<Row[]>(initial ? initialRows(initial) : [row(defaults.trackPriceCents)]), [count, setCount] = useState(String(initial?.tracks.length ?? 1)), [albumPrice, setAlbumPrice] = useState(initial?.albumOffer?.priceCents == null ? euros(defaults.albumPriceCents) : euros(initial.albumOffer.priceCents));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [reviewing, setReviewing] = useState(false), [confirmed, setConfirmed] = useState(false), [cacheReady, setCacheReady] = useState(false);
  const [defaultTrack, setDefaultTrack] = useState(euros(defaults.trackPriceCents)), [defaultAlbum, setDefaultAlbum] = useState(euros(defaults.albumPriceCents)), [profileName, setProfileName] = useState(defaults.artistName);
  const [artistName, setArtistName] = useState(CATALOG_PRIMARY_ARTIST);
  const [distinctSingleTitle, setDistinctSingleTitle] = useState(initial?.type === "SINGLE" && hasDistinctSingleTitle(initial.title, initial.tracks));
  const [uncertain, setUncertain] = useState(false), [preparedCover, setPreparedCover] = useState<File | null>(null);
  const [audioRequested, setAudioRequested] = useState(false);
  const [studioEnabled, setStudioEnabled] = useState(false), [studioRequested, setStudioRequested] = useState(false), [studioRevision, setStudioRevision] = useState(0);
  const studioAvailability = useCallback((enabled: boolean) => { setStudioEnabled(enabled); if (!enabled) setStudioRequested(false); }, []);
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
        && cached.tracks.every((t: Row) => t && typeof t.title === "string" && typeof t.price === "string")) {
        setTitle(cached.title); setType(cached.type); setTracks(cached.tracks); setCount(typeof cached.count === "string" ? cached.count : String(cached.tracks.length)); setAlbumPrice(cached.albumPrice);
        setDistinctSingleTitle(cached.distinctSingleTitle ?? (cached.type === "SINGLE" && hasDistinctSingleTitle(cached.title, cached.tracks)));
        setMessage("Saisie récupérée sur cet appareil, pas encore enregistrée. Aucun droit ni consentement restauré.");
      }
      const attempt = recoverExpressAttempt(JSON.parse(localStorage.getItem(attemptKey) ?? "null"), project?.id ?? null);
      if (attempt) {
        pending.current = attempt; setUncertain(true); setTitle(attempt.title); setType(attempt.type);
        setTracks(attempt.tracks.map(t => ({ ...t, price: euros(t.priceCents) }))); setCount(String(attempt.tracks.length)); setAlbumPrice(euros(attempt.albumPriceCents));
        setDistinctSingleTitle(attempt.type === "SINGLE" && hasDistinctSingleTitle(attempt.title, attempt.tracks));
        setMessage("Enregistrement à reprendre : utilisez la même action pour retrouver ce brouillon avant de modifier la saisie.");
      }
    } catch { /* The server draft is authoritative when browser storage is unavailable. */ }
    setCacheReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [key, revision, attemptKey, project?.id]);
  useEffect(() => {
    if (!cacheReady) return;
    try { localStorage.setItem(key, JSON.stringify({ title, type, tracks, count, albumPrice, distinctSingleTitle, updatedAt: revision })); } catch { /* Server saving remains available. */ }
  }, [title, type, tracks, count, albumPrice, distinctSingleTitle, key, cacheReady, revision]);
  useEffect(() => { const timer = setTimeout(() => { if (initial) setProject(initial); }, 0); return () => clearTimeout(timer); }, [initial]);
  function dirty() { setReviewing(false); setConfirmed(false); setMessage(""); pending.current = null; }
  function changedTrack(index: number, change: Partial<Row>) { dirty(); setTracks(old => old.map((t, i) => i === index ? { ...t, ...change } : t)); }
  function reorder(index: number, delta: number) { dirty(); setTracks(old => { const next = [...old], target = index + delta; if (target < 0 || target >= next.length) return old; [next[index], next[target]] = [next[target], next[index]]; return next; }); }
  function generate() {
    const n = Number(count);
    if (!Number.isSafeInteger(n) || n < 1 || n > 100 || type === "SINGLE" && n !== 1) { setMessage("Choisissez entre 1 et 100 pistes ; un single contient une piste."); return; }
    if (n < tracks.length) {
      if (tracks.slice(n).some(t => t.id || t.title.trim() || t.price !== euros(defaults.trackPriceCents))) { setMessage("Les lignes déjà saisies sont conservées. La suppression de pistes existantes reste dans le Catalogue avancé."); return; }
      dirty(); setTracks(old => old.slice(0,n)); return;
    }
    dirty(); setTracks(old => [...old, ...Array.from({ length: n - old.length }, () => row(defaults.trackPriceCents))]);
  }
  async function save() {
    if (inFlight.current) return null;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const input = pending.current ?? { projectId: project?.id ?? null, expectedUpdatedAt: project?.updatedAt ?? null, title, type,
        tracks: expressEditorTracks(type, title, tracks, distinctSingleTitle),
        albumPriceCents: parseEuroCents(albumPrice), expectedAlbumOfferVersion: project?.albumOffer?.version ?? 0, idempotencyKey: crypto.randomUUID() };
      pending.current = input;
      try { localStorage.setItem(attemptKey, JSON.stringify(input)); } catch { /* Same-page retry remains idempotent. */ }
      const { project: p } = await api<{ project: Project }>("draft", input);
      setProject(p); setTitle(p.title); setTracks(initialRows(p)); pending.current = null; setUncertain(false);
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
  async function review() {
    const p = await save(); if (!p) return;
    setReviewing(true); setConfirmed(false); document.getElementById("verification")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const active = project?.tracks.some(t => t.offer?.active) || project?.albumOffer?.active;
  const locked = expressEditorLocked(cacheReady, busy, !!active, uncertain);
  const audioReady = !!project && project.tracks.every(t => t.strictReady);
  const rightsReady = !!project && project.tracks.every(t => t.review?.status === "APPROVED");
  return <main className={styles.root}>
    <Link href="/admin/musique">← Musique</Link>
    <header className={styles.top}><div><p className={styles.kicker}>LNX Beats · Studio Express</p><h1>{project ? "Préparer ma musique" : "Ajouter une musique"}</h1><p className={styles.muted}>Une fiche, vos fichiers, vos prix. Les contrôles restent en place.</p></div><span className={styles.badge}>{mode === "LIVE" ? "Administration" : "QA locale · aucune vente réelle"}</span></header>
    <p className={styles.banner}>{project?.publicVisible ? "Édition publiée. Les nouvelles versions et les offres restent soumises aux contrôles de droits." : "Brouillon privé. Aucune vente avant votre confirmation et les contrôles de droits."}</p>
    <p className={styles.muted}>Artiste principal affiché sur ce site : <strong>{CATALOG_PRIMARY_ARTIST}</strong>. Identité distincte des auteurs, compositeurs et titulaires de droits ; aucun crédit ni justificatif historique remplacé.</p>
    <nav aria-label="Étapes Express"><ol className={styles.steps}><li><a href="#identite">1. Musique</a></li><li>{project ? <a href="#audio">2. Audio · {audioReady ? "prêt" : "à compléter"}</a> : <span>2. Audio</span>}</li><li>{project ? <a href="#droits">3. Droits · {rightsReady ? "enregistrés" : "avec la publication"}</a> : <span>3. Droits</span>}</li><li>{project ? <a href="#verification">4. Vérification</a> : <span>4. Vérification</span>}</li></ol></nav>
    <section className={styles.card} id="identite"><h2>Votre single ou album</h2>
      <div className={styles.grid}><label>Type<select disabled={!!project || locked} value={type} onChange={e => { const next = e.target.value as "SINGLE" | "ALBUM"; if (next === "SINGLE" && tracks.length > 1) { setMessage("Conservez l’album : plusieurs pistes sont déjà saisies."); return; } dirty(); setType(next); }}><option value="SINGLE">Single · un titre</option><option value="ALBUM">Album · plusieurs titres</option></select></label><label>{type === "SINGLE" ? "Titre de la musique" : "Nom de l’album"}<input maxLength={240} value={title} disabled={locked} onChange={e => { dirty(); setTitle(e.target.value); }} placeholder="Le nom de votre prochaine sortie" /></label></div>
      {type === "ALBUM" ? <div className={styles.actions}><label>Nombre de pistes<input type="number" min={1} max={100} value={count} disabled={locked} onChange={e => setCount(e.target.value)} /></label><button className={styles.secondary} onClick={generate} disabled={locked}>Préparer les lignes</button><label>Prix de l’album (€)<input inputMode="decimal" value={albumPrice} onChange={e => { dirty(); setAlbumPrice(e.target.value); }} disabled={locked} /></label></div> : <label className={styles.singlePrice}>Prix du titre (€)<input inputMode="decimal" value={tracks[0]?.price ?? ""} onChange={e => changedTrack(0, { price: e.target.value })} disabled={locked} /></label>}
      {type === "ALBUM" ? <div>{tracks.map((t, i) => <div className={styles.track} key={t.id ?? `new-${i}`}><span>{String(i + 1).padStart(2, "0")}</span><label>Titre de la piste<input value={t.title} maxLength={240} onChange={e => changedTrack(i, { title: e.target.value })} disabled={locked} /></label><label>Prix (€)<input inputMode="decimal" value={t.price} onChange={e => changedTrack(i, { price: e.target.value })} disabled={locked} /></label><div className={styles.order}><button className={styles.secondary} aria-label={`Monter la piste ${i + 1}`} disabled={locked || i === 0} onClick={() => reorder(i, -1)}>↑</button><button className={styles.secondary} aria-label={`Descendre la piste ${i + 1}`} disabled={locked || i === tracks.length - 1} onClick={() => reorder(i, 1)}>↓</button></div></div>)}</div> : null}
      {!project ? <details open={type === "ALBUM" || undefined}><summary>Pochette (facultative à cette étape)</summary><label className={styles.coverPick}>Choisir une pochette<input type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={e => setPreparedCover(e.target.files?.[0] ?? null)} /><small>La sélection reste sur cet appareil. Ses droits seront confirmés avant l’envoi.</small></label></details> : null}
      <div className={styles.actions}><button disabled={busy || !cacheReady} onClick={() => void saveAndImport()}>{uncertain ? "Reprendre le brouillon et l’import" : project ? "Enregistrer et continuer l’import" : "Créer le brouillon et importer mes musiques"}</button></div>
      {type === "SINGLE" ? <details open={distinctSingleTitle || undefined}><summary>Options avancées du single</summary><label className={styles.check}><input type="checkbox" checked={distinctSingleTitle} disabled={locked} onChange={e => { dirty(); setDistinctSingleTitle(e.target.checked); }} /><span>Utiliser un titre de piste différent du nom de la sortie</span></label>{distinctSingleTitle ? <label>Titre de piste distinct<input value={tracks[0]?.title ?? ""} disabled={locked} onChange={e => changedTrack(0, { title: e.target.value })} /></label> : null}</details> : null}
      {project ? <details open={!project.cover || !!preparedCover || undefined}><summary>Pochette — ajouter ou remplacer</summary>{project.cover ? <div className={styles.preview}><Image unoptimized width={240} height={240} src={project.cover.url} alt={project.cover.alt} /><p>Image actuelle conservée jusqu’à l’enregistrement explicite de la suivante.</p></div> : null}<CatalogCoverForm key={project.cover?.id ?? "sans-pochette"} projectId={project.id} slug={project.slug} currentCoverAssetId={project.cover?.id ?? null} hasCover={!!project.cover} alt={project.cover?.alt ?? ""} altPlaceholder={`Pochette de ${project.title}`} preparedFile={preparedCover} onSaved={async () => { setPreparedCover(null); await refreshFiles(); }} returnTo={`/admin/musique/express?projet=${project.id}`} /></details> : null}
    </section>
    {project ? <><section id="audio" tabIndex={-1} className={styles.card}><h2>Fichiers et extraits</h2>{studioEnabled ? <label className={styles.check}><input type="checkbox" checked={studioRequested} onChange={e => setStudioRequested(e.target.checked)} /> Préparer les prochains fichiers avec LNX Beats Studio : analyse, trois formats privés et écoute avant validation. Ce choix ne retraite aucun fichier existant.</label> : null}<DigitalBatchUpload tracks={project.tracks} compact studio={studioEnabled && studioRequested} onStudioQueued={() => setStudioRevision(old => old + 1)} onValidated={() => void refreshFiles()} /><StudioReview projectId={project.id} refreshRevision={studioRevision} onAvailability={studioAvailability} onSaved={refreshFiles} /><div className={styles.filesSummary}>{project.tracks.map(t => <p key={t.id}>{t.position}. {t.title} · <strong>{expressDurationLabel(t.durationMs)}</strong> · {t.formats}</p>)}</div><div className={styles.actions}><Link href={`/admin/musique/${project.slug}/extraits?courants=1`}>Écouter et valider les extraits →</Link><button className={styles.secondary} onClick={() => void refreshFiles()}>Actualiser les fichiers</button></div><details><summary>Confidentialité et versions</summary><p>La durée provient du fichier contrôlé. Chaque nouvel extrait reste à écouter. Les fichiers complets et les versions déjà achetées restent privés et conservés.</p></details></section>
    <section id="droits" className={styles.card}><h2>Droits et crédits</h2><p>Pour vos créations sans restriction signalée, la déclaration de droits est enregistrée avec votre confirmation finale de publication : aucune étape séparée ni justificatif externe systématique.</p><ExpressVersionReview projectId={project.id} onSaved={refreshFiles} rightsOnPublication /><details><summary>Comprendre la déclaration et ses limites</summary><p>Le nom artistique affiché ne prouve ni la propriété des œuvres ni les autorisations. La confirmation finale conserve votre déclaration personnelle et les versions exactes, sans certification indépendante. Les collaborations, reprises, samples et restrictions nécessitent leurs justificatifs privés. Le manifeste technique ne les remplace pas.</p></details>
      {project ? <><p>Crédits sources conservés en Admin : {project.credits.map(c => `${c.role} : ${c.name}`).join(" · ") || "à renseigner"}.</p><details><summary>Renseigner le nom artistique publié</summary><p>Action documentaire explicite seulement. Les variantes du nom principal déjà documentées ne créent pas de doublon. Ce crédit n’attribue aucun autre rôle et n’approuve aucun droit. Les collaborations et crédits détaillés restent dans le Catalogue.</p><label>Artiste crédité<input value={artistName} maxLength={180} placeholder="Nom artistique exact à publier" onChange={e => setArtistName(e.target.value)} /></label><button disabled={busy || !artistName.trim() || !!active} onClick={async () => { setBusy(true); try { const value = await api<{ project: Project }>("artist", { projectId: project.id, name: artistName }); setProject(value.project); setArtistName(CATALOG_PRIMARY_ARTIST); setReviewing(false); setMessage("Crédit artiste vérifié sans doublon ; identité d’affichage séparée, aucun droit commercial approuvé."); } catch (e) { setMessage(e instanceof Error ? e.message : "Crédit refusé."); } finally { setBusy(false); } }}>Confirmer ce crédit</button></details><p><a href={`/api/admin/digital/express?projectId=${project.id}&manifeste=1`}>Télécharger le manifeste technique privé</a> — inventaire des fichiers, pas preuve indépendante de propriété intellectuelle.</p><details><summary>Déclaration groupée des droits sur les versions contrôlées</summary><DigitalRightsReview projectId={project.id} tracks={project.tracks.flatMap(t => t.masterId && t.review ? [{ masterId: t.masterId, title: t.title, version: t.version, strictReady: t.strictReady, review: t.review }] : [])} /></details></> : <p>La revue sera liée aux identifiants et empreintes exacts des fichiers validés, jamais à un simple nom de piste.</p>}
    </section>
    <section id="verification" className={styles.card}><h2>Prévisualisation privée</h2>{project ? <><div className={styles.preview}>{project.cover ? <Image unoptimized width={240} height={240} src={project.cover.url} alt={project.cover.alt} /> : <span className={styles.badge}>Pochette à ajouter</span>}<div><h3>{project.title}</h3><p>{project.type === "ALBUM" ? `Album · ${project.tracks.length} pistes · ${project.albumOffer?.priceCents ? money(project.albumOffer.priceCents) : "prix à compléter"}` : "Single · une seule offre titre"}</p><span className={styles.badge}>{project.publicVisible ? "Déjà public" : "Brouillon privé"}</span></div></div><div className={styles.summary}>{project.tracks.map(t => <div key={t.id} style={{ gridColumn: "1/-1" }}><h3>{t.position}. {t.title} · {t.offer?.priceCents ? money(t.offer.priceCents) : "Prix à compléter"}</h3><p className={styles.muted}><span title={t.durationMs == null ? undefined : `${t.durationMs} ms`}>{expressDurationLabel(t.durationMs)}</span> · {t.formats}<br />Droits : {t.review?.status === "APPROVED" ? "vérifiés" : "à vérifier"} · Extrait : {t.artisticStatus === "VALIDATED" ? "validé" : "à écouter"}</p>{t.previewUrl ? <DigitalAdminPreview src={t.previewUrl} title={t.title} /> : null}</div>)}</div>
      {reviewing ? <><h3>Derniers contrôles</h3>{project.blockers.length ? <ul className={styles.blocked}>{project.blockers.map(b => <li key={b}>{b}</li>)}</ul> : <p>Fichiers, extraits, prix et pochette préparés. Votre déclaration de droits manquante sera enregistrée avec la publication ; les restrictions signalées restent bloquantes.</p>}<label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={!!project.blockers.length} /><span>Je confirme la publication de cette édition et l’ouverture de ses seules offres contrôlées. {project.tracks.some(t => t.review?.status !== "APPROVED") ? OWNER_ORIGINAL_CONFIRMATION : "Les déclarations de droits existantes sont conservées."}</span></label><button disabled={busy || !confirmed || !!project.blockers.length} onClick={async () => { if (inFlight.current) return; inFlight.current = true; setBusy(true); try { const v = await api<{ project: Project }>("publish", { projectId: project.id, reviewToken: project.reviewToken, confirmed, rightsDeclaration: OWNER_PUBLICATION_POLICY, idempotencyKey: crypto.randomUUID() }); setProject(v.project); setConfirmed(false); setMessage("Publication enregistrée après contrôles serveur. Les acquisitions historiques sont inchangées."); } catch (e) { setMessage(e instanceof Error ? e.message : "Publication refusée."); } finally { inFlight.current = false; setBusy(false); } }}>Confirmer la publication contrôlée</button></> : <p className={styles.muted}>« Vérifier et publier » enregistre d’abord le brouillon puis présente les blocages. Aucune ouverture sans confirmation.</p>}</> : <p>Votre fiche apparaîtra ici après le premier enregistrement.</p>}</section>
    </> : null}
    <details className={styles.card}><summary>Options avancées</summary><details><summary>Paramètres pour les prochaines créations</summary><p>Ces valeurs préremplissent uniquement les nouvelles fiches. Aucun tarif existant ni droit ne sera modifié.</p><div className={styles.grid}><label>Titre par défaut (€)<input inputMode="decimal" value={defaultTrack} onChange={e => setDefaultTrack(e.target.value)} /></label><label>Album par défaut (€)<input inputMode="decimal" value={defaultAlbum} onChange={e => setDefaultAlbum(e.target.value)} /></label><label>Nom du profil interne (pas un crédit)<input value={profileName} maxLength={240} onChange={e => setProfileName(e.target.value)} /></label></div><div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={async () => { setBusy(true); try { const v = await api<{ defaults: ExpressDefaults }>("defaults", { trackPriceCents: parseEuroCents(defaultTrack), albumPriceCents: parseEuroCents(defaultAlbum), artistName: profileName }); setDefaults(v.defaults); setMessage("Paramètres enregistrés pour les prochaines créations seulement."); } catch (e) { setMessage(e instanceof Error ? e.message : "Paramètres refusés."); } finally { setBusy(false); } }}>Enregistrer les paramètres</button><button className={styles.secondary} onClick={() => { setDefaultTrack(euros(EXPRESS_DEFAULTS.trackPriceCents)); setDefaultAlbum(euros(EXPRESS_DEFAULTS.albumPriceCents)); setProfileName(EXPRESS_DEFAULTS.artistName); }}>Rétablir les valeurs par défaut</button></div></details>
    <details className={styles.card}><summary>Outils avancés et historique</summary><p>Crédits détaillés, dates, liens, équivalences, diagnostics et audits restent disponibles sans dupliquer le Catalogue.</p><div className={styles.actions}><Link href={project ? `/admin/catalogue/${project.slug}` : "/admin/catalogue"}>Catalogue historique</Link>{project ? <Link href={`/admin/musique/${project.slug}`}>Masters, offres et audits</Link> : null}</div></details>
    </details>
    <footer className={styles.footer}><div className={styles.actions}><button className={styles.secondary} disabled={busy || !cacheReady} onClick={() => void save()}>{busy ? "Enregistrement…" : uncertain ? "Reprendre l’enregistrement" : "Enregistrer les modifications"}</button><button disabled={busy || uncertain || !cacheReady} onClick={() => void review()}>Vérifier et publier</button></div><p ref={feedback} tabIndex={-1} role="status" aria-live="polite" className={styles.message}>{message || (active ? "Offres actives préservées : vous pouvez terminer les autres offres admissibles, sans les désactiver." : "Saisie conservée sur cet appareil · enregistrez votre brouillon pour la sauvegarder.")}</p></footer>
  </main>;
}
