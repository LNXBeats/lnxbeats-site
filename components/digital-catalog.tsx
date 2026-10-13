"use client";
import Link from "next/link";
import { useState } from "react";
import { AudioPreviewPlayer } from "@/components/audio-preview-player";
import styles from "./digital.module.css";
export const DIGITAL_CART_KEY="lnx:dcn:cart:v1";
export function readDigitalCart():string[]{try{const v=JSON.parse(localStorage.getItem(DIGITAL_CART_KEY)??"[]");return Array.isArray(v)?v.filter((x):x is string=>typeof x==="string").slice(0,50):[];}catch{return[];}}
export function writeDigitalCart(ids:string[]){localStorage.setItem(DIGITAL_CART_KEY,JSON.stringify([...new Set(ids)]));window.dispatchEvent(new Event("dcn-cart"));}
export const digitalMoney=(c:number)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(c/100);
export function AddDigitalOffer({id,priceCents,label="Ajouter au panier"}:{id:string;priceCents:number;label?:string}){const[added,setAdded]=useState(false),[error,setError]=useState(false);
  return <div className={styles.actions}><strong>{digitalMoney(priceCents)}</strong><button type="button" onClick={()=>{try{writeDigitalCart([...readDigitalCart(),id]);setAdded(true);}catch{setError(true);}}}>{added?"Ajouté au panier":label}</button>{added?<Link className={styles.quiet} href="/musique/panier">Voir le panier numérique</Link>:null}{error?<span role="status">Le navigateur n’a pas pu enregistrer le panier.</span>:null}</div>;}
export type DigitalProjectView={album:{id:string;priceCents:number;version:number;trackCount:number}|null;tracks:Array<{id:string;title:string;position:number;publication:string;previewUrl:string|null;previewDurationMs:number|null;offer:{id:string;priceCents:number;version:number}|null}>};
export function DigitalTracklist({view}:{view:DigitalProjectView}){return <section className={styles.panel} aria-labelledby="digital-tracks-title">
  <div className={styles.heading}><div><p className="eyebrow">Musique numérique</p><h2 id="digital-tracks-title">Écouter. Choisir. Retrouver.</h2></div><Link className="text-link" href="/musique/panier">Panier numérique</Link></div>
  <p className={styles.note}>Version locale de revue · prix QA uniquement · aucun paiement LIVE</p>
  {view.album?<div className={styles.panel}><strong>Album · {view.album.trackCount} pistes incluses</strong><p className={styles.muted}>L’offre album est indépendante des titres unitaires. La liste des pistes incluses est figée à l’achat ; les titres annoncés ne sont pas vendus.</p><AddDigitalOffer {...view.album} label="Ajouter l’album"/></div>:<p className={styles.muted}>Vente de l’album non disponible.</p>}
  <ol className={styles.rows}>{view.tracks.map(t=><li className={styles.row} key={t.id}><span>{String(t.position).padStart(2,"0")}</span><strong>{t.title}</strong>
    <div className={styles.actions}>{t.offer?<AddDigitalOffer {...t.offer}/>:<span className={styles.muted}>{t.publication==="ANNOUNCED"?"Titre annoncé · non commercialisé":"Achat indisponible"}</span>}</div>
    <div className={styles.preview}>{t.previewUrl?<AudioPreviewPlayer src={t.previewUrl} title={t.title} durationMs={t.previewDurationMs} compact/>:<span className={styles.muted}>Extrait non disponible</span>}</div>
  </li>)}</ol>{!view.tracks.length?<p>Aucune piste publiée pour ce projet.</p>:null}
  <p className={styles.muted}>Extraits autonomes de 60 secondes maximum. Les fichiers complets ne sont jamais publics.</p>
</section>;}
