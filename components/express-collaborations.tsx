"use client";
import { useEffect, useRef, useState } from "react";
import type { CollaborationMutation } from "@/lib/digital/express-collaborations-policy";
import styles from "./express-collaborations.module.css";

type Metadata = Awaited<ReturnType<typeof import("@/lib/digital/express-collaborations").loadExpressCollaborations>>;
type Change = { operation: "credit"; id: string | null; trackId: string | null; name: string; role: "ARTIST" | "FEATURING" } | { operation: "link"; id: string | null; platform: "spotify" | "appleMusic" | "deezer" | "youtube" | "amazonMusic" | "distroKid" | "other"; scope: "ARTIST" | "RELEASE" | "STORE"; url: string; label: string | null };
const platforms = { spotify: "Spotify", appleMusic: "Apple Music", deezer: "Deezer", youtube: "YouTube", amazonMusic: "Amazon Music", distroKid: "DistroKid", other: "Autre" } as const;
const dbPlatforms = { SPOTIFY: "spotify", APPLE_MUSIC: "appleMusic", DEEZER: "deezer", YOUTUBE: "youtube", AMAZON_MUSIC: "amazonMusic", DISTROKID: "distroKid", OTHER: "other" } as const;

/** Explicit artistic edits for collaborations, kept separate from the owner's
 * original-creation defaults and from every legal/publication decision. */
