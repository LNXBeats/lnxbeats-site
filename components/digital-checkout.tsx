"use client";
import { T, ContractLanguageNotice, useSiteLanguage, ContractReadingAid } from "@/components/site-language";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DIGITAL_CHECKOUT_CONSENT_PRESENTATION, DIGITAL_CHECKOUT_IMMEDIATE_CONSENT_TEXT } from "@/lib/digital/checkout-consents";
import { createDigitalCheckoutOperationLock } from "@/lib/digital/checkout-operation";
import { DigitalRequestError, digitalCheckoutPreflightRefused } from "@/lib/digital/request-error";
import { digitalResidenceFeedback, digitalResidenceErrorMessage } from "@/lib/digital/residence-presentation";
import { checkoutPaymentChoicePresentation } from "@/lib/payments/presentation";
import { digitalRequest } from "./digital-cart";
import { type DigitalCompletionView } from "./digital-catalog";
import { DigitalPaypalButtons } from "./digital-paypal-buttons";
import { digitalUiCopy, type DigitalUiMode } from "./digital-mode-copy";
import styles from "./digital-checkout.module.css";

type ResidenceState = { declaration: {id:string;address:{line1:string;postalCode:string;city:string;countryCode:"FR"};addressHash:string;billingPostalCode:string;createdAt:string}|null;reviewStatus:"VERIFIED"|"REVIEW"|"REVOKED";reviewId:string|null;paymentAllowed:boolean;checkoutEligible?:boolean;checkoutCode?:string|null };
type CheckoutResult = {orderId:string;checkoutUrl?:string|null;providerOrderId?:string|null};
export type DigitalCheckoutProps = {
  revision:number;totalCents:number;lines:Array<{id:string;title:string;priceCents:number;trackCount:number;completion?:DigitalCompletionView|null}>;
  providers:string[];termsVersion:string;termsHash?:string;earlyDeliveryText?:string;withdrawalText?:string;
  localReview?:boolean;mode?:DigitalUiMode;contractApproved?:boolean;newSalesOpen?:boolean;paypalClientId?:string|null;nonce?:string|null;
};
export function DigitalCheckout({revision,totalCents,lines,providers,termsVersion,localReview=false,mode="TEST",contractApproved=false,newSalesOpen=false,paypalClientId=null,nonce=null}:DigitalCheckoutProps) {
  const { t, money } = useSiteLanguage();
  const copy=digitalUiCopy(mode),localReviewAllowed=!copy.live&&localReview,contractReady=!copy.live||contractApproved,salesReady=!copy.live||newSalesOpen;
  const freeCompletion=totalCents===0&&lines.length>0&&lines.every(line=>!!line.completion);
  const[termsAccepted,setTermsAccepted]=useState(false),[deliveryConsent,setDeliveryConsent]=useState(false);
  const[busy,setBusy]=useState(false),[attemptNeedsReview,setAttemptNeedsReview]=useState(false),[error,setError]=useState(""),[line1,setLine1]=useState(""),[city,setCity]=useState(""),[residencePostalCode,setResidencePostalCode]=useState("");
  const[billingLine1,setBillingLine1]=useState(""),[billingCity,setBillingCity]=useState(""),[billingPostalCode,setBillingPostalCode]=useState("");
  const[residenceConfirmed,setResidenceConfirmed]=useState(false),[billingAddressSameAsResidence,setBillingAddressSameAsResidence]=useState(true),[differentBilling,setDifferentBilling]=useState(false);
  const[editingAddress,setEditingAddress]=useState(false);
  const[residence,setResidence]=useState<ResidenceState|null>(null),[loaded,setLoaded]=useState(false),[saving,setSaving]=useState(false),[residenceMessage,setResidenceMessage]=useState(""),[pendingOrderId,setPendingOrderId]=useState<string|null>(null);
  const key=useRef<string|null>(null),saveKey=useRef<string|null>(null),operation=useRef(createDigitalCheckoutOperationLock()),startedOrder=useRef<string|null>(null);
  function hydrate(value:ResidenceState,preserveConfirmation=false){if(!preserveConfirmation)setResidenceConfirmed(false);setEditingAddress(false);key.current=null;setResidence(value);if(value.declaration){setLine1(value.declaration.address.line1);setCity(value.declaration.address.city);setResidencePostalCode(value.declaration.address.postalCode);setBillingPostalCode(value.declaration.billingPostalCode);if(!preserveConfirmation){const same=value.declaration.address.postalCode===value.declaration.billingPostalCode;setBillingAddressSameAsResidence(same);setDifferentBilling(!same);}}setLoaded(true);}
  useEffect(()=>{let alive=true;void fetch("/api/digital/residence",{credentials:"same-origin",cache:"no-store"}).then(async response=>{if(!response.ok)throw Error();return response.json();}).then(value=>{if(alive)hydrate(value as ResidenceState);}).catch(()=>{if(alive){setLoaded(true);setResidenceMessage("Votre adresse n’a pas pu être chargée. Actualisez son état avant de payer.");}});return()=>{alive=false;};},[]);
  const saved=residence?.declaration,effectiveBillingPostalCode=billingAddressSameAsResidence?residencePostalCode:billingPostalCode;
  const dirty=!saved||saved.address.line1!==line1||saved.address.city!==city||saved.address.postalCode!==residencePostalCode||saved.billingPostalCode!==effectiveBillingPostalCode;
  const residenceReady=!!saved&&!dirty&&(residence?.checkoutEligible===true||residence?.reviewStatus==="VERIFIED");
  const compactAddress=loaded&&residenceReady&&!editingAddress;
  // A different full billing address still requires the existing manual review.
  // Neither matching postcodes nor a presentation change grants payment rights.
  const billingReady=!copy.live||billingAddressSameAsResidence;
  const paymentReady=contractReady&&salesReady&&residenceReady&&residenceConfirmed&&billingReady&&termsAccepted&&deliveryConsent&&!saving&&!editingAddress&&!attemptNeedsReview&&lines.length>0&&(totalCents>0||freeCompletion);
  function changed(){key.current=null;saveKey.current=null;setError("");setResidenceMessage("");setResidenceConfirmed(false);}
  function chooseSameBilling(checked:boolean){key.current=null;saveKey.current=null;setError("");setBillingAddressSameAsResidence(checked);setDifferentBilling(!checked);}
  async function saveResidence(){if(saving||busy)return;setSaving(true);saveKey.current??=crypto.randomUUID();try{const value=await digitalRequest("/api/digital/residence",{address:{line1,postalCode:residencePostalCode,city,countryCode:"FR"},billingPostalCode:effectiveBillingPostalCode,residenceConfirmed,expectedDeclarationId:saved?.id??null,idempotencyKey:saveKey.current}) as ResidenceState;hydrate(value,true);saveKey.current=null;key.current=null;setResidenceMessage(digitalResidenceFeedback(value));}catch(e){setResidenceMessage(digitalResidenceErrorMessage(e instanceof DigitalRequestError?e.code:null));}finally{setSaving(false);}}
  async function refreshResidence(){if(saving||busy)return;setSaving(true);try{const response=await fetch("/api/digital/residence",{credentials:"same-origin",cache:"no-store"});if(!response.ok)throw Error();const value=await response.json() as ResidenceState;hydrate(value);setResidenceMessage(digitalResidenceFeedback(value));}catch{setResidenceMessage("La vérification est momentanément indisponible. Réessayez dans un instant.");}finally{setSaving(false);}}
  async function requestCheckout(selectedProvider:string):Promise<CheckoutResult>{
    if(!paymentReady||!saved)throw Error("Vérifiez votre adresse et les deux confirmations avant de continuer.");
    key.current??=crypto.randomUUID();
    return digitalRequest(freeCompletion?"/api/digital/completion/grant":localReviewAllowed?"/api/digital/local-review/checkout":"/api/digital/checkout",{
      revision,...(localReviewAllowed||freeCompletion?{}:{provider:selectedProvider}),idempotencyKey:key.current,termsAccepted,earlyDelivery:deliveryConsent,withdrawalAcknowledged:deliveryConsent,termsVersion,consentPresentation:DIGITAL_CHECKOUT_CONSENT_PRESENTATION,
      ...(copy.live?{billingAddressSameAsResidence,...(!billingAddressSameAsResidence?{billingAddress:{countryCode:"FR",line1:billingLine1,city:billingCity,postalCode:billingPostalCode}}:{})}:{}),
      jurisdiction:{countryCode:"FR",residenceCountryCode:"FR",billingCountryCode:"FR",customerType:"B2C",residencePostalCode,billingPostalCode:effectiveBillingPostalCode,residenceConfirmed,residenceDeclarationId:saved.id,addressHash:saved.addressHash}
    }) as Promise<CheckoutResult>;
  }
  function endPaypalOperation(){if(operation.current.isOwnedBy("STRIPE"))return false;operation.current.release("PAYPAL");setBusy(false);return true;}
  async function payByCardOrLocal(){if(!operation.current.claim("STRIPE"))return;setBusy(true);setError("");try{const value=await requestCheckout("STRIPE");setPendingOrderId(value.orderId);window.location.assign(value.checkoutUrl??`/musique/confirmation/${value.orderId}`);}catch(e){setError(e instanceof Error?e.message:"Le paiement est momentanément indisponible.");}finally{if(operation.current.release("STRIPE"))setBusy(false);}}
  async function createPaypalOrder(){if(!operation.current.claim("PAYPAL"))throw Error("Un paiement est déjà en préparation.");setBusy(true);setError("");try{const value=await requestCheckout("PAYPAL");startedOrder.current=value.orderId;setPendingOrderId(value.orderId);if(!value.providerOrderId)throw Error("Consultez le suivi de votre commande avant une nouvelle tentative PayPal.");return{orderId:value.orderId,providerOrderId:value.providerOrderId};}catch(e){if(startedOrder.current||!digitalCheckoutPreflightRefused(e))setAttemptNeedsReview(true);if(operation.current.release("PAYPAL"))setBusy(false);throw e;}}
  async function approvePaypalOrder(order:{orderId:string;providerOrderId:string}){try{await digitalRequest(`/api/digital/orders/${order.orderId}/capture`,{});const confirmation=new URL(`/musique/confirmation/${order.orderId}`,window.location.origin);window.location.assign(confirmation.href);}catch{setAttemptNeedsReview(true);setError("La confirmation PayPal nécessite une vérification. Consultez le suivi de votre commande ; ne recommencez pas le paiement.");}finally{endPaypalOperation();}}
  const addressStatus=residenceMessage||(!loaded?"Chargement de vos coordonnées…":saved&&!dirty&&residence?digitalResidenceFeedback(residence):"Renseignez vos coordonnées puis confirmez-les pour poursuivre.");
  return <div className={styles.checkout}>
    <aside className={styles.order} aria-labelledby="digital-order-heading">
      <div className={styles.sectionTitle}><span aria-hidden="true">1</span><h2 id="digital-order-heading"><T text="Votre commande"/></h2></div>
      <p className={styles.subtle}><T text={lines.length === 1 ? "{count} article · WAV et MP3 inclus" : "{count} articles · WAV et MP3 inclus"} values={{ count: lines.length }}/></p>
      <ul className={styles.items}>{lines.map(line=><li key={line.id}><div className={styles.itemCopy}><strong translate="no" className="notranslate">{line.title}</strong><small>{line.trackCount>1?<T text="Album · {count} pistes" values={{ count: line.trackCount }}/>:<T text="Titre individuel"/>}</small>{line.completion?<p><T text="Prix de l’album"/> {money(line.completion.basePriceCents)} · <T text="Crédit des titres éligibles déjà payés"/> : <span className={styles.money}>−{money(line.completion.creditCents)}</span></p>:null}</div><strong className={styles.money}>{money(line.priceCents)}</strong></li>)}</ul>
      <div className={styles.total}><span>{copy.live?<T text="Total à payer"/>:<T text="Total de démonstration"/>}</span><strong className={styles.money}>{money(totalCents)}</strong></div>
      <Link className={styles.textLink} href="/musique/panier"><T text="Modifier mon panier"/></Link>
      <p className={styles.assurance}><T text="Téléchargements privés · Formats inclus sans supplément"/></p>
    </aside>
    <div className={styles.steps}>
      <section className={styles.panel} aria-labelledby="digital-address-heading">
        <div className={styles.sectionTitle}><span aria-hidden="true">2</span><h2 id="digital-address-heading"><T text="Vos coordonnées"/></h2></div>
        <p className={styles.subtle}><T text="Achat réservé aux particuliers résidant en France métropolitaine, Corse comprise."/></p>
        {compactAddress?<div className={styles.savedAddress}><address>{saved.address.line1}<br/>{saved.address.postalCode} {saved.address.city}<br/><T text="France"/></address><button type="button" className={styles.textButton} disabled={busy||saving} onClick={()=>setEditingAddress(true)}><T text="Modifier mon adresse"/></button></div>:<fieldset disabled={busy||saving||!loaded} className={styles.fields}><legend className="sr-only"><T text="Adresse de résidence"/></legend>
          <label className={styles.full}><T text="Adresse de résidence"/><input name="residence-line1" autoComplete="section-residence address-line1" maxLength={160} value={line1} onChange={e=>{changed();setLine1(e.target.value);}}/></label>
          <label><T text="Code postal"/><input name="residence-postcode" autoComplete="section-residence postal-code" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={residencePostalCode} onChange={e=>{changed();setResidencePostalCode(e.target.value);}}/></label>
          <label><T text="Ville"/><input name="residence-city" autoComplete="section-residence address-level2" maxLength={100} value={city} onChange={e=>{changed();setCity(e.target.value);}}/></label>
        </fieldset>}
        {editingAddress&&residenceReady?<button type="button" className={styles.textButton} disabled={busy||saving} onClick={()=>setEditingAddress(false)}><T text="Conserver cette adresse"/></button>:null}
        <label className={styles.check}><input type="checkbox" checked={billingAddressSameAsResidence} disabled={busy||saving||!loaded} onChange={e=>chooseSameBilling(e.target.checked)}/><span><T text="Mon adresse de facturation est identique."/></span></label>
        {!billingAddressSameAsResidence&&!differentBilling?<button type="button" className={styles.textButton} disabled={busy||saving} onClick={()=>{setDifferentBilling(true);key.current=null;}}><T text="Utiliser une autre adresse de facturation"/></button>:null}
        {differentBilling&&!billingAddressSameAsResidence?<div className={styles.billingDifferent}>
          <fieldset disabled={busy||saving} className={styles.fields}><legend><T text="Adresse de facturation · France"/></legend>
            <label className={styles.full}><T text="Numéro et voie"/><input autoComplete="section-billing address-line1" maxLength={160} value={billingLine1} onChange={e=>{key.current=null;setBillingLine1(e.target.value);}}/></label>
            <label><T text="Code postal"/><input autoComplete="section-billing postal-code" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={billingPostalCode} onChange={e=>{key.current=null;saveKey.current=null;setBillingPostalCode(e.target.value);}}/></label>
            <label><T text="Ville"/><input autoComplete="section-billing address-level2" maxLength={100} value={billingCity} onChange={e=>{key.current=null;setBillingCity(e.target.value);}}/></label>
          </fieldset><p className={styles.notice}><T text="Une adresse de facturation différente nécessite une vérification avant paiement."/> <Link href="/contact"><T text="Contacter LNX Beats"/></Link>.</p>
        </div>:null}
        <label className={styles.check}><input type="checkbox" checked={residenceConfirmed} disabled={busy||saving||!loaded} onChange={e=>{key.current=null;setResidenceConfirmed(e.target.checked);}}/><T text="Je confirme résider à cette adresse et acheter pour mon usage personnel."/></label>
        {!compactAddress?<div className={styles.addressActions}><button type="button" className={styles.secondary} disabled={busy||saving||!loaded||!dirty||!residenceConfirmed||line1.trim().length<4||!city.trim()||!/^[0-9]{5}$/.test(residencePostalCode)||!/^[0-9]{5}$/.test(effectiveBillingPostalCode)} onClick={()=>void saveResidence()}>{saving?<T text="Contrôle des coordonnées…"/>:<T text="Confirmer mes coordonnées"/>}</button><button type="button" className={styles.textButton} disabled={busy||saving||!loaded} onClick={()=>void refreshResidence()}><T text="Actualiser les coordonnées"/></button></div>:null}
        <p role="status" className={styles.addressStatus}><T text={addressStatus}/></p>
      </section>
      <section className={styles.panel} aria-labelledby="digital-consent-heading">
        <div className={styles.sectionTitle}><span aria-hidden="true">3</span><h2 id="digital-consent-heading"><T text="Vos confirmations"/></h2></div>
        <ContractLanguageNotice />
        <label className={styles.check}><input type="checkbox" checked={termsAccepted} disabled={busy||!contractReady} onChange={e=>{key.current=null;setTermsAccepted(e.target.checked);}}/><span lang="fr" translate="no">J’accepte les CGV numériques.</span></label>
        <ContractReadingAid text="J’accepte les CGV numériques."/>
        <Link className={styles.termsLink} href="/musique/conditions#dcn-france-terms" target="_blank" rel="noopener"><T text="Consulter les CGV numériques"/><span className="sr-only">  <T text="— nouvel onglet"/></span></Link>
        <label className={styles.check}><input type="checkbox" checked={deliveryConsent} disabled={busy} onChange={e=>{key.current=null;setDeliveryConsent(e.target.checked);}}/><span lang="fr" translate="no">{DIGITAL_CHECKOUT_IMMEDIATE_CONSENT_TEXT}</span></label>
        <ContractReadingAid text={DIGITAL_CHECKOUT_IMMEDIATE_CONSENT_TEXT}/>
        <p className={styles.subtle}><T text="Usage privé uniquement. Vous conserverez vos conditions et confirmations dans votre compte."/></p>
        {!contractReady?<p className={styles.notice} role="alert"><T text="Les conditions de vente sont momentanément indisponibles. Aucun nouvel achat n’est possible."/></p>:null}
      </section>
      <section className={styles.panel} aria-labelledby="digital-payment-heading">
        <div className={styles.sectionTitle}><span aria-hidden="true">4</span><h2 id="digital-payment-heading">{freeCompletion?<T text="Votre complément"/>:<T text="Paiement sécurisé"/>}</h2></div>
        {!salesReady?<p role="status" className={styles.notice}><T text="Les nouveaux achats sont temporairement suspendus. Vos achats restent disponibles dans"/> <Link href="/compte/musique"><T text="Ma musique"/></Link>.</p>:null}
        {freeCompletion||localReviewAllowed?<><p className={styles.subtle}>{freeCompletion?<T text="Aucun paiement supplémentaire n’est nécessaire."/>:<T text="Simulation locale uniquement. Aucun paiement réel."/>}</p><button type="button" className={styles.payButton} disabled={!paymentReady||busy} onClick={()=>void payByCardOrLocal()}>{busy?<T text="Préparation…"/>:freeCompletion?<T text="Obtenir mon complément"/>:<T text="Simuler le paiement local"/>}</button></>:<>
          <p className={styles.paymentTotal} aria-label={t("Total commun aux deux moyens de paiement")}><span><T text="Total à payer"/></span><strong className={styles.money}>{money(totalCents)}</strong></p>
          <fieldset className={styles.methods} disabled={busy}><legend className="sr-only"><T text="Choisissez votre moyen de paiement"/></legend>
            <div className="payment-methods"><div className="payment-methods__actions" aria-busy={busy}>
              {providers.includes("STRIPE")?<article className="payment-methods__choice payment-methods__choice--stripe" aria-labelledby="digital-stripe-heading">
                <header className="payment-methods__choice-heading"><span className="payment-methods__choice-icon"><svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="3.5" y="6.5" width="25" height="19" rx="3"/><path d="M3.5 12.5h25M8 20.5h7"/></svg></span><span className="payment-methods__choice-title"><strong id="digital-stripe-heading"><T text={checkoutPaymentChoicePresentation.stripe.title}/></strong><span><T text={checkoutPaymentChoicePresentation.stripe.providerLabel}/></span></span></header>
                <p className="payment-methods__choice-details"><T text={checkoutPaymentChoicePresentation.stripe.details}/></p>
                <div className="checkout-action"><button type="button" className="form-button form-button--primary" disabled={!paymentReady||busy} onClick={()=>void payByCardOrLocal()}>{busy?<T text="Préparation sécurisée…"/>:<T text="Payer {amount} en toute sécurité" values={{ amount: money(totalCents) }}/>}</button><small><T text="Carte saisie uniquement chez Stripe."/></small></div>
              </article>:null}
              {providers.includes("PAYPAL")?<article className="payment-methods__choice payment-methods__choice--paypal" aria-labelledby="digital-paypal-heading">
                <header className="payment-methods__choice-heading"><Image className="payment-methods__paypal-logo" src="/brands/paypal-white.svg" width={101} height={32} alt="" aria-hidden="true" loading="eager"/><span className="payment-methods__choice-title"><span id="digital-paypal-heading">{checkoutPaymentChoicePresentation.paypal.providerLabel}</span></span></header>
                <p className="payment-methods__choice-details"><T text={checkoutPaymentChoicePresentation.paypal.details}/></p>
                <div className="checkout-action"><DigitalPaypalButtons ready={paymentReady} canStart={()=>!operation.current.isOwnedBy("STRIPE")} clientId={paypalClientId} nonce={nonce} createOrder={createPaypalOrder} onApprove={approvePaypalOrder} onCancel={order=>{if(!endPaypalOperation())return;if(order){setPendingOrderId(order.orderId);setAttemptNeedsReview(true);}setError("Vous avez quitté PayPal sans terminer le paiement. Consultez le suivi de votre commande avant de réessayer.");}} onError={()=>{if(!endPaypalOperation())return;if(startedOrder.current)setAttemptNeedsReview(true);setError("PayPal est momentanément indisponible. Aucun nouveau paiement automatique ne sera lancé.");}}/><small><T text="Paiement sécurisé avec PayPal."/></small></div>
              </article>:null}
            </div></div>
          </fieldset>
          {!providers.length?<p className={styles.notice}><T text="Le paiement est momentanément indisponible. Aucun montant n’a été débité."/></p>:null}
          {!paymentReady&&providers.length?<p className={styles.subtle}><T text="Vérifiez votre adresse et cochez les deux confirmations pour continuer."/></p>:null}
        </>}
        {error?<p className={styles.notice} role="alert"><T text={error}/></p>:null}
        {pendingOrderId?<Link href={`/musique/confirmation/${pendingOrderId}`} className={styles.textLink}><T text="Consulter le suivi de ma commande"/></Link>:null}
        {attemptNeedsReview&&!pendingOrderId?<Link href="/compte/musique" className={styles.textLink}><T text="Consulter Ma musique avant une nouvelle tentative"/></Link>:null}
      </section>
    </div>
  </div>;
}
