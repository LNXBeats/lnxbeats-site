import type { Metadata } from "next";
import Link from "next/link";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { formatShopMoney } from "@/lib/shop/order-presentation";
import { listAdminShopOrders } from "@/lib/shop/order-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Commandes Boutique · Administration" };

type ShopOrderFilter = "OPEN" | "EXPIRED" | "CANCELLED";

const FILTERS = [
  { value: "all", label: "Toutes" },
  { value: "OPEN", label: "Ouvertes" },
  { value: "EXPIRED", label: "Expirées" },
  { value: "CANCELLED", label: "Annulées" },
] as const;

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
  SHIPPED: "Expédiée",
  CANCELLED: "Préparation annulée",
} as const;

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

function shopOrderFilter(value: string | undefined): ShopOrderFilter | undefined {
  return value === "OPEN" || value === "EXPIRED" || value === "CANCELLED" ? value : undefined;
}

export default async function AdminShopOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  await requireAdmin();
  const requestedFilter = (await searchParams).statut;
  const filter = shopOrderFilter(requestedFilter);
  const selectedFilter = filter ?? "all";
  const orders = await listAdminShopOrders(filter);

  return (
    <div className="admin-main">
      <AdminBackLink href="/admin/boutique">Retour aux produits</AdminBackLink>
      <header className="admin-page-heading">
        <div>
          <p className="admin-kicker">Boutique · commandes</p>
          <h1>Les achats préparés.</h1>
        </div>
        <p>Les ShopOrders restent séparées des commandes de créations. Cette vue est en lecture seule et ne déclenche aucun paiement.</p>
      </header>

      <nav className="admin-filters" aria-label="Filtrer les commandes Boutique">
        {FILTERS.map(({ value, label }) => {
          const href = value === "all" ? "/admin/boutique/commandes" : `/admin/boutique/commandes?statut=${value}`;
          return <Link key={value} href={href} aria-current={selectedFilter === value ? "page" : undefined}>{label}</Link>;
        })}
      </nav>

      <section className="admin-list-window" aria-labelledby="admin-shop-orders-title">
        <div className="admin-list-window__heading">
          <h2 id="admin-shop-orders-title">Commandes Boutique</h2>
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
                    <small>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</small>
                    <b>{FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus]}</b>
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
