import type { Metadata } from "next";
import Link from "next/link";
import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { formatEuro } from "@/lib/orders/domain";
import { isSupportEnabled } from "@/lib/support/config";
import { listAdminSupportContributions } from "@/lib/support/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Soutiens libres", robots: { index: false, follow: false } };

export default async function AdminSupportPage() {
  await requireAdmin();
  const entries = await listAdminSupportContributions();
  const confirmed = entries.filter((entry) => entry.status === "SUCCEEDED").reduce((total, entry) => total + entry.amountCents, 0);
  const refunded = entries.filter((entry) => entry.status === "REFUNDED").reduce((total, entry) => total + entry.amountCents, 0);
  return <main className="admin-main">
    <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-section-label">Clients & documents</p><h1>Soutiens libres.</h1></div><p>Registre séparé des commandes, factures et droits. Aucun reçu fiscal ni avantage associé.</p></header>
    <section className="admin-panel"><p>{isSupportEnabled() ? "Préversion active — paiements TEST uniquement." : "Collecte désactivée. L’historique reste consultable."}</p><p>Les écritures TEST ne constituent pas des encaissements réels. La qualification comptable définitive relève de votre conseil comptable.</p><a className="admin-button admin-button--secondary" href="/api/admin/support/export">Exporter le registre CSV</a></section>
    <section className="admin-panel"><div className="admin-panel__heading"><p className="admin-section-label">Registre récent</p><h2>{entries.length} soutien{entries.length === 1 ? "" : "s"}</h2></div>
      <p>Vue bornée aux 200 derniers soutiens. Les exports détaillent les montants bruts et leur statut, sans inventer les frais nets du prestataire.</p>
      <p>Totaux de cette vue TEST : confirmés non remboursés {formatEuro(confirmed)} · remboursés {formatEuro(refunded)}. Les opérations en attente ou à vérifier ne sont pas comptées comme confirmées.</p>
      {entries.length ? <ul className="admin-record-list">{entries.map((entry) => <li key={entry.id} className="admin-panel">
        <div><strong>{formatEuro(entry.amountCents)}</strong> · {entry.provider} · {entry.status} · TEST</div>
        <p>{entry.createdAt.toLocaleString("fr-FR")}<br />Référence : {entry.providerReference ?? "En préparation"}</p>
        <Link className="admin-button admin-button--secondary" href={`/admin/soutiens/${entry.id}`}>Voir le soutien et l’audit</Link>
      </li>)}</ul> : <p className="admin-empty-state">Aucun soutien enregistré.</p>}
    </section>
  </main>;
}
