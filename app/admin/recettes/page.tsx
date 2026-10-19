import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { loadRevenue } from "@/lib/admin/revenue";
import { formatEuro } from "@/lib/orders/domain";
import { AdminRevenueReport } from "@/components/admin-revenue-report";
import "./recettes.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Recettes des ventes directes" };
const labels = { DIGITAL: "Titres et albums numériques", COMMANDER: "Créations musicales", SHOP: "Boutique LNX" };
export default async function RevenuePage({ searchParams }: { searchParams: Promise<{ du?: string; au?: string; mode?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  if (params.mode && !["LIVE", "TEST"].includes(params.mode)) return <main className="admin-main"><h1>Mode invalide</h1><Link href="/admin/recettes">Revenir aux recettes</Link></main>;
  let report;
  try { report = await loadRevenue({ from: params.du, to: params.au, mode: params.mode === "TEST" ? "TEST" : "LIVE" }); }
  catch { return <main className="admin-main"><h1>Récapitulatif indisponible</h1><p>Vérifiez la période (un an maximum). Si le problème persiste, un rapprochement des données est nécessaire. Aucun total partiel n’est présenté.</p><Link href="/admin/recettes">Revenir à l’année courante</Link></main>; }
  return <main className="admin-main revenue-page">
    <header className="admin-page-heading"><div><p className="admin-section-label">Comptabilité · ventes directes</p><h1>Recettes.</h1></div><Link href="/admin/facturation">Factures et avoirs →</Link></header>
    <form className="admin-panel revenue-filters" action="/admin/recettes"><label>Du<input type="date" name="du" defaultValue={report.period.from} required /></label><label>Au<input type="date" name="au" defaultValue={report.period.to} required /></label><label>Environnement<select name="mode" defaultValue={report.mode}><option value="LIVE">Encaissements réels — LIVE</option><option value="TEST">Tests / Sandbox — exclus du réel</option></select></label><button className="admin-button">Afficher</button></form>
    {report.mode === "TEST" ? <p role="status">SIMULATION : ces montants ne sont pas des recettes réelles.</p> : null}
    <section className="revenue-totals" aria-label="Totaux de la période">{[["Encaissé avant frais", report.receivedCents], ["Remboursé confirmé", report.refundedCents], ["Solde après remboursements, avant frais", report.balanceCents]].map(([label, value]) => <article className="admin-panel" key={label}><span>{label}</span><strong>{formatEuro(Number(value))}</strong></article>)}</section>
    <p>Encaissements confirmés sur le site, datés en Europe/Paris. DistroKid, SACEM, soutiens et licences Rights exclus de cette vue. Les ventes LIVE avec votre propre compte restent des encaissements réels. Aucun frais prestataire déduit ; ce n’est pas le solde bancaire ni une déclaration fiscale.</p>
    {report.unmatchedReceipts ? <aside className="admin-panel" role="status"><h2>{report.unmatchedReceipts} reçu{report.unmatchedReceipts > 1 ? "s" : ""} financier{report.unmatchedReceipts > 1 ? "s" : ""} non rapproché{report.unmatchedReceipts > 1 ? "s" : ""}</h2><p>Ces événements ne sont pas additionnés aux ventes : ils pourraient déjà correspondre à un paiement compté ou concerner une autre opération. Le récapitulatif et le CSV couvrent seulement les ventes rapprochées. Faites examiner ces reçus avant de considérer votre rapprochement comptable complet. « J’ai vu » ne prouve pas un remboursement ni un rapprochement.</p><Link href="/admin/evenements-financiers">Examiner le suivi financier →</Link></aside> : null}
    <section className="admin-panel"><h2>Répartition des activités</h2><div className="admin-table-wrap"><table><thead><tr><th>Activité</th><th>Encaissé</th><th>Remboursé</th><th>Solde</th></tr></thead><tbody>{report.categories.map(r => <tr key={r.category}><td>{labels[r.category]}</td><td>{formatEuro(r.receivedCents)}</td><td>{formatEuro(r.refundedCents)}</td><td>{formatEuro(r.balanceCents)}</td></tr>)}</tbody></table></div></section>
    {report.issues.length ? <section className="admin-panel" role="status"><h2>Rapprochements nécessaires — récapitulatif provisoire</h2><p>Des preuves manquent ou des montants doivent être rapprochés. Ne pas utiliser le solde tel quel pour une déclaration.</p><ul>{report.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></section> : null}
    <AdminRevenueReport from={report.period.from} to={report.period.to} mode={report.mode} />
    <section className="admin-panel"><h2>Détail chronologique · {report.rows.length} mouvements</h2><div className="admin-table-wrap" role="region" tabIndex={0} aria-label="Détail des recettes, défilement horizontal"><table><thead><tr><th>Date</th><th>Origine / commande</th><th>Client</th><th>Règlement</th><th>Facture / avoir</th><th>Encaissé</th><th>Remboursé</th></tr></thead><tbody>{report.rows.map(r => <tr key={r.id}><td>{new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }).format(new Date(r.at))}</td><td>{labels[r.category]}<br /><Link href={r.orderHref}>{r.title}</Link><small>{r.order}</small></td><td>{r.customer}</td><td>{r.provider}<small>{r.reference}</small></td><td>{r.documentHref ? <a href={r.documentHref}>{r.invoice}</a> : r.invoice}</td><td>{r.kind === "RECEIPT" ? formatEuro(r.amountCents) : "—"}</td><td>{r.kind === "REFUND" ? formatEuro(r.amountCents) : "—"}</td></tr>)}</tbody></table></div>{!report.rows.length ? <p>Aucun mouvement confirmé dans cette période.</p> : null}</section>
    <p>Généré le {new Date(report.generatedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}. Le récapitulatif aide au rapprochement ; conservez les justificatifs et faites valider le traitement fiscal des corrections et des activités mixtes.</p>
  </main>;
}
