import Link from "next/link";
import { DigitalDocuments, type DigitalDocumentSummary } from "./digital-documents";
import { DigitalOrderActions } from "./digital-library";
import type { DigitalUiMode } from "./digital-mode-copy";
import { digitalConfirmationMessage, digitalNotificationMessage } from "@/lib/digital/library-policy";
import styles from "./digital.module.css";

/** Presentation only. The page must load this state after verified ownership.
 * Neither a URL parameter nor this component confirms or captures a payment. */
export function DigitalConfirmationPanel({id,mode,status,needsReconciliation,documents,hasContract,accessReady,confirmationReceived,notificationStatuses,paypalPending}: {
  id:string;mode:DigitalUiMode;status:string;needsReconciliation:boolean;documents:DigitalDocumentSummary[];
  hasContract:boolean;accessReady:boolean;confirmationReceived:boolean;notificationStatuses:string[];paypalPending:boolean;
}) {
  const settled=["PAID","PARTIALLY_REFUNDED","REFUNDED","DISPUTED","GRANTED"].includes(status);
  return <div className={styles.panel}>
    <p className="eyebrow">{status==="GRANTED"?"Complément gratuit":"Paiement numérique"}{mode==="TEST"?" · TEST":""}</p>
    <h1>{["PAID","GRANTED"].includes(status)?accessReady?"Votre musique vous attend.":status==="GRANTED"?"Votre complément est attribué.":"Votre paiement est confirmé.":settled?"Votre achat et ses justificatifs.":status==="FAILED"?"Paiement non abouti.":"Vérification du paiement."}</h1>
    <p className={styles.status}>{digitalConfirmationMessage(status,needsReconciliation,mode)}</p>
    <DigitalDocuments mode={mode} orderId={id} documents={documents} accessReady={accessReady} legacy={!hasContract}/>
    <p><Link className="text-link" href={`/retractation?contrat=digital&commande=${id}`}>Rétractation ou réclamation concernant cet achat</Link></p>
    <details><summary>{mode==="LIVE"?"Suivi de votre fourniture":"Diagnostics de la démonstration"}</summary>
      <p>Confirmation contractuelle : {confirmationReceived?"réception enregistrée":hasContract?"à conserver avant fourniture":"acquisition historique conservée"}. Accès : {accessReady?"selon les droits actifs":"non commencé"}.</p>
      <p>{digitalNotificationMessage(notificationStatuses,mode)}</p>
    </details>
    {settled?<Link className="button" href="/compte/musique">Ouvrir Ma musique</Link>:<DigitalOrderActions mode={mode} id={id} paypal={status==="PENDING"&&paypalPending}/>}
    <p><Link className="text-link" href="/musique/panier">Revenir au panier</Link></p>
  </div>;
}
