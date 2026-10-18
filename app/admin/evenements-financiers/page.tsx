import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { financialEventDetailPath } from "@/lib/admin/financial-event-policy";
import { randomUUID } from "node:crypto";
import { financialReceiptFingerprint, financialReceiptVisibilitySelect, getFinancialReceiptVisibility } from "@/lib/admin/financial-event-seen";
import { markFinancialReceiptSeenAction } from "./actions";
export const dynamic = "force-dynamic";
export const metadata = { title: "Historique financier", robots: { index: false, follow: false } };
export default async function FinancialEventHistory({ searchParams }: { searchParams: Promise<{vue?: string;etat?: string}> }) {
  await requireAdmin();
  const rows = await prisma.providerEvent.findMany({ where: { OR: [{ outcome: "REQUIRES_REVIEW" }, { technicalReview: { isNot: null } }] },
    orderBy: [{ processedAt: "desc" }, { id: "desc" }], take: 100,
    select: financialReceiptVisibilitySelect });
  const params = await searchParams, seen = await getFinancialReceiptVisibility(rows);
  const view = params.vue === "lus" ? "lus" : params.vue === "tous" ? "tous" : "a-lire";
  const shown = rows.filter(row => view === "tous" || (seen.get(row.id)?.seen === true) === (view === "lus"));
  return <div className="admin-main"><Link href="/admin">Retour au cockpit</Link><h1>Suivi financier · reçus</h1>
    <p>100 événements les plus récents. « J’ai vu » range le reçu dans les éléments lus, sans le rapprocher, rembourser ou modifier son état financier.</p>
    <nav className="admin-filters" aria-label="Filtrer le suivi financier">{[["a-lire","À lire"],["lus","Lus / archivés de la liste"],["tous","Tous (audit)"]].map(([key,label])=><Link key={key} href={`/admin/evenements-financiers?vue=${key}`} aria-current={view===key?"page":undefined}>{label}</Link>)}</nav>
    {params.etat === "lecture-non-enregistree" ? <p role="alert">Le reçu ou son état a changé. Rechargez la page avant de réessayer.</p> : params.etat ? <p role="status">État de lecture enregistré ; reçu et obligations financières conservés.</p> : null}
    {!shown.length ? <p>Aucun reçu dans cette vue.</p> : null}
    <ul className="admin-order-list">{shown.map(row => {const visibility=seen.get(row.id)!;return <li key={row.id}>
      <Link href={financialEventDetailPath(row.id)}><span>{row.provider} · {row.type}<small>{row.processedAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} · {row.livemode ? "LIVE" : "TEST"}</small></span><span>{row.technicalReview ? "Classement technique audité" : visibility.seen ? "Lu — rapprochement non établi" : "Examiner →"}</span></Link>
      <form action={markFinancialReceiptSeenAction}><input type="hidden" name="eventId" value={row.id}/><input type="hidden" name="snapshotHash" value={financialReceiptFingerprint(row)}/><input type="hidden" name="revision" value={visibility.revision}/><input type="hidden" name="requestId" value={randomUUID()}/><input type="hidden" name="seen" value={visibility.seen ? "no" : "yes"}/><button type="submit" className="admin-button">{visibility.seen ? "Remettre à lire" : "J’ai vu · ranger dans les lus"}</button></form>
    </li>;})}</ul>
  </div>;
}
