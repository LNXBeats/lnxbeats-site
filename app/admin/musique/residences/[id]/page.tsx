import Link from "next/link";
import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {requireAdmin} from "@/lib/auth/session";
import {digitalUuid,requireDigitalEnvironment} from "@/lib/digital/domain";
import {getDigitalFranceResidenceAdminPanelV2} from "@/lib/digital/france-residence-v2-service";
import {DIGITAL_FRANCE_RESIDENCE_ATTESTATION} from "@/lib/digital/france-residence-v2-policy";
import type {OrderActor} from "@/lib/orders/domain";
import {DigitalResidenceReview} from "@/components/digital-residence-review";
import styles from "@/components/digital.module.css";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Examen résidence DCN",robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{id:string}>}){try{requireDigitalEnvironment();}catch{notFound();}const{id}=await params;if(!digitalUuid(id))notFound();
  const s=await requireAdmin(),actor={id:s.user.id,email:s.user.email,name:s.user.name,role:s.user.role,status:"ACTIVE",emailVerified:s.user.emailVerified} as OrderActor,p=await getDigitalFranceResidenceAdminPanelV2(actor,id),d=p.declaration;
  return <div className="admin-main"><Link href="/admin/musique/residences">Retour à la file privée</Link><h1>Examen proportionné de la résidence</h1><p className={styles.note}>Données privées minimales, sans document d’identité imposé. Aucun paiement ne découle de cet enregistrement ; tous les autres gates restent séparés.</p>
    {!d?<p>Aucune déclaration enregistrée.</p>:<><section className={styles.panel}><h2>Adresse déclarée par le titulaire</h2><p>{d.address.line1}<br/>{d.address.postalCode} {d.address.city}<br/>France métropolitaine/Corse</p><p>Code postal de facturation déclaré : {d.billingPostalCode}</p><p>État de revue : {p.reviewStatus} · Déclaration {d.createdAt}</p></section>
    <section className={styles.panel}><h2>Contexte de facturation réellement disponible</h2><p>{p.billing?.status??"ABSENT"}</p><p>Source : instantanés privés de factures DCN appartenant à ce compte. Ces informations restent déclaratives ; aucune adresse n’a été relue chez Stripe ou PayPal par ce module.</p>
      {p.billing?.documents.filter(row=>row.addressAvailable).map(row=><p key={row.id}>Facture …{row.id.slice(-8)} : {row.countryCode??"pays non disponible"} · {row.postalCode??"code postal non disponible"}</p>)}
      {p.billing?.status==="ABSENT"?<p>Aucune adresse de facturation disponible dans ces factures. Cette absence n’est ni une contradiction ni une preuve ; l’examen manuel peut s’appuyer sur un échange proportionné, documenté sans copie d’identité systématique.</p>:null}
    </section>
    {p.review?<section className={styles.panel}><h2>Dernière décision conservée</h2><p>{p.review.status} · {p.review.reviewedAt} · échéance {p.review.expiresAt}</p><p>{p.review.reason}</p></section>:null}
    <section className={styles.panel}><DigitalResidenceReview key={p.reviewId??d.id} subjectUserId={id} declarationId={d.id} reviewId={p.reviewId} billingStatus={p.billing?.status??"ABSENT"} attestation={DIGITAL_FRANCE_RESIDENCE_ATTESTATION}/></section></>}
  </div>;
}
