"use client";
import Link from "next/link";
import { useRef,useState } from "react";
import { digitalRequest } from "./digital-cart";
import { digitalMoney,type DigitalCompletionView } from "./digital-catalog";
import { DIGITAL_EARLY_DELIVERY_TEXT, DIGITAL_WITHDRAWAL_TEXT } from "@/lib/digital/domain";
import styles from "./digital.module.css";
export function DigitalCheckout({revision,totalCents,lines,providers,termsVersion,localReview=false}:{revision:number;totalCents:number;lines:Array<{id:string;title:string;priceCents:number;trackCount:number;completion?:DigitalCompletionView|null}>;providers:string[];termsVersion:string;localReview?:boolean}){
  const[early,setEarly]=useState(false),[withdraw,setWithdraw]=useState(false),[provider,setProvider]=useState(providers[0]??""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const[country,setCountry]=useState(""),[billing,setBilling]=useState(""),[residencePostalCode,setResidencePostalCode]=useState(""),[billingPostalCode,setBillingPostalCode]=useState(""),[residenceConfirmed,setResidenceConfirmed]=useState(false);const key=useRef<string|null>(null);
  async function pay(){setBusy(true);key.current??=crypto.randomUUID();try{const v=await digitalRequest(localReview?"/api/digital/local-review/checkout":"/api/digital/checkout",{revision,...(localReview?{}:{provider}),idempotencyKey:key.current,earlyDelivery:early,withdrawalAcknowledged:withdraw,termsVersion,
    jurisdiction:{countryCode:country,residenceCountryCode:country,billingCountryCode:billing,customerType:"B2C",residencePostalCode,billingPostalCode,residenceConfirmed}});window.location.assign(v.checkoutUrl??`/musique/confirmation/${v.orderId}`);}catch(e){setError(e instanceof Error?e.message:"Paiement indisponible.");}finally{setBusy(false);}}
  const countries=[{id:"FR",label:"France métropolitaine, Corse comprise"}];
  return <section className={styles.panel}><h2>Paiement QA sécurisé</h2><p className={styles.note}>Compte vérifié · EUR · aucun encaissement LIVE autorisé</p>
    <ul className={styles.rows}>{lines.map(l=><li className={styles.row} key={l.id}><span aria-hidden="true">♪</span><div><strong>{l.title}</strong><p>{l.trackCount} piste{l.trackCount>1?"s":""} · WAV + MP3</p>{l.completion?<div className={styles.completionSummary}><span>Prix album : {digitalMoney(l.completion.basePriceCents)}</span><span>Crédit payé, net de remboursements : −{digitalMoney(l.completion.creditCents)}</span><strong>Complément : {digitalMoney(l.priceCents)}</strong></div>:null}</div><strong>{digitalMoney(l.priceCents)}</strong></li>)}</ul>
    <div className={styles.summary}><span>Total serveur QA</span><strong>{digitalMoney(totalCents)}</strong></div>
    <div className={styles.form}>
      {localReview?<p className={styles.note}>Simulation locale uniquement — aucune transaction Stripe ou PayPal. La règle française de cette démonstration est synthétique ; aucune ouverture fiscale LIVE n’est validée.</p>:<label>Prestataire de test<select value={provider} disabled={!providers.length||busy} onChange={e=>setProvider(e.target.value)}>{!providers.length?<option>Aucun sandbox configuré</option>:providers.map(p=><option key={p} value={p}>{p==="STRIPE"?"Stripe TEST":"PayPal SANDBOX"}</option>)}</select></label>}
      <p>Lancement préparé pour les particuliers résidant en France métropolitaine, Corse comprise. L’outre-mer et l’étranger ne sont pas ouverts. La résidence est vérifiée côté serveur avant toute nouvelle opération ; ni votre seule adresse IP ni le pays de votre carte ne suffisent.</p>
      <label>Pays de résidence<select value={country} onChange={e=>setCountry(e.target.value)}><option value="">Choisir</option>{countries.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label>Code postal de résidence (hors CEDEX)<input autoComplete="section-residence postal-code" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={residencePostalCode} onChange={e=>setResidencePostalCode(e.target.value)}/></label>
      <label>Pays de facturation<select value={billing} onChange={e=>setBilling(e.target.value)}><option value="">Choisir</option>{countries.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label>Code postal de facturation (hors CEDEX)<input autoComplete="section-billing postal-code" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={billingPostalCode} onChange={e=>setBillingPostalCode(e.target.value)}/></label>
      <label className={styles.checkbox}><input type="checkbox" checked={residenceConfirmed} onChange={e=>setResidenceConfirmed(e.target.checked)}/><span>Je confirme acheter à titre personnel et résider en France métropolitaine, Corse comprise. Cette déclaration ne remplace pas la vérification serveur.</span></label>
      <Link href="/musique/conditions" target="_blank" rel="noopener" className="text-link">Lire les conditions numériques proposées (brouillon QA)</Link>
      <label className={styles.checkbox}><input type="checkbox" checked={early} onChange={e=>setEarly(e.target.checked)}/><span>{DIGITAL_EARLY_DELIVERY_TEXT}</span></label>
      <label className={styles.checkbox}><input type="checkbox" checked={withdraw} onChange={e=>setWithdraw(e.target.checked)}/><span>{DIGITAL_WITHDRAWAL_TEXT}</span></label>
      {error?<p role="alert" className={styles.status}>{error}</p>:null}
      <div className={styles.actions}><button type="button" disabled={(!localReview&&!providers.length)||!early||!withdraw||busy||!totalCents||!country||!billing||!residenceConfirmed||!/^[0-9]{5}$/.test(residencePostalCode)||!/^[0-9]{5}$/.test(billingPostalCode)} onClick={()=>void pay()}>{busy?"Préparation…":localReview?"Simuler le paiement QA local":"Payer en environnement de test"}</button></div>
      <details><summary>Informations de la démonstration</summary><p className={styles.muted}>Prix fictifs et nouveaux textes DRAFT. La licence personnelle proposée ne cède aucun droit d’exploitation. Paiement serveur, confirmation durable et réception reconnue QA restent distincts. Les règles de lancement par territoire, CGV, fiscalité et formulation juridique ne sont pas approuvées.</p></details>
    </div>
  </section>;
}
