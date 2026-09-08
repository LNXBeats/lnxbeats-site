import type { Metadata } from "next";
import Link from "next/link";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { formatShopMoney } from "@/lib/shop/order-presentation";
import {
  adminShopOrderFilters,
  listAdminShopOrders,
  parseAdminShopOrderFilter,
  type AdminShopOrderFilter,
} from "@/lib/shop/order-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Commandes Boutique · Administration" };

const FILTER_LABELS: Record<AdminShopOrderFilter, string> = {
  attention: "À traiter",
  active: "En préparation",
  pending: "Paiement en attente",
  completed: "Terminées",
  archives: "Archivées",
  all: "Toutes (audit)",
};

const ORDER_STATUS_LABELS = {
  OPEN: "Ouverte",
  EXPIRED: "Expirée",
  CANCELLED: "Annulée",
} as const;

const PAYMENT_STATUS_LABELS = {
  AWAITING_PAYMENT: "En attente de paiement",
  PAID: "Payé",
  CANCELLED: "Annulé",
} as const;

const FULFILLMENT_STATUS_LABELS = {
  PENDING: "Préparation en attente",
  PREPARING: "En préparation",
  READY_TO_SHIP: "Prête à expédier",
  SHIPPED: "Expédiée",
  CANCELLED: "Préparation annulée",
} as const;

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

export default async function AdminShopOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ filtre?: string; statut?: string; etat?: string }>;
}) {
  await requireAdmin();
  const query = await searchParams;
  const filter = parseAdminShopOrderFilter(query.filtre ?? query.statut);
  const orders = await listAdminShopOrders(filter);

  return (
    <div className="admin-main">
      <AdminBackLink href="/admin/boutique">Retour aux produits</AdminBackLink>
      <header className="admin-page-heading">
        <div>
          <p className="admin-kicker">Boutique · commandes</p>
          <h1>Les achats préparés.</h1>
        </div>
        <p>Les ShopOrders restent séparées des commandes de créations. Les actions de préparation sont disponibles uniquement après confirmation financière.</p>
      </header>

      {query.etat === "transition-refusee" ? <p className="admin-alert" role="alert">La transition demandée a été refusée par les règles de paiement ou de fulfillment.</p> : null}

      <nav className="admin-filters" aria-label="Filtrer les commandes Boutique">
        {adminShopOrderFilters.map((value) => {
          const href = value === "attention" ? "/admin/boutique/commandes" : `/admin/boutique/commandes?filtre=${value}`;
          return <Link key={value} href={href} aria-current={filter === value ? "page" : undefined}>{FILTER_LABELS[value]}</Link>;
        })}
      </nav>

      <section className="admin-list-window" aria-labelledby="admin-shop-orders-title">
        <div className="admin-list-window__heading">
          <h2 id="admin-shop-orders-title">{FILTER_LABELS[filter]}</h2>
          <span>{orders.length} résultat{orders.length === 1 ? "" : "s"}</span>
        </div>
        {orders.length ? (
          <ul className="admin-order-list">
            {orders.map((order) => (
              <li key={order.id}>
                <Link href={`/admin/boutique/commandes/${encodeURIComponent(order.orderNumber)}`}>
                  <span className="admin-order-list__identity">
                    <small><time dateTime={order.createdAt.toISOString()}>{DATE_FORMAT.format(order.createdAt)}</time></small>
                    <strong>{order.orderNumber}</strong>
                    <em>{order._count.items} article{order._count.items === 1 ? "" : "s"}</em>
                  </span>
                  <span className="admin-order-list__facts">
                    <span>{ORDER_STATUS_LABELS[order.status]}</span>
                    <small>{order.paymentReviewAt ? "Paiement à vérifier" : PAYMENT_STATUS_LABELS[order.paymentStatus]}</small>
                    <b>{order.operation?.label ?? FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus]}</b>
                  </span>
                  <span className="admin-order-list__next">
                    <strong>{formatShopMoney(order.totalCents)}</strong>
                    <small>Réservation jusqu’au {DATE_FORMAT.format(order.reservationExpiresAt)}</small>
                  </span>
                  <span className="admin-order-list__arrow" aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="admin-empty">
            <h2>Aucune commande dans cette vue.</h2>
            <p>Aucune ShopOrder ne correspond actuellement à ce filtre.</p>
          </div>
        )}
      </section>
    </div>
  );
}
