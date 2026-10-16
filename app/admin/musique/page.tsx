import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { digitalAdminPage } from "@/lib/digital/admin";
import { digitalSalesControl } from "@/lib/digital/sales-control";
import { digitalNewSalesAllowed } from "@/lib/digital/runtime-policy";
import { DigitalSalesControlPanel } from "@/components/digital-sales-control";
import styles from "@/components/digital.module.css";
import admin from "@/components/digital-admin.module.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Musique numérique Admin", robots: { index: false, follow: false } };
const PAGE_SIZE = 30;
export default async function Page({ searchParams }: { searchParams: Promise<{ projets?: string; achats?: string }> }) {
  let mode;try { mode=requireDigitalEnvironment(); } catch { notFound(); }
  await requireAdmin();
  const salesControl = mode === "LIVE" ? await digitalSalesControl(prisma, mode) : null;
  const query = await searchParams, projectPage = digitalAdminPage(query.projets), orderPage = digitalAdminPage(query.achats);
  const [projects, orders, projectCount, orderCount] = await Promise.all([
    prisma.project.findMany({ orderBy: [{ catalogPosition: "asc" }, { id: "asc" }], skip: (projectPage - 1) * PAGE_SIZE, take: PAGE_SIZE, select: { slug: true, title: true, status: true, _count: { select: { tracks: true, digitalOffers: true } } } }),
    prisma.digitalOrder.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (orderPage - 1) * PAGE_SIZE, take: PAGE_SIZE, select: { id: true, status: true, mode: true, totalCents: true, createdAt: true, lines: { select: { title: true } }, attempts: { select: { id: true, provider: true, status: true, providerReference: true, paymentReference: true } }, _count: { select: { events: true } } } }),
    prisma.project.count(), prisma.digitalOrder.count(),
  ]);
  const url = (kind: "projets" | "achats", page: number) => `/admin/musique?projets=${kind === "projets" ? page : projectPage}&achats=${kind === "achats" ? page : orderPage}`;
  function pagination(kind: "projets" | "achats", page: number, count: number) { const pages = Math.max(1, Math.ceil(count / PAGE_SIZE)); return <nav className={admin.pagination} aria-label={kind === "projets" ? "Pages des projets" : "Pages du registre"}>{page > 1 ? <Link className="admin-row-action" href={url(kind, page - 1)}>Précédent</Link> : null}<span>Page {page} / {pages} · {count} entrée(s)</span>{page < pages ? <Link className="admin-row-action" href={url(kind, page + 1)}>Suivant</Link> : null}</nav>; }
  return <div className={`admin-main ${admin.workflow}`}><header className="admin-page-heading"><div><p className="admin-kicker">DCN · {mode==="LIVE"?"LIVE":"local TEST"}</p><h1>Musique numérique.</h1></div><p>Offres, médias et achats indépendants de Commander et de la Boutique physique.</p></header>
    <p className={admin.banner}>{mode==="LIVE"?"Administration commerciale — seules les offres complètes et autorisées peuvent être achetées. Les acquisitions historiques restent conservées.":"Démonstration — aucun paiement réel. Prix, documents et opérations synthétiques QA, sans valeur comptable/fiscale."}</p>
    {salesControl ? <DigitalSalesControlPanel initial={salesControl} configured={digitalNewSalesAllowed(mode)} /> : null}
    <Link className="admin-row-action" href="/admin/musique/juridictions">Territoires et nouveaux documents numériques — revue, lecture seule</Link>
    <div className={styles.actions}><Link className="admin-row-action" href="/admin/musique/residences">Résidences — déclarations et revues privées</Link><Link className="admin-row-action" href="/admin/musique/retractations">Rétractations, conformité et demandes commerciales</Link></div>
    <div className={styles.grid}><section className={styles.panel}><div className={styles.heading}><h2>Albums et pistes</h2><Link className="admin-row-action" href="/admin/catalogue/nouveau">Créer un album / single dans le Catalogue</Link></div><p className={styles.muted}>L’identité et les pistes sont réutilisées du Catalogue. Les masters et offres numériques se règlent dans « Gérer ».</p><ul className={styles.rows}>{projects.map(p => <li className={styles.row} key={p.slug}><span>{p._count.tracks}</span><div><strong>{p.title}</strong><p>{p.status} · {p._count.digitalOffers} offres</p></div><Link className="admin-row-action" href={`/admin/musique/${p.slug}`}>Gérer</Link></li>)}</ul>{pagination("projets", projectPage, projectCount)}</section>
      <section className={styles.panel}><h2>Registre des achats numériques</h2><p className={styles.note}>TEST et LIVE séparés. Chaque achat conserve son environnement et ses justificatifs.</p><Link className="admin-row-action" href="/api/admin/digital/export">Exporter le registre CSV</Link>
        {!orders.length ? <p>Aucun achat numérique sur cette page.</p> : orders.map(o => <article className={styles.panel} key={o.id}><strong>{o.lines.map(l => l.title).join(" · ")}</strong><p>{o.mode} · {o.status} · {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(o.totalCents / 100)}</p><small>{o.id} · {new Date(o.createdAt).toLocaleString("fr-FR")}</small>{o.attempts.map(a => <p key={a.id}>{a.provider} · {a.status}<br />Référence : {a.providerReference ?? "À vérifier"}<br />Paiement : {a.paymentReference ?? "Non confirmé"}</p>)}<p>{o._count.events} événements audités</p><Link className="admin-row-action" href={`/admin/musique/achats/${o.id}`}>Voir achat, documents et ajustements</Link></article>)}
        {pagination("achats", orderPage, orderCount)}
      </section></div>
  </div>;
}
