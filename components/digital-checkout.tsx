"use client";
import Link from "next/link";
import { useRef,useState } from "react";
import { digitalRequest } from "./digital-cart";
import { digitalMoney,type DigitalCompletionView } from "./digital-catalog";
import { DIGITAL_EARLY_DELIVERY_TEXT, DIGITAL_WITHDRAWAL_TEXT } from "@/lib/digital/domain";
import styles from "./digital.module.css";
export function DigitalCheckout({revision,totalCents,lines,providers,termsVersion,localReview=false}:{revision:number;totalCents:number;lines:Array<{id:string;title:string;priceCents:number;trackCount:number;completion?:DigitalCompletionView|null}>;providers:string[];termsVersion:string;localReview?:boolean}){
  const[early,setEarly]=useState(false),[withdraw,setWithdraw]=useState(false),[provider,setProvider]=useState(providers[0]??""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const[country,setCountry]=useState(""),[billing,setBilling]=useState(""),[subdivision,setSubdivision]=useState("");const key=useRef<string|null>(null);
  async function pay(){setBusy(true);key.current??=crypto.randomUUID();try{const v=await digitalRequest(localReview?"/api/digital/local-review/checkout":"/api/digital/checkout",{revision,...(localReview?{}:{provider}),idempotencyKey:key.current,earlyDelivery:early,withdrawalAcknowledged:withdraw,termsVersion,
    jurisdiction:{countryCode:country,residenceCountryCode:country,billingCountryCode:billing,customerType:"B2C",...(subdivision?{subdivisionCode:subdivision}:{})}});window.location.assign(v.checkoutUrl??`/musique/confirmation/${v.orderId}`);}catch(e){setError(e instanceof Error?e.message:"Paiement indisponible.");}finally{setBusy(false);}}
  const countries=[{id:"FR",label:"France"},{id:"DE",label:"Allemagne"},{id:"BE",label:"Belgique"},{id:"ES",label:"Espagne"},{id:"IT",label:"Italie"},{id:"GB",label:"Royaume-Uni"},{id:"US",label:"États-Unis"},{id:"CA",label:"Canada"},{id:"AU",label:"Australie"},{id:"JP",label:"Japon"}];
  return <section className={styles.panel}><h2>Paiement QA sécurisé</h2><p className={styles.note}>Compte vérifié · EUR · aucun encaissement LIVE autorisé</p>
    <ul className={styles.rows}>{lines.map(l=><li className={styles.row} key={l.id}><span aria-hidden="true">♪</span><div><strong>{l.title}</strong><p>{l.trackCount} piste{l.trackCount>1?"s":""} · WAV + MP3</p>{l.completion?<div className={styles.completionSummary}><span>Prix album : {digitalMoney(l.completion.basePriceCents)}</span><span>Crédit payé, net de remboursements : −{digitalMoney(l.completion.creditCents)}</span><strong>Complément : {digitalMoney(l.priceCents)}</strong></div>:null}</div><strong>{digitalMoney(l.priceCents)}</strong></li>)}</ul>
    <div className={styles.summary}><span>Total serveur QA</span><strong>{digitalMoney(totalCents)}</strong></div>
    <div className={styles.form}>
      {localReview?<p className={styles.note}>Simulation locale uniquement — aucune transaction Stripe ou PayPal. La règle française de cette démonstration est synthétique ; aucune ouverture fiscale LIVE n’est validée.</p>:<label>Prestataire de test<select value={provider} disabled={!providers.length||busy} onChange={e=>setProvider(e.target.value)}>{!providers.length?<option>Aucun sandbox configuré</option>:providers.map(p=><option key={p} value={p}>{p==="STRIPE"?"Stripe TEST":"PayPal SANDBOX"}</option>)}</select></label>}
      <p>Achat à titre particulier uniquement. Le pays est contrôlé avant paiement ; aucune localisation n’est décidée à partir de votre seule adresse IP.</p>
      <label>Pays de résidence<select value={country} onChange={e=>{setCountry(e.target.value);setSubdivision("");}}><option value="">Choisir</option>{countries.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label>Pays de facturation<select value={billing} onChange={e=>setBilling(e.target.value)}><option value="">Choisir</option>{countries.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      {country==="US"||country==="CA"?<label>{country==="US"?"État":"Province"} (code ISO, ex. {country==="US"?"US-CA":"CA-QC"})<input maxLength={10} value={subdivision} onChange={e=>setSubdivision(e.target.value.toUpperCase())}/></label>:null}
      <Link href="/musique/conditions" target="_blank" rel="noopener" className="text-link">Lire les conditions numériques proposées (brouillon QA)</Link>
      <label className={styles.checkbox}><input type="checkbox" checked={early} onChange={e=>setEarly(e.target.checked)}/><span>{DIGITAL_EARLY_DELIVERY_TEXT}</span></label>
      <label className={styles.checkbox}><input type="checkbox" checked={withdraw} onChange={e=>setWithdraw(e.target.checked)}/><span>{DIGITAL_WITHDRAWAL_TEXT}</span></label>
      {error?<p role="alert" className={styles.status}>{error}</p>:null}
      <div className={styles.actions}><button type="button" disabled={(!localReview&&!providers.length)||!early||!withdraw||busy||!totalCents||!country||!billing} onClick={()=>void pay()}>{busy?"Préparation…":localReview?"Simuler le paiement QA local":"Payer en environnement de test"}</button></div>
      <details><summary>Informations de la démonstration</summary><p className={styles.muted}>Prix fictifs et nouveaux textes DRAFT. La licence personnelle proposée ne cède aucun droit d’exploitation. Paiement serveur, confirmation durable et réception reconnue QA restent distincts. Les règles de lancement par territoire, CGV, fiscalité et formulation juridique ne sont pas approuvées.</p></details>
    </div>
  </section>;
}
