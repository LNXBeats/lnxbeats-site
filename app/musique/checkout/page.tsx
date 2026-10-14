import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireVerifiedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { quote } from "@/lib/digital/catalog";
import { digitalAvailableProviders } from "@/lib/digital/providers";
import { requireDigitalEnvironment,DIGITAL_TERMS_VERSION } from "@/lib/digital/domain";
import { Container } from "@/components/container";
import { DigitalCheckout } from "@/components/digital-checkout";
import styles from "@/components/digital.module.css";
import { DigitalCartNavigation,DigitalDemoBanner } from "@/components/digital-navigation";
import { localDigitalReviewCheckoutAllowed,LOCAL_REVIEW_MERCHANT } from "@/lib/digital/local-review-policy";
import type { DigitalCompletionView } from "@/components/digital-catalog";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Paiement numérique",robots:{index:false,follow:false}};
export default async function Page(){try{requireDigitalEnvironment();}catch{notFound();}const s=await requireVerifiedUser("/musique/checkout");const cart=await prisma.digitalCart.findUnique({where:{userId:s.user.id},include:{lines:{where:{removed:false}}}});
  let amount=0,error="",lines:Array<{id:string;title:string;priceCents:number;trackCount:number;completion?:DigitalCompletionView|null}>=[];try{const value=await quote(cart?.lines.map(l=>l.offerId)??[],s.user.id);amount=value.totalCents;lines=value.lines.map(l=>({id:l.id,title:l.title,priceCents:l.priceCents,trackCount:l.tracks.length,completion:l.completion??null}));}catch{error="La sélection a changé. Retournez au panier avant de payer.";}
  return <section className={styles.shell}><Container><DigitalCartNavigation/><DigitalDemoBanner/><Link className="back-link" href="/musique/panier">Retour au panier numérique</Link><h1>Payer en sécurité.</h1>{error?<p role="alert">{error}</p>:null}<DigitalCheckout localReview={!error&&localDigitalReviewCheckoutAllowed(s.user.email,LOCAL_REVIEW_MERCHANT,true)} revision={cart?.revision??0} totalCents={amount} lines={lines} providers={error?[]:digitalAvailableProviders()} termsVersion={DIGITAL_TERMS_VERSION}/></Container></section>;}
