import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireVerifiedUser } from "@/lib/auth/session";
import { getDigitalOrderStatus } from "@/lib/digital/commerce";
import { prisma } from "@/lib/prisma";
import { Container } from "@/components/container";
import { DigitalConfirmationPanel } from "@/components/digital-confirmation-panel";
import styles from "@/components/digital.module.css";
import { DigitalCartNavigation,DigitalDemoBanner,DigitalConfirmedCartCleanup } from "@/components/digital-navigation";
import { digitalUiIsLive } from "@/components/digital-mode-copy";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"État du paiement musique",robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;const s=await requireVerifiedUser(`/musique/confirmation/${id}`);let state;try{state=await getDigitalOrderStatus(s.user.id,id);}catch{notFound();}
  const attempt=await prisma.digitalPaymentAttempt.findFirst({where:{orderId:id},orderBy:{createdAt:"desc"},select:{provider:true,status:true}});
  const order=await prisma.digitalOrder.findUniqueOrThrow({where:{id},include:{lines:{select:{offerId:true}},fulfillment:true,documents:{select:{id:true,kind:true,number:true,status:true,snapshotHash:true}},notifications:{select:{kind:true,status:true}}}});
  const mode=digitalUiIsLive(order.mode)?"LIVE":"TEST";
  return <section className={styles.shell}><Container>{["PAID","GRANTED"].includes(state.status)?<DigitalConfirmedCartCleanup offerIds={order.lines.map(l=>l.offerId)}/>:null}<DigitalCartNavigation/><DigitalDemoBanner mode={mode}/>
    <DigitalConfirmationPanel id={id} mode={mode} status={state.status} needsReconciliation={state.needsReconciliation}
      documents={order.documents} hasContract={!!order.contractSnapshot} accessReady={!order.contractSnapshot||!!order.fulfillment?.accessReadyAt}
      confirmationReceived={order.fulfillment?.confirmationStatus==="ACKNOWLEDGED"} notificationStatuses={order.notifications.map(n=>n.status)}
      paypalPending={attempt?.provider==="PAYPAL"&&attempt.status==="OPEN"}/>
  </Container></section>;
}
