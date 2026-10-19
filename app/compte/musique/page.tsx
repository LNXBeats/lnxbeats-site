import { getSiteLocale, serverT } from "@/lib/i18n/server";

import { T } from "@/components/site-language";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireVerifiedUser } from "@/lib/auth/session";
import { library } from "@/lib/digital/library";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { Container } from "@/components/container";
import { DigitalLibraryOrders } from "@/components/digital-library";
import { DigitalCartNavigation, DigitalDemoBanner } from "@/components/digital-navigation";
import { parseDigitalLibraryPage } from "@/lib/digital/presentation";
import styles from "@/components/digital.module.css";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Ma musique",robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{page?:string|string[]}>}){
  const locale = await getSiteLocale();let mode;try{mode=requireDigitalEnvironment();}catch{notFound();}const query=await searchParams,page=parseDigitalLibraryPage(query.page),s=await requireVerifiedUser(`/compte/musique${page>1?`?page=${page}`:""}`),{orders,pagination}=await library(s.user.id,page);
  return <section className={styles.shell}><Container><div className={styles.heading}><div><p className="eyebrow"><T text="Bibliothèque personnelle"/></p><h1><T text="Ma musique."/></h1></div><Link className="text-link" href="/discographie"><T text="Explorer la discographie"/></Link></div><DigitalDemoBanner mode={mode}/><DigitalCartNavigation/>
  {!orders.length?<div className={styles.panel}><h2><T text="Votre bibliothèque est encore vide."/></h2><p><T text="Les achats apparaîtront après confirmation serveur du paiement."/></p></div>:<DigitalLibraryOrders orders={orders}/>}<nav className={styles.libraryPagination} aria-label={serverT(locale, "Pages de votre bibliothèque")}><span><T text="Page {page} sur {pages} · {count} achats" values={{page:pagination.page,pages:pagination.totalPages,count:pagination.total}} /></span><div className={styles.actions}>{pagination.hasPrevious?<Link className={styles.quiet} href={`/compte/musique?page=${pagination.page-1}`}><T text="Achats plus récents" /></Link>:null}{pagination.hasNext?<Link className={styles.quiet} href={`/compte/musique?page=${pagination.page+1}`}><T text="Achats précédents" /></Link>:null}</div></nav></Container></section>;}
