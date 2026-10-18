"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DigitalRightsReviewStatus, DigitalRightsReviewSummary } from "@/lib/digital/rights-review-policy";
import styles from "./digital.module.css";
type Track = { masterId: string; title: string; version: number; strictReady: boolean; review: DigitalRightsReviewSummary };
const labels: Record<DigitalRightsReviewStatus, string> = { DRAFT: "Brouillon", REVIEW_REQUIRED: "Revue nécessaire", APPROVED: "Droits vérifiés pour cette version", REJECTED: "Refusé", REVOKED: "Approbation révoquée" };
export function DigitalRightsReview({ projectId, tracks, externalSelection, onRecorded }: { projectId: string; tracks: Track[]; externalSelection?: { ids: string[]; change: (ids: string[]) => void }; onRecorded?: () => void }) {
  const router = useRouter(), [internalSelected, setInternalSelected] = useState<string[]>([]), [status, setStatus] = useState<DigitalRightsReviewStatus>("REVIEW_REQUIRED");
  const selected = externalSelection?.ids ?? internalSelected;
  function setSelected(value: string[] | ((previous: string[]) => string[])) { const next = typeof value === "function" ? value(selected) : value; if (externalSelection) externalSelection.change(next); else setInternalSelected(next); }
  const [reference, setReference] = useState(""), [sha, setSha] = useState(""), [attested, setAttested] = useState(false), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [reviews, setReviews] = useState(tracks.map(track => track.review)), [requestId, setRequestId] = useState<string | null>(null);
  function changed() { setRequestId(null); setMessage(""); }
  return <section className={styles.panel} aria-labelledby="rights-review-title"><h2 id="rights-review-title">Droits et collaborateurs — par version audio</h2>
    <p>Avant toute nouvelle vente, vérifiez les autorisations de la composition, du master, des interprètes/collaborateurs, des samples ou reprises éventuels et de l’extrait. La simple case de l’offre ne constitue plus une preuve. Cette revue couvre la vente personnelle WAV/MP3 en France métropolitaine, Corse comprise.</p>
    <p className={styles.note}>Conservez les documents dans votre archive privée. Saisissez seulement sa référence opaque et le SHA‑256 du justificatif ou du manifeste vérifié. Aucun document n’est publié ; le logiciel ne remplace pas votre examen juridique.</p>
    <form className={`${styles.form} ${styles.rightsReview}`} onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setMessage("");
      const key = requestId ?? crypto.randomUUID(); setRequestId(key);
      try {
        const response = await fetch("/api/admin/digital/rights-reviews", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          projectId, masterIds: selected, expectedReviews: selected.map(masterId => ({ masterId, reviewId: reviews.find(review => review.masterId === masterId)?.reviewId ?? null })),
          status, privateEvidenceReference: reference.trim() || null, evidenceSha256: sha.trim() || null, attested, reason: reason.trim() || null, idempotencyKey: key }) });
        const value = await response.json() as { reviews?: DigitalRightsReviewSummary[]; error?: string };
        if (!response.ok || !value.reviews) throw new Error(value.error ?? "La revue n’a pas été enregistrée. Vérifiez la version et rechargez les états si nécessaire.");
        const updated = value.reviews; setReviews(previous => previous.map(review => updated.find(entry => entry.masterId === review.masterId) ?? review));
        setRequestId(null); setSelected([]); setMessage("Revue ajoutée au journal, sans effacer les décisions précédentes. Aucun achat, document ou fichier historique modifié. L’offre et la fiscalité restent à vérifier séparément."); router.refresh(); onRecorded?.();
      } catch (error) { setMessage(error instanceof Error ? error.message : "Résultat inconnu : ne recommencez pas avec une autre clé. Réessayez ce même enregistrement ou rechargez ses états."); }
      finally { setBusy(false); }
    }}>
      {externalSelection ? <p>{selected.length} version(s) explicitement sélectionnée(s) dans la liste ci-dessus. Ce circuit requiert vos justificatifs privés et ne suppose aucune absence de collaboration.</p> : null}
      <fieldset disabled={busy} hidden={!!externalSelection}><legend>Versions courantes à examiner — 100 maximum par lot</legend>
        {!tracks.length ? <p>Aucun WAV importé. Importez et validez d’abord une version audio.</p> : tracks.map(track => { const review = reviews.find(entry => entry.masterId === track.masterId) ?? track.review; return <label key={track.masterId} className={styles.checkbox}>
          <input type="checkbox" disabled={!track.strictReady || busy} checked={selected.includes(track.masterId)} onChange={event => { changed(); setSelected(previous => event.target.checked ? [...previous, track.masterId] : previous.filter(id => id !== track.masterId)); }} />
          <span>{track.title} — V{track.version} · {track.strictReady ? labels[review.status] : "Ancienne preuve audio : nouvelle version strictement validée requise pour les nouvelles ventes"}</span>
        </label>; })}
        <button type="button" className={styles.quiet} onClick={() => { changed(); setSelected(tracks.filter(track => track.strictReady).slice(0, 100).map(track => track.masterId)); }}>Sélectionner les versions éligibles</button>
      </fieldset>
      <label>Décision de revue<select value={status} onChange={event => { changed(); setStatus(event.target.value as DigitalRightsReviewStatus); }} disabled={busy}>
        <option value="DRAFT">Brouillon</option><option value="REVIEW_REQUIRED">Revue nécessaire</option><option value="APPROVED">Approuver les droits de ces versions</option><option value="REJECTED">Refuser</option><option value="REVOKED">Révoquer l’approbation</option>
      </select></label>
      <label>Référence d’archive privée<input value={reference} maxLength={197} placeholder="private-evidence:album/manifest-01" onChange={event => { changed(); setReference(event.target.value); }} required={status === "APPROVED"} disabled={busy} /></label>
      <label>SHA‑256 du justificatif ou manifeste privé<input value={sha} minLength={64} maxLength={64} pattern="[a-f0-9]{64}" autoComplete="off" onChange={event => { changed(); setSha(event.target.value); }} required={status === "APPROVED"} disabled={busy} /></label>
      <label className={styles.checkbox}><input type="checkbox" checked={attested} required={status === "APPROVED"} disabled={busy} onChange={event => { changed(); setAttested(event.target.checked); }} /><span>J’ai examiné les preuves et vérifié toutes les autorisations composition/master/collaborateurs/interprètes/samples/reprises/extraits nécessaires à cette vente personnelle WAV/MP3 en France métropolitaine, Corse comprise. Aucune restriction incompatible n’est connue.</span></label>
      <label>Motif administratif, sans correspondance confidentielle<textarea value={reason} maxLength={500} required={status === "REJECTED" || status === "REVOKED"} disabled={busy} onChange={event => { changed(); setReason(event.target.value); }} /></label>
      <button disabled={busy || !selected.length || selected.length > 100}>{busy ? "Enregistrement…" : `Enregistrer la revue de ${selected.length} version(s)`}</button><p role="status">{message}</p>
    </form>
  </section>;
}
