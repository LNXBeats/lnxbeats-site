import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireVerifiedUser } from "@/lib/auth/session";
import { getDigitalOrderStatus } from "@/lib/digital/commerce";
import { prisma } from "@/lib/prisma";
import { Container } from "@/components/container";
import { DigitalOrderActions } from "@/components/digital-library";
import styles from "@/components/digital.module.css";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"État du paiement musique",robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;const s=await requireVerifiedUser(`/musique/confirmation/${id}`);let state;try{state=await getDigitalOrderStatus(s.user.id,id);}catch{notFound();}
  const attempt=await prisma.digitalPaymentAttempt.findFirst({where:{orderId:id},orderBy:{createdAt:"desc"},select:{provider:true,status:true}});
  return <section className={styles.shell}><Container><div className={styles.panel}><p className="eyebrow">Paiement numérique · TEST</p><h1>{state.status==="PAID"?"Votre musique vous attend.":"Vérification du paiement."}</h1><p className={styles.status}>{state.status==="PAID"?"Paiement confirmé côté serveur.":state.status==="FAILED"?"Paiement non abouti. Aucun accès délivré.":state.needsReconciliation?"Résultat ambigu, conservé pour vérification. Ne recommencez pas le paiement.":"En attente de confirmation prestataire. Aucun téléchargement débloqué par cette page."}</p>
  {state.status==="PAID"?<Link className="button" href="/compte/musique">Ouvrir Ma musique</Link>:<DigitalOrderActions id={id} paypal={attempt?.provider==="PAYPAL"&&attempt.status==="OPEN"}/>}</div></Container></section>;}
