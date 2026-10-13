import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireVerifiedUser } from "@/lib/auth/session";
import { library } from "@/lib/digital/library";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { Container } from "@/components/container";
import { DigitalDownloadButton } from "@/components/digital-library";
const digitalMoney=(c:number)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(c/100);
import styles from "@/components/digital.module.css";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Ma musique",robots:{index:false,follow:false}};
export default async function Page(){try{requireDigitalEnvironment();}catch{notFound();}const s=await requireVerifiedUser("/compte/musique"),orders=await library(s.user.id);
  return <section className={styles.shell}><Container><div className={styles.heading}><div><p className="eyebrow">Bibliothèque personnelle</p><h1>Ma musique.</h1></div><Link className="text-link" href="/discographie">Explorer la discographie</Link></div><p className={styles.note}>Revue locale · achats QA, aucun paiement LIVE.</p>
  {!orders.length?<div className={styles.panel}><h2>Votre bibliothèque est encore vide.</h2><p>Les achats apparaîtront après confirmation serveur du paiement.</p></div>:orders.map(o=><section className={styles.panel} key={o.id}><div className={styles.heading}><h2>{o.lines.map(l=>l.title).join(" · ")}</h2><span>{digitalMoney(o.totalCents)} · {o.mode}</span></div><p>{new Date(o.createdAt).toLocaleDateString("fr-FR")} · {o.status==="PAID"?"Paiement confirmé":o.status==="REFUNDED"?"Remboursé — accès retiré":o.status==="DISPUTED"?"Litige — accès suspendu":o.status==="PARTIALLY_REFUNDED"?"Remboursement partiel":"Paiement en attente / à vérifier"}</p>
    {o.lines.map(l=><div className={styles.panel} key={l.id}><strong>{l.title}</strong>{["PAID","PARTIALLY_REFUNDED"].includes(o.status)&&l.entitlements.some(e=>e.status==="ACTIVE")?<>
      {l.scope==="ALBUM"&&l.entitlements.every(e=>e.status==="ACTIVE")?<DigitalDownloadButton lineId={l.id} masterId={null} label="Télécharger l’album ZIP"/>:null}
      <ul className={styles.rows}>{l.entitlements.map(e=><li className={styles.row} key={e.id}><span aria-hidden="true">♪</span><div><strong>{e.master.track.title}</strong><p className={styles.muted}>Version acquise {e.master.version}</p></div>{e.status==="ACTIVE"?<DigitalDownloadButton lineId={l.id} masterId={e.masterId} label="Télécharger la piste"/>:<span>Accès {e.status==="REVOKED"?"retiré":"suspendu"}</span>}</li>)}</ul></>:<p className={styles.muted}>Aucun accès actif pour cette ligne.</p>}</div>)}
    <p className={styles.muted}>Historique conservé. Facturation et TVA numériques à valider avant LIVE ; aucun document fiscal fictif n’est émis.</p><Link className="text-link" href={`/musique/confirmation/${o.id}`}>Voir le statut de la commande</Link></section>)}</Container></section>;}