export function ExpressCollaborations({ projectId, disabled = false, initialMetadata, onSaved }: { projectId: string; disabled?: boolean; initialMetadata?: Metadata; onSaved?: () => void | Promise<void> }) {
  const [metadata, setMetadata] = useState<Metadata | null>(initialMetadata ?? null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [newCreditSequence, setNewCreditSequence] = useState(0), [newLinkSequence, setNewLinkSequence] = useState(0);
  const pending = useRef<CollaborationMutation | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/digital/express/collaborations?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Crédits indisponibles."); return value as Metadata; })
      .then(value => { setMetadata(value); setError(""); }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Crédits indisponibles."); });
    return () => controller.abort();
  }, [projectId]);
  async function save(change: Change) {
    if (busy || disabled || !metadata?.editable || metadata.projectId !== projectId || pending.current && pending.current.projectId !== projectId) return;
    const input = pending.current ?? { ...change, projectId, expectedUpdatedAt: metadata.updatedAt, idempotencyKey: crypto.randomUUID() };
    pending.current = input; setBusy(true); setError(""); setSaved(false); setUncertain(false);
    try {
      const response = await fetch("/api/admin/digital/express/collaborations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) });
      const result = await response.json();
      if (!response.ok) { if (response.status < 500) pending.current = null; throw new Error(result.error ?? "Modification non enregistrée."); }
      pending.current = null; setMetadata(result.metadata); setSaved(true);
      if (!input.id) { if (input.operation === "credit") setNewCreditSequence(value => value + 1); else setNewLinkSequence(value => value + 1); }
      await onSaved?.();
    } catch (error) { setUncertain(pending.current !== null); setError(error instanceof Error ? error.message : "Résultat incertain. Réessayez la même action, sans créer un autre crédit."); }
    finally { setBusy(false); }
  }
  return <section className={styles.root} aria-label="Artistes et liens de la collaboration">
    <h3>Artistes et liens de la collaboration</h3>
    {error && <p role="alert">{error}</p>}
    {!metadata || metadata.projectId !== projectId ? <p>Chargement des crédits et liens…</p> : <>
      {!metadata.editable && <p>Cette fiche est déjà publique ou protégée. <a href={`/admin/catalogue/${encodeURIComponent(metadata.slug)}`}>Examiner ses crédits dans le Catalogue</a> sans modifier silencieusement les ventes.</p>}
      {metadata.editable && <p className={styles.note}>Modifiez les artistes et les liens du brouillon. Les auteurs, compositeurs et autres rôles existants restent conservés ; aucune autorisation n’est déduite.</p>}
      <div className={styles.list}>{metadata.credits.filter(c => c.editable).map(credit => <CreditEditor key={credit.id} credit={credit} tracks={metadata.tracks} disabled={disabled || !metadata.editable || busy || uncertain} onSave={save} retry={uncertain && !busy && !disabled} />)}</div>
      {metadata.editable && <CreditEditor key={`new-credit:${newCreditSequence}`} tracks={metadata.tracks} disabled={disabled || busy || uncertain} onSave={save} retry={uncertain && !busy && !disabled} />}
      {metadata.credits.some(c => !c.editable) && <details><summary>Autres crédits conservés</summary><ul>{metadata.credits.filter(c => !c.editable).map(c => <li key={c.id}>{c.name} · {c.role}{c.trackId ? ` · ${metadata.tracks.find(t => t.id === c.trackId)?.title ?? "Piste"}` : ""}</li>)}</ul></details>}
      <h4>Liens de cette sortie</h4>
      <div className={styles.list}>{metadata.links.map(link => link.editable && link.platform in dbPlatforms ? <LinkEditor key={link.id} link={link} disabled={disabled || !metadata.editable || busy || uncertain} onSave={save} retry={uncertain && !busy && !disabled} /> : <p key={link.id}>Lien historique conservé : {link.label ?? link.platform}</p>)}</div>
      {metadata.editable && <LinkEditor key={`new-link:${newLinkSequence}`} disabled={disabled || busy || uncertain} onSave={save} retry={uncertain && !busy && !disabled} />}
      {saved && <p role="status">Artistes ou liens enregistrés avec historique. Fichiers, prix, droits et publication inchangés.</p>}
    </>}
  </section>;
}

function CreditEditor({ credit, tracks, disabled, onSave, retry }: { credit?: Metadata["credits"][number]; tracks: Metadata["tracks"]; disabled: boolean; onSave: (change: Change) => void; retry: boolean }) {
  const [name, setName] = useState(credit?.name ?? ""), [role, setRole] = useState<"ARTIST" | "FEATURING">(credit?.role === "FEATURING" ? "FEATURING" : "ARTIST"), [trackId, setTrackId] = useState(credit?.trackId ?? "");
  return <form className={styles.row} onSubmit={event => { event.preventDefault(); onSave({ operation: "credit", id: credit?.id ?? null, name, role, trackId: trackId || null }); }}>
    <label>Artiste<input value={name} maxLength={180} required disabled={disabled} onChange={event => setName(event.target.value)} /></label>
    <label>Rôle<select value={role} disabled={disabled} onChange={event => setRole(event.target.value as "ARTIST" | "FEATURING")}><option value="ARTIST">Artiste principal</option><option value="FEATURING">Avec / featuring</option></select></label>
    <label>Pour<select value={trackId} disabled={disabled || !!credit} onChange={event => setTrackId(event.target.value)}><option value="">Toute la sortie</option>{tracks.map(track => <option key={track.id} value={track.id}>{track.title}</option>)}</select></label>
    <button type="submit" disabled={disabled && !retry}>{retry ? "Réessayer la même modification" : credit ? "Enregistrer l’artiste" : "Ajouter l’artiste"}</button>
  </form>;
}
function LinkEditor({ link, disabled, onSave, retry }: { link?: Metadata["links"][number]; disabled: boolean; onSave: (change: Change) => void; retry: boolean }) {
  const [platform, setPlatform] = useState<keyof typeof platforms>(link && link.platform in dbPlatforms ? dbPlatforms[link.platform as keyof typeof dbPlatforms] : "spotify"), [scope, setScope] = useState<"ARTIST" | "RELEASE" | "STORE">(link?.scope ?? "RELEASE"), [url, setUrl] = useState(link?.url ?? ""), [label, setLabel] = useState(link?.label ?? "");
  return <form className={styles.row} onSubmit={event => { event.preventDefault(); onSave({ operation: "link", id: link?.id ?? null, platform, scope, url, label: label || null }); }}>
    <label>Plateforme<select value={platform} disabled={disabled} onChange={event => setPlatform(event.target.value as keyof typeof platforms)}>{Object.entries(platforms).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label>Type de lien<select value={scope} disabled={disabled} onChange={event => setScope(event.target.value as typeof scope)}><option value="RELEASE">Cette sortie</option><option value="ARTIST">Profil artiste de cette sortie</option><option value="STORE">Boutique de cette sortie</option></select></label>
    <label className={styles.wide}>Lien HTTPS<input type="url" value={url} maxLength={2000} required disabled={disabled} onChange={event => setUrl(event.target.value)} /></label>
    <label>Libellé facultatif<input value={label} maxLength={180} disabled={disabled} onChange={event => setLabel(event.target.value)} /></label>
    <button type="submit" disabled={disabled && !retry}>{retry ? "Réessayer la même modification" : link ? "Enregistrer le lien" : "Ajouter le lien"}</button>
  </form>;
}
