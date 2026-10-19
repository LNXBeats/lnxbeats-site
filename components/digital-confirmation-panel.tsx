
import { T } from "@/components/site-language";
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
    <p className="eyebrow">{status==="GRANTED"?<T text="Complément gratuit"/>:<T text="Paiement numérique"/>}{mode==="TEST"?" · TEST":""}</p>
    <h1>{["PAID","GRANTED"].includes(status)?accessReady?<T text="Votre musique vous attend."/>:status==="GRANTED"?<T text="Votre complément est attribué."/>:<T text="Votre paiement est confirmé."/>:settled?<T text="Votre achat et ses justificatifs."/>:status==="FAILED"?<T text="Paiement non abouti."/>:<T text="Vérification du paiement."/>}</h1>
    <p className={styles.status}><T text={digitalConfirmationMessage(status,needsReconciliation,mode)}/></p>
    <DigitalDocuments mode={mode} orderId={id} documents={documents} accessReady={accessReady} legacy={!hasContract}/>
    <p><Link className="text-link" href={`/retractation?contrat=digital&commande=${id}`}><T text="Rétractation ou réclamation concernant cet achat"/></Link></p>
    <details><summary>{mode==="LIVE"?<T text="Suivi de votre fourniture"/>:<T text="Diagnostics de la démonstration"/>}</summary>
      <p><T text="Confirmation contractuelle"/> : {confirmationReceived?<T text="réception enregistrée"/>:hasContract?<T text="à conserver avant fourniture"/>:<T text="acquisition historique conservée"/>}. <T text="Accès"/> : {accessReady?<T text="selon les droits actifs"/>:<T text="non commencé"/>}.</p>
      <p><T text={digitalNotificationMessage(notificationStatuses,mode)}/></p>
    </details>
    {settled?<Link className="button" href="/compte/musique"><T text="Ouvrir Ma musique"/></Link>:<DigitalOrderActions mode={mode} id={id} paypal={status==="PENDING"&&paypalPending}/>}
    <p><Link className="text-link" href="/musique/panier"><T text="Revenir au panier"/></Link></p>
  </div>;
}
