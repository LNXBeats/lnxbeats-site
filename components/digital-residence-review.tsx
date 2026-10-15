"use client";
import {useState,useRef} from "react";
import {useRouter} from "next/navigation";
import {digitalRequest} from "./digital-cart";
import styles from "./digital.module.css";
export function DigitalResidenceReview({subjectUserId,declarationId,reviewId,billingStatus,attestation}:{subjectUserId:string;declarationId:string;reviewId:string|null;billingStatus:string;attestation:string}){
  const router=useRouter(),key=useRef<string|null>(null),[status,setStatus]=useState("REVIEW"),[source,setSource]=useState("CUSTOMER_CONTACT_AND_CONTEXT"),[reason,setReason]=useState(""),[reference,setReference]=useState("");
  const[attested,setAttested]=useState(false),[resolved,setResolved]=useState(false),[days,setDays]=useState(90),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const changed=()=>{key.current=null;setMessage("");};
  return <form className={styles.form} onSubmit={async event=>{event.preventDefault();if(busy)return;setBusy(true);key.current??=crypto.randomUUID();
    try{await digitalRequest("/api/admin/digital/residence-reviews",{subjectUserId,declarationId,expectedReviewId:reviewId,status,reviewSource:source,reason,attested,conflictResolved:resolved,privateReference:reference||null,validDays:days,idempotencyKey:key.current});
      setMessage("Revue append-only enregistrée. Aucun achat, facture, master ou ancien droit modifié ; aucun paiement LIVE ouvert.");key.current=null;router.refresh();
    }catch(e){setMessage(e instanceof Error?e.message:"Résultat inconnu : conserver cette clé et recharger les états avant une autre décision.");}finally{setBusy(false);}}}>
    <h2>Décision de revue manuelle proportionnée</h2><p>Aucune pièce d’identité systématique. Examinez uniquement les informations nécessaires, le contexte réellement disponible et les incohérences. Une facture dont l’adresse vient du client n’est pas une preuve de résidence indépendante ni une donnée vérifiée par le prestataire.</p>
    <label>Décision<select value={status} disabled={busy} onChange={e=>{changed();setStatus(e.target.value);}}><option value="REVIEW">Conserver en revue — bloquant</option><option value="VERIFIED">Résidence examinée pour cette déclaration</option><option value="REVOKED">Révoquer la revue</option></select></label>
    <label>Source de l’examen<select value={source} disabled={busy} onChange={e=>{changed();setSource(e.target.value);}}><option value="CUSTOMER_CONTACT_AND_CONTEXT">Échange client et contexte disponible</option><option value="EXISTING_BUSINESS_RECORDS">Dossier commercial privé existant</option><option value="PROPORTIONATE_EXTERNAL_REVIEW">Examen manuel proportionné hors module</option></select></label>
    <label>Motif administratif (10 à 500 caractères, sans recopier de document)<textarea minLength={10} maxLength={500} value={reason} required disabled={busy} onChange={e=>{changed();setReason(e.target.value);}}/></label>
    <label>Référence privée facultative — aucun document d’identité imposé<input value={reference} maxLength={188} placeholder="private:residence/revue-01" disabled={busy} onChange={e=>{changed();setReference(e.target.value);}}/></label>
    <label>Validité de la revue, en jours (1 à 365)<input type="number" min={1} max={365} value={days} disabled={busy} onChange={e=>{changed();setDays(Number(e.target.value));}}/></label>
    {billingStatus==="CONFLICT"?<label className={styles.checkbox}><input type="checkbox" checked={resolved} required={status==="VERIFIED"} disabled={busy} onChange={e=>{changed();setResolved(e.target.checked);}}/><span>J’ai examiné et résolu l’incohérence précise du contexte affiché (par exemple ancienne adresse modifiée) ; mon motif décrit la conclusion. Sans cette revue, la demande reste bloquée.</span></label>:null}
    <label className={styles.checkbox}><input type="checkbox" checked={attested} required={status==="VERIFIED"} disabled={busy} onChange={e=>{changed();setAttested(e.target.checked);}}/><span>{attestation}</span></label>
    <button type="submit" disabled={busy||reason.trim().length<10||status==="VERIFIED"&&(!attested||billingStatus==="CONFLICT"&&!resolved)}>{busy?"Enregistrement…":"Enregistrer cette seule décision"}</button><p role="status">{message}</p>
  </form>;
}
