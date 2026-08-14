import type { Metadata } from "next";
import Link from "next/link";

import { adminOrderFilters, listAdminOrders, parseAdminOrderFilter, type AdminOrderFilter } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/session";
import { formatEuro } from "@/lib/orders/domain";
import { orderStatusPresentation } from "@/lib/orders/status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Commandes" };

const filterLabels: Record<AdminOrderFilter, string> = {
  all: "Toutes",
  attention: "À examiner",
  active: "En cours",
  delivered: "Livrées",
  closed: "Annulées / refusées",
};

type AdminOrdersPageProps = { searchParams: Promise<{ filtre?: string; etat?: string }> };

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  await requireAdmin();
  const params = await searchParams;
  const filter = parseAdminOrderFilter(params.filtre);
  const orders = await listAdminOrders(filter);

  return (
    <div className="admin-main">
      <header className="admin-page-heading">
        <div><p className="admin-kicker">Commandes</p><h1>Les histoires confiées.</h1></div>
        <p>Les commandes apparaîtront ici selon leur état d’avancement.</p>
      </header>
      {params.etat === "commande-supprimee" ? <p className="admin-feedback" role="status">La commande éligible, sa timeline et ses références privées ont été supprimées.</p> : params.etat === "suppression-invalide" ? <p className="admin-feedback" role="alert">La confirmation de suppression est invalide.</p> : null}

      <nav className="admin-filters" aria-label="Filtrer les commandes">
        {adminOrderFilters.map((value) => (
          <Link key={value} href={value === "all" ? "/admin/commandes" : `/admin/commandes?filtre=${value}`} aria-current={filter === value ? "page" : undefined}>{filterLabels[value]}</Link>
        ))}
      </nav>

      <section className="admin-list-window" aria-labelledby="admin-order-list-title">
        <div className="admin-list-window__heading"><h2 id="admin-order-list-title">{filterLabels[filter]}</h2><span>{orders.length} résultat{orders.length === 1 ? "" : "s"}</span></div>
        {orders.length ? (
          <ul className="admin-order-list">
            {orders.map((order) => {
              const presentation = orderStatusPresentation[order.status];
              const options = [order.coverIncluded ? "Cover" : null, order.priorityProcessing ? "Priorité" : null].filter(Boolean).join(" · ") || "Sans option";
              return (
                <li key={order.orderNumber}>
                  <Link href={`/admin/commandes/${encodeURIComponent(order.orderNumber)}`}>
                    <span className="admin-order-list__identity"><small>{order.orderNumber} · {new Date(order.createdAt).toLocaleDateString("fr-FR")}</small><strong>{order.title || order.recipient || "Histoire sans titre"}</strong><em>{order.customerName || order.customerEmail}</em></span>
                    <span className="admin-order-list__facts"><span>{presentation.label}</span><small>{options}</small>{order.payments.length ? <b>Paiement à examiner</b> : order.commercialLicenses.length ? <b>Droits à examiner</b> : null}</span>
                    <span className="admin-order-list__next"><strong>{formatEuro(order.totalCents)}</strong><small>{presentation.next}</small></span>
                    <span className="admin-order-list__arrow" aria-hidden="true">→</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : <div className="admin-empty"><h2>Aucune commande dans cette vue.</h2><p>Aucune commande ne correspond actuellement à ce filtre.</p></div>}
      </section>
    </div>
  );
}
