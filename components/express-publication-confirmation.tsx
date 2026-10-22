"use client";
import { OWNER_EXCERPTS_AT_PUBLICATION_CONFIRMATION, OWNER_ORIGINAL_CONFIRMATION } from "@/lib/digital/owner-declaration";

type Props = { blockers: string[]; coverMissing: boolean; premiereOnly: boolean; earlySale: boolean; pendingExcerpts: number; missingRights: boolean; confirmed: boolean; busy: boolean; retrying: boolean; onConfirm: (value: boolean) => void; onPublish: () => void; className: string };
/** One explicit decision; rendering never approves an excerpt, right or offer. */
export function ExpressPublicationConfirmation({ blockers, coverMissing, premiereOnly, earlySale, pendingExcerpts, missingRights, confirmed, busy, retrying, onConfirm, onPublish, className }: Props) {
  const action = premiereOnly ? "Confirmer l’avant-première membres" : earlySale ? "Confirmer la vente avant sortie" : "Confirmer la publication contrôlée";
  return <div>
    {blockers.length ? <div role="status"><p>Il reste {blockers.length} point{blockers.length > 1 ? "s" : ""} à terminer :</p><ul>{blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>{coverMissing ? <a href="#pochette-express">Ajouter la pochette →</a> : null}</div> : <p>Tous les contrôles techniques sont prêts. Votre confirmation ci-dessous enregistre les décisions manquantes pour ces versions exactes.</p>}
    <label className={className}><input type="checkbox" checked={confirmed} disabled={!!blockers.length || busy || retrying} onChange={event => onConfirm(event.target.checked)} /><span>
      {premiereOnly ? "Je confirme cette avant-première réservée aux membres, sans ouvrir de nouvelle vente." : earlySale ? "Je confirme la vente avant sortie, aux prix affichés, avec paiement et téléchargement immédiats." : "Je confirme la publication de cette édition et l’ouverture de ses seules offres contrôlées."}
      {pendingExcerpts ? ` ${OWNER_EXCERPTS_AT_PUBLICATION_CONFIRMATION}` : " Les validations d’extraits déjà enregistrées sont conservées."}
      {missingRights ? " Je confirme les droits déclarés pour cette édition, hors restriction ou collaboration non résolue." : " Les déclarations de droits existantes sont conservées."}
    </span></label>
    {missingRights ? <details><summary>Déclaration de droits liée à cette publication</summary><p>{OWNER_ORIGINAL_CONFIRMATION}</p></details> : null}
    {retrying ? <p role="status">Résultat à vérifier. La reprise utilisera le même identifiant ; aucune nouvelle publication indépendante ne sera créée.</p> : null}
    <button disabled={busy || !confirmed || !!blockers.length} onClick={onPublish}>{busy ? "Enregistrement…" : retrying ? "Reprendre la même publication" : action}</button>
  </div>;
}
