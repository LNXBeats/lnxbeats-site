"use client";
import { useEffect, useState } from "react";
import styles from "./digital.module.css";
import admin from "./digital-admin.module.css";

type EquivalenceStatus = "APPROVED" | "REVOKED";
type EquivalenceReview = { id: string; sourceMasterId: string; targetMasterId: string; status: string; reviewedAt: string; reviewerId: string };
type Equivalences = {
  masters: Array<{ id: string; version: number; status: string }>;
  reviews: EquivalenceReview[];
  truncated: boolean;
};
function refusal(code?: string, fallback?: string) {
  const messages: Record<string, string> = {
    EQUIVALENCE_LOCAL_ONLY: "Cette revue est fermée hors du profil local TEST explicitement autorisé.",
    EQUIVALENCE_SAME_TRACK_REQUIRED: "Les deux masters doivent appartenir à la piste canonique sélectionnée. Aucun rapprochement entre pistes différentes n’est autorisé.",
    EQUIVALENCE_EVIDENCE_REQUIRED: "L’approbation exige une référence privée, son SHA‑256 complet et votre attestation de relecture.",
    EQUIVALENCE_REVIEW_CHANGED: "Une nouvelle décision a été enregistrée pour cette paire. Rechargez ses états et relisez-la avant une autre décision.",
    EQUIVALENCE_MASTER_REQUIRES_REVIEW: "L’une des versions ou de ses empreintes n’est pas exploitable pour cette revue. Aucun master n’a été modifié.",
    IDEMPOTENCY_CONFLICT: "Cette clé correspond à une autre décision. Rechargez les états ; ne multipliez pas les enregistrements pour contourner ce conflit.",
  };
  return code && messages[code] || fallback || "La décision n’a pas pu être enregistrée. Vérifiez la paire et rechargez ses états si nécessaire.";
}
export function DigitalMasterEquivalences({ tracks }: { tracks: Array<{ id: string; title: string }> }) {
  const [trackId, setTrackId] = useState(""), [data, setData] = useState<Equivalences | null>(null), [loading, setLoading] = useState(false);
  const [sourceMasterId, setSource] = useState(""), [targetMasterId, setTarget] = useState(""), [status, setStatus] = useState<EquivalenceStatus | "">("");
  const [reference, setReference] = useState(""), [sha, setSha] = useState(""), [attested, setAttested] = useState(false), [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [pair, setPair] = useState<{ key: string; current: EquivalenceReview | null } | null>(null), [pairError, setPairError] = useState(false), [reload, setReload] = useState(0);
  function changed() { setRequestId(null); setMessage(""); }
  useEffect(() => {
    if (!trackId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/admin/digital/master-equivalences?trackId=${encodeURIComponent(trackId)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const value = await response.json() as Equivalences & { error?: string; code?: string };
        if (!response.ok || !Array.isArray(value.masters) || !Array.isArray(value.reviews)) throw new Error(refusal(value.code, value.error));
        if (!controller.signal.aborted) setData(value);
      } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Chargement indisponible."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [trackId]);
  useEffect(() => {
    if (!trackId || !sourceMasterId || !targetMasterId || sourceMasterId === targetMasterId) return;
    const controller = new AbortController(), key = `${trackId}:${sourceMasterId}:${targetMasterId}`;
    void (async () => {
      try {
        const query = new URLSearchParams({ trackId, sourceMasterId, targetMasterId });
        const response = await fetch(`/api/admin/digital/master-equivalences?${query}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const value = await response.json() as { current?: EquivalenceReview | null; code?: string; error?: string };
        if (!response.ok || !Object.prototype.hasOwnProperty.call(value, "current") || value.current !== null && (!value.current || value.current.sourceMasterId !== sourceMasterId || value.current.targetMasterId !== targetMasterId)) throw new Error(refusal(value.code, value.error));
        if (!controller.signal.aborted) { setPair({ key, current: value.current ?? null }); setPairError(false); }
      } catch (error) { if (!controller.signal.aborted) { setPairError(true); setMessage(error instanceof Error ? error.message : "État de la paire indisponible. Aucune décision ne peut être envoyée."); } }
    })();
    return () => controller.abort();
  }, [trackId, sourceMasterId, targetMasterId, reload]);
  const pairReady = pair?.key === `${trackId}:${sourceMasterId}:${targetMasterId}`, latest = pairReady ? pair.current : null;
  const version = (id: string) => { const master = data?.masters.find(entry => entry.id === id); return `${master ? `V${master.version}` : "Version hors liste"} · ${id.slice(0, 8)}`; };
  return <section className={styles.panel} aria-labelledby="master-equivalences-heading"><h2 id="master-equivalences-heading">Équivalences explicites entre versions</h2>
    <p>Une ancienne version acquise et la version proposée peuvent être examinées pour le crédit « Compléter l’album ». Choisissez la piste canonique, puis les deux masters exacts dans le sens source acquise → cible proposée. Aucune équivalence n’est déduite du titre, du fichier, d’un nouvel import ou d’une autre paire.</p>
    <p className={styles.note}>Limite actuelle : les deux masters doivent appartenir au même identifiant de piste. Les pistes d’identifiants différents restent refusées, même si leurs titres se ressemblent. Cette revue n’accorde aucun fichier ni droit de la nouvelle version, ne modifie aucun achat et ne remplace pas les autorisations de ses ayants droit.</p>
    <form className={styles.form} onSubmit={async event => {
      event.preventDefault(); if (busy || !data || !pairReady || !status || !attested || !sourceMasterId || !targetMasterId || sourceMasterId === targetMasterId) return;
      setBusy(true); setMessage(""); const key = requestId ?? crypto.randomUUID(); setRequestId(key);
      try {
        const response = await fetch("/api/admin/digital/master-equivalences", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({
          trackId, sourceMasterId, targetMasterId, status, expectedReviewId: latest?.id ?? null,
          privateEvidenceReference: reference.trim() || null, evidenceSha256: sha.trim() || null, attested, reason: reason.trim(), idempotencyKey: key }) });
        const value = await response.json() as { equivalences?: Equivalences; duplicate?: boolean; error?: string; code?: string };
        if (!response.ok || !value.equivalences) throw new Error(refusal(value.code, value.error));
        setData(value.equivalences); setRequestId(null); setAttested(false); setReference(""); setSha(""); setReason(""); setStatus(""); setPair(null); setPairError(false); setReload(previous => previous + 1);
        setMessage(value.duplicate ? "Cette décision était déjà enregistrée. Aucun événement ni droit n’a été ajouté en double." : "Décision ajoutée au journal. Les acquisitions et fichiers historiques sont inchangés ; le devis serveur recontrôlera la paire et ses preuves.");
      } catch (error) { setMessage(error instanceof Error ? error.message : "Résultat inconnu : conservez les champs et réessayez le même enregistrement."); }
      finally { setBusy(false); }
    }}>
      <label>Piste canonique à examiner<select value={trackId} disabled={busy} onChange={event => { changed(); setTrackId(event.target.value); setData(null); setLoading(!!event.target.value); setSource(""); setTarget(""); setStatus(""); setAttested(false); setReference(""); setSha(""); setReason(""); setPair(null); setPairError(false); }} required><option value="">Choisir explicitement une piste</option>{tracks.map(track => <option value={track.id} key={track.id}>{track.title}</option>)}</select></label>
      {loading ? <p role="status">Chargement des versions et décisions…</p> : null}
      {data ? <>
        {data.masters.length < 2 ? <p>Deux versions enregistrées de la même piste sont nécessaires. Un import ne crée jamais d’équivalence automatiquement.</p> : null}
        <div className={admin.fields}><label>Master source déjà acquis<select value={sourceMasterId} required disabled={busy} onChange={event => { changed(); setSource(event.target.value); setAttested(false); setPair(null); setPairError(false); }}><option value="">Choisir la version source exacte</option>{data.masters.map(master => <option key={master.id} value={master.id}>V{master.version} · {master.id.slice(0, 8)} · {master.status}</option>)}</select></label>
          <label>Master cible proposé<select value={targetMasterId} required disabled={busy} onChange={event => { changed(); setTarget(event.target.value); setAttested(false); setPair(null); setPairError(false); }}><option value="">Choisir la version cible exacte</option>{data.masters.map(master => <option key={master.id} value={master.id} disabled={master.id === sourceMasterId}>V{master.version} · {master.id.slice(0, 8)} · {master.status}</option>)}</select></label></div>
        {sourceMasterId && targetMasterId ? <><p>Source : {sourceMasterId}<br />Cible : {targetMasterId}</p><p>Dernière décision pour cette paire exacte : {!pairReady ? pairError ? "indisponible — enregistrement bloqué" : "chargement…" : latest ? `${latest.status === "APPROVED" ? "Approuvée" : "Révoquée"} · ${new Date(latest.reviewedAt).toLocaleString("fr-FR")}` : "aucune"}.</p>{pairError ? <button type="button" className={styles.quiet} disabled={busy} onClick={() => { setPairError(false); setReload(previous => previous + 1); }}>Recharger l’état de cette paire</button> : null}</> : null}
        <label>Nouvelle décision<select value={status} required disabled={busy} onChange={event => { changed(); setStatus(event.target.value as EquivalenceStatus | ""); setAttested(false); }}><option value="">Choisir explicitement</option><option value="APPROVED">Approuver cette paire source → cible</option><option value="REVOKED">Révoquer cette paire source → cible</option></select></label>
        <label>Référence privée de la justification<input value={reference} maxLength={197} placeholder="private-evidence:album/equivalence-v1-v2" required={status === "APPROVED"} disabled={busy} onChange={event => { changed(); setReference(event.target.value); }} autoComplete="off" /></label>
        <label>SHA‑256 de la justification ou du manifeste privé<input value={sha} minLength={64} maxLength={64} pattern="[a-f0-9]{64}" required={status === "APPROVED"} disabled={busy} onChange={event => { changed(); setSha(event.target.value); }} autoComplete="off" /></label>
        <label>Motif administratif sur une ligne, sans correspondance confidentielle<input value={reason} required maxLength={500} disabled={busy} onChange={event => { changed(); setReason(event.target.value); }} /></label>
        <label className={styles.checkbox}><input type="checkbox" checked={attested} required disabled={busy} onChange={event => { changed(); setAttested(event.target.checked); }} /><span>J’ai relu cette paire exacte dans le sens indiqué et le motif de cette décision ; pour l’approuver, j’ai examiné sa justification privée pour le crédit de complément. Cette décision ne copie pas les droits d’exploitation ou les fichiers d’une version vers l’autre.</span></label>
        <button disabled={busy || !pairReady || !status || !attested || !sourceMasterId || !targetMasterId || sourceMasterId === targetMasterId || !reason.trim()}>{busy ? "Enregistrement…" : status === "REVOKED" ? "Enregistrer la révocation" : "Enregistrer l’approbation explicite"}</button>
        <details className={admin.details}><summary>Journal des décisions de cette piste — {data.reviews.length} affichée(s)</summary><p>Décisions append-only, non transitives. {data.truncated ? "Liste tronquée ; l’historique complet reste conservé." : "Historique disponible pour cette piste."} Les références et empreintes des justificatifs ne sont pas renvoyées par cette liste.</p>{data.reviews.length ? <ol>{data.reviews.map(review => <li key={review.id}><p>{version(review.sourceMasterId)} → {version(review.targetMasterId)} · {review.status === "APPROVED" ? "Approuvée" : "Révoquée"} · {new Date(review.reviewedAt).toLocaleString("fr-FR")}</p><p>Décision : {review.id} · Réviseur : {review.reviewerId}</p></li>)}</ol> : <p>Aucune décision enregistrée.</p>}</details>
      </> : null}<p role="status">{message}</p>
    </form>
  </section>;
}
