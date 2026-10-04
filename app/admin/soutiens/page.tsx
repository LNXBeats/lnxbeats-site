import type { Metadata } from "next";
import Link from "next/link";
import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { formatEuro } from "@/lib/orders/domain";
import { isSupportEnabled } from "@/lib/support/config";
import { listAdminSupportContributions } from "@/lib/support/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Soutiens libres", robots: { index: false, follow: false } };

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ mode?: string; cursor?: string }> }) {
  await requireAdmin();
  const query = await searchParams;
  const mode = query.mode === "LIVE" ? "LIVE" : "TEST";
  const entries = await listAdminSupportContributions(200, mode, query.cursor);
  const confirmed = entries.filter((entry) => entry.status === "SUCCEEDED").reduce((total, entry) => total + entry.amountCents, 0);
  const refunded = entries.filter((entry) => entry.status === "REFUNDED").reduce((total, entry) => total + entry.amountCents, 0);
  return <main className="admin-main">
    <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-section-label">Clients & documents</p><h1>Soutiens libres.</h1></div><p>Registre séparé des commandes, factures et droits. Aucun reçu fiscal ni avantage associé.</p></header>
    <section className="admin-panel"><p>{isSupportEnabled() ? "Préversion active — paiements TEST uniquement." : "Collecte désactivée. L’historique reste consultable."}</p><p>Les écritures TEST ne constituent pas des encaissements réels.</p><nav aria-label="Mode du registre"><Link href="/admin/soutiens?mode=TEST">TEST</Link>{" · "}<Link href="/admin/soutiens?mode=LIVE">LIVE</Link></nav><a className="admin-button admin-button--secondary" href={`/api/admin/support/export?mode=${mode}`}>Exporter tout le registre {mode} CSV</a></section>
    <section className="admin-panel"><div className="admin-panel__heading"><p className="admin-section-label">Registre récent</p><h2>{entries.length} soutien{entries.length === 1 ? "" : "s"}</h2></div>
      <p>Page de 200 écritures maximum, ordonnée par identifiant. Export complet séparé par mode. Frais et net non connus restent vides.</p>
      <p>Totaux de cette page {mode} : confirmés non remboursés {formatEuro(confirmed)} · remboursés {formatEuro(refunded)}. Les opérations en attente ou à vérifier ne sont pas comptées comme confirmées.</p>
      {entries.length ? <ul className="admin-record-list">{entries.map((entry) => <li key={entry.id} className="admin-panel">
        <div><strong>{formatEuro(entry.amountCents)}</strong> · {entry.provider} · {entry.status} · {entry.mode}</div>
        <p>{entry.createdAt.toLocaleString("fr-FR")}<br />Référence : {entry.providerReference ?? "En préparation"}</p>
        <Link className="admin-button admin-button--secondary" href={`/admin/soutiens/${entry.id}`}>Voir le soutien et l’audit</Link>
      </li>)}</ul> : <p className="admin-empty-state">Aucun soutien enregistré.</p>}
      {entries.length === 200 ? <Link href={`/admin/soutiens?mode=${mode}&cursor=${entries.at(-1)!.id}`}>Page suivante</Link> : null}
    </section>
  </main>;
}
