import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { DigitalOfferForm,DigitalBatchUpload } from "@/components/digital-admin";
import styles from "@/components/digital.module.css";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Offres et pistes numériques",robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{slug:string}>}){try{requireDigitalEnvironment();}catch{notFound();}await requireAdmin();const{slug}=await params;
  const p=await prisma.project.findUnique({where:{slug},include:{digitalOffers:true,tracks:{orderBy:{position:"asc"},include:{digitalMasters:{orderBy:{version:"desc"},take:1,select:{version:true,status:true,previewDurationMs:true}}}}}});if(!p)notFound();
  const tracks=p.tracks.map(t=>({id:t.id,title:t.title,position:t.position,version:t.digitalMasters[0]?.version??0,previewDurationMs:t.digitalMasters[0]?.previewDurationMs??null,offer:p.digitalOffers.find(o=>o.trackId===t.id)??null}));
  return <div className="admin-main"><Link className="admin-row-action" href="/admin/musique">Retour musique numérique</Link><header className="admin-page-heading"><div><p className="admin-kicker">Médias, prix, vente · TEST</p><h1>{p.title}</h1></div><Link className="admin-row-action" href={`/admin/catalogue/${slug}`}>Identité et publication Catalogue</Link></header><p className={styles.note}>Publication éditoriale, distribution, extrait et commercialisation restent distincts. Aucun prix de maquette importé.</p>
  <div className={styles.panel}><DigitalOfferForm projectId={p.id} trackId={null} offer={p.digitalOffers.find(o=>o.scope==="ALBUM")??null} label="Offre album indépendante"/></div><DigitalBatchUpload tracks={tracks}/>
  <section className={styles.grid}>{tracks.map(t=><div className={styles.panel} key={t.id}><h2>{t.position}. {t.title}</h2><p>Master : {t.version?`version ${t.version} privée`:"à importer"} · Extrait : {t.previewDurationMs?`${(t.previewDurationMs/1000).toFixed(2)} s`:"non disponible"}</p><DigitalOfferForm projectId={p.id} trackId={t.id} offer={t.offer} label="Offre titre individuel"/></div>)}</section></div>;}
