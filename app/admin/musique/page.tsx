import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import styles from "@/components/digital.module.css";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Musique numérique Admin",robots:{index:false,follow:false}};
export default async function Page(){try{requireDigitalEnvironment();}catch{notFound();}await requireAdmin();const[projects,orders]=await Promise.all([
  prisma.project.findMany({orderBy:{catalogPosition:"asc"},select:{slug:true,title:true,status:true,_count:{select:{tracks:true,digitalOffers:true}}}}),
  prisma.digitalOrder.findMany({orderBy:{createdAt:"desc"},take:100,select:{id:true,status:true,mode:true,totalCents:true,createdAt:true,lines:{select:{title:true}},attempts:{select:{provider:true,status:true,providerReference:true,paymentReference:true}},_count:{select:{events:true}}}})]);
  return <div className="admin-main"><header className="admin-page-heading"><div><p className="admin-kicker">DCN-1.0 · local TEST</p><h1>Musique numérique.</h1></div><p>Offres, médias et achats indépendants de Commander et de la Boutique physique.</p></header><div className={styles.grid}><section className={styles.panel}><h2>Albums et pistes</h2><ul className={styles.rows}>{projects.map(p=><li className={styles.row} key={p.slug}><span>{p._count.tracks}</span><div><strong>{p.title}</strong><p>{p.status} · {p._count.digitalOffers} offres</p></div><Link className="admin-row-action" href={`/admin/musique/${p.slug}`}>Gérer</Link></li>)}</ul></section><section className={styles.panel}><h2>Registre des achats numériques</h2><p className={styles.note}>TEST et LIVE séparés. LIVE non disponible dans ce candidat.</p><Link className="admin-row-action" href="/api/admin/digital/export">Exporter le registre CSV</Link>
  {!orders.length?<p>Aucun achat numérique.</p>:orders.map(o=><article className={styles.panel} key={o.id}><strong>{o.lines.map(l=>l.title).join(" · ")}</strong><p>{o.mode} · {o.status} · {new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(o.totalCents/100)}</p><small>{o.id} · {new Date(o.createdAt).toLocaleString("fr-FR")}</small>{o.attempts.map(a=><p key={a.providerReference??a.provider}>{a.provider} · {a.status}<br/>Référence : {a.providerReference??"À vérifier"}<br/>Paiement : {a.paymentReference??"Non confirmé"}</p>)}<p>{o._count.events} événements audités</p></article>)}</section></div></div>;}
