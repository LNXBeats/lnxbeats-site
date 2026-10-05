import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { financialEventDetailPath } from "@/lib/admin/financial-event-policy";
export const dynamic = "force-dynamic";
export const metadata = { title: "Historique financier", robots: { index: false, follow: false } };
export default async function FinancialEventHistory() {
  await requireAdmin();
  const rows = await prisma.providerEvent.findMany({ where: { OR: [{ outcome: "REQUIRES_REVIEW" }, { technicalReview: { isNot: null } }] },
    orderBy: [{ processedAt: "desc" }, { id: "desc" }], take: 100,
    select: { id: true, provider: true, type: true, processedAt: true, technicalReview: { select: { id: true } } } });
  return <div className="admin-main"><Link href="/admin">Retour au cockpit</Link><h1>Historique des événements financiers</h1><p>100 événements les plus récents. Les reçus signés restent conservés.</p><ul className="admin-order-list">{rows.map(row => <li key={row.id}><Link href={financialEventDetailPath(row.id)}><span>{row.provider} · {row.type}<small>{row.processedAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</small></span><span>{row.technicalReview ? "Classement audité" : "Examiner →"}</span></Link></li>)}</ul></div>;
}
