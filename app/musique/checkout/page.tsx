
import { T } from "@/components/site-language";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireVerifiedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { quote } from "@/lib/digital/catalog";
import { digitalAvailableProviders } from "@/lib/digital/providers";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { DIGITAL_FRANCE_TERMS_VERSION } from "@/lib/digital/france-legal";
import { Container } from "@/components/container";
import { DigitalCheckout } from "@/components/digital-checkout";
import styles from "@/components/digital.module.css";
import { DigitalCartNavigation,DigitalDemoBanner } from "@/components/digital-navigation";
import { localDigitalReviewCheckoutAllowed,LOCAL_REVIEW_MERCHANT } from "@/lib/digital/local-review-policy";
import type { DigitalCompletionView } from "@/components/digital-catalog";
import { approvedDigitalFranceContract } from "@/lib/digital/contract-approval-service";
import { DIGITAL_FRANCE_LIVE_CONTRACT_VERSION } from "@/lib/digital/france-live-contract";
import { digitalNewSalesAllowed } from "@/lib/digital/runtime-policy";
import { digitalPaypalSdkConfiguration } from "@/lib/digital/paypal-sdk-config";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Paiement numérique",robots:{index:false,follow:false}};
export default async function Page(){let mode;try{mode=requireDigitalEnvironment();}catch{notFound();}const s=await requireVerifiedUser("/musique/checkout");const cart=await prisma.digitalCart.findUnique({where:{userId:s.user.id},include:{lines:{where:{removed:false}}}});
  let amount=0,error="",lines:Array<{id:string;title:string;priceCents:number;trackCount:number;completion?:DigitalCompletionView|null}>=[];try{const value=await quote(cart?.lines.map(l=>l.offerId)??[],s.user.id);amount=value.totalCents;lines=value.lines.map(l=>({id:l.id,title:l.title,priceCents:l.priceCents,trackCount:l.tracks.length,completion:l.completion??null}));}catch{error="La sélection a changé. Retournez au panier avant de payer.";}
  const live=mode==="LIVE",paypalSdk=digitalPaypalSdkConfiguration();let contractApproved=false;if(live){try{await approvedDigitalFranceContract(prisma);contractApproved=true;}catch{error="Les conditions de vente ne sont pas encore disponibles pour un nouvel achat.";}}
  return <section className={styles.shell}><Container><DigitalCartNavigation/><DigitalDemoBanner mode={mode}/><p className="eyebrow"><T text="Votre musique, à emporter"/></p><h1><T text="Finaliser mon achat"/></h1>{error?<p role="alert">{error}</p>:null}<DigitalCheckout paypalClientId={paypalSdk?.clientId??null} mode={mode} contractApproved={contractApproved} newSalesOpen={digitalNewSalesAllowed(mode)} localReview={!live&&!error&&localDigitalReviewCheckoutAllowed(s.user.email,LOCAL_REVIEW_MERCHANT,true)} revision={cart?.revision??0} totalCents={amount} lines={lines} providers={error?[]:digitalAvailableProviders()} termsVersion={live?DIGITAL_FRANCE_LIVE_CONTRACT_VERSION:DIGITAL_FRANCE_TERMS_VERSION}/></Container></section>;}
