import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireVerifiedUser } from "@/lib/auth/session";
import { getDigitalOrderStatus } from "@/lib/digital/commerce";
import { prisma } from "@/lib/prisma";
import { Container } from "@/components/container";
import { DigitalOrderActions } from "@/components/digital-library";
import { DigitalDocuments } from "@/components/digital-documents";
import { digitalConfirmationMessage } from "@/lib/digital/library-policy";
import styles from "@/components/digital.module.css";
import { DigitalCartNavigation,DigitalDemoBanner,DigitalConfirmedCartCleanup } from "@/components/digital-navigation";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"État du paiement musique",robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;const s=await requireVerifiedUser(`/musique/confirmation/${id}`);let state;try{state=await getDigitalOrderStatus(s.user.id,id);}catch{notFound();}
  const attempt=await prisma.digitalPaymentAttempt.findFirst({where:{orderId:id},orderBy:{createdAt:"desc"},select:{provider:true,status:true}});
  const order=await prisma.digitalOrder.findUniqueOrThrow({where:{id},include:{lines:{select:{offerId:true}},fulfillment:true,documents:{select:{id:true,kind:true,number:true,status:true,snapshotHash:true}},notifications:{select:{kind:true,status:true}}}});
  const settled=["PAID","PARTIALLY_REFUNDED","REFUNDED","DISPUTED"].includes(state.status);
  return <section className={styles.shell}><Container>{state.status==="PAID"?<DigitalConfirmedCartCleanup offerIds={order.lines.map(l=>l.offerId)}/>:null}<DigitalCartNavigation/><DigitalDemoBanner/><div className={styles.panel}><p className="eyebrow">Paiement numérique · TEST</p><h1>{state.status==="PAID"?"Votre musique vous attend.":settled?"Votre achat et ses justificatifs.":"Vérification du paiement."}</h1><p className={styles.status}>{digitalConfirmationMessage(state.status,state.needsReconciliation)}</p>
  <DigitalDocuments orderId={id} documents={order.documents} accessReady={!order.contractSnapshot||!!order.fulfillment?.accessReadyAt} legacy={!order.contractSnapshot}/>
  <p><Link className="text-link" href={`/retractation?contrat=digital&commande=${id}`}>Exercer mon droit de rétractation ou présenter une réclamation</Link></p>
  <details><summary>Diagnostics de la démonstration</summary><p>Confirmation contractuelle : {order.fulfillment?.confirmationStatus==="ACKNOWLEDGED"?"réception reconnue QA":order.contractSnapshot?"à recevoir avant fourniture":"acquisition DCN‑1.0 conservée"}. Accès : {!order.contractSnapshot||order.fulfillment?.accessReadyAt?"selon les droits actifs":"non commencé"}.</p><p>E-mails : {order.notifications.length?order.notifications.map(n=>`${n.kind} : ${n.status==="CAPTURED_QA"?"capturé localement, pas délivré":n.status}`).join(" · "):"aucun envoi"}.</p></details>
  {settled?<Link className="button" href="/compte/musique">Ouvrir Ma musique</Link>:<DigitalOrderActions id={id} paypal={attempt?.provider==="PAYPAL"&&attempt.status==="OPEN"}/>}</div></Container></section>;}
