import type { Metadata } from "next";
import Link from "next/link";

import { AdminBackLink } from "@/components/admin-back-link";
import { orderIllustrationFormatLabel } from "@/data/order-illustration";
import { adminOrderFilters, listAdminOrders, listAdminPaymentReviewEvents, parseAdminOrderFilter, type AdminOrderFilter } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/session";
import { formatEuro } from "@/lib/orders/domain";
import { orderStatusPresentation } from "@/lib/orders/status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Commandes" };

const filterLabels: Record<AdminOrderFilter, string> = {
  attention: "À examiner",
  active: "En cours",
  pending: "Brouillons / paiement",
  delivered: "Livrées",
  closed: "Annulées / refusées",
  all: "Toutes (audit)",
};

type AdminOrdersPageProps = { searchParams: Promise<{ filtre?: string; etat?: string }> };

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  await requireAdmin();
  const params = await searchParams;
  const filter = parseAdminOrderFilter(params.filtre);
  const [orders, reviewEvents] = await Promise.all([
    listAdminOrders(filter),
    filter === "attention" ? listAdminPaymentReviewEvents() : Promise.resolve([]),
  ]);

  return (
    <div className="admin-main">
      <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
      <header className="admin-page-heading">
        <div><p className="admin-kicker">Commandes</p><h1>Les histoires confiées.</h1></div>
        <p>Les commandes apparaîtront ici selon leur état d’avancement.</p>
      </header>
      {params.etat === "commande-supprimee" ? <p className="admin-feedback" role="status">La commande éligible, sa timeline et ses références privées ont été supprimées.</p> : params.etat === "suppression-invalide" ? <p className="admin-feedback" role="alert">La confirmation de suppression est invalide.</p> : null}

      <nav className="admin-filters" aria-label="Filtrer les commandes">
        {adminOrderFilters.map((value) => (
          <Link key={value} href={value === "attention" ? "/admin/commandes" : `/admin/commandes?filtre=${value}`} aria-current={filter === value ? "page" : undefined}>{filterLabels[value]}</Link>
        ))}
      </nav>

      {reviewEvents.length ? (
        <section className="admin-list-window" aria-labelledby="admin-payment-review-title">
          <div className="admin-list-window__heading"><h2 id="admin-payment-review-title">Paiements à vérifier</h2><span>{reviewEvents.length}</span></div>
          <ul className="admin-order-list">
            {reviewEvents.map((event) => (
              <li key={event.id}>
                {event.payment?.order ? (
                  <Link href={`/admin/commandes/${encodeURIComponent(event.payment.order.orderNumber)}`}>
                    <span className="admin-order-list__identity"><small>{event.processedAt.toLocaleString("fr-FR")}</small><strong>{event.payment.order.title || event.payment.order.recipient || event.payment.order.orderNumber}</strong><em>Paiement à vérifier</em></span>
                    <span className="admin-order-list__next"><small>Événement signé nécessitant une revue</small></span><span className="admin-order-list__arrow" aria-hidden="true">→</span>
                  </Link>
                ) : (
                  <div className="admin-order-list__orphan"><strong>Paiement sans commande corrélée</strong><small>{event.processedAt.toLocaleString("fr-FR")} · revue technique requise</small></div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="admin-list-window" aria-labelledby="admin-order-list-title">
        <div className="admin-list-window__heading"><h2 id="admin-order-list-title">{filterLabels[filter]}</h2><span>{orders.length} résultat{orders.length === 1 ? "" : "s"}</span></div>
        {orders.length ? (
          <ul className="admin-order-list">
            {orders.map((order) => {
              const presentation = orderStatusPresentation[order.status];
              const options = [order.coverIncluded ? `Illustration (${orderIllustrationFormatLabel(order.illustrationFormat)})` : null, order.priorityProcessing ? "Priorité" : null].filter(Boolean).join(" · ") || "Sans option";
              return (
                <li key={order.orderNumber}>
                  <Link href={`/admin/commandes/${encodeURIComponent(order.orderNumber)}`}>
                    <span className="admin-order-list__identity"><small>{order.orderNumber} · {new Date(order.createdAt).toLocaleDateString("fr-FR")}</small><strong>{order.title || order.recipient || "Histoire sans titre"}</strong><em>{order.customerName || order.customerEmail}</em></span>
                    <span className="admin-order-list__facts"><span>{presentation.label}</span><small>{options}</small>{order.payments.length ? <b>Paiement à examiner</b> : order.rightsRequests.length ? <b>Droits à examiner</b> : null}</span>
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
