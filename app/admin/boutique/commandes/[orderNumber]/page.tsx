import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { formatShopMoney } from "@/lib/shop/order-presentation";
import { getAdminShopOrder } from "@/lib/shop/order-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Détail commande Boutique" };

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
  PENDING: "En attente",
  PREPARING: "En préparation",
  SHIPPED: "Expédiée",
  CANCELLED: "Annulée",
} as const;

const RESERVATION_STATUS_LABELS = {
  ACTIVE: "Actif",
  CONFIRMED: "Confirmé",
  RELEASED: "Libéré",
  EXPIRED: "Expiré",
} as const;

const EVENT_LABELS = {
  SHOP_ORDER_CREATED: "ShopOrder créée",
  SHOP_ORDER_EXPIRED: "ShopOrder expirée",
  SHOP_ORDER_CANCELLED: "ShopOrder annulée",
  STOCK_RESERVED: "Stock réservé",
  STOCK_CONFIRMED: "Stock confirmé",
  STOCK_RELEASED: "Stock libéré",
  STOCK_RESERVATION_EXPIRED: "Réservation expirée",
} as const;

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

type EventSummary = {
  type: string;
  metadata: unknown;
};

type ItemSummary = {
  productId: string;
  productTitle: string;
};

function metadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function eventDetail(event: EventSummary, items: readonly ItemSummary[]) {
  const metadata = metadataRecord(event.metadata);
  const productId = typeof metadata?.productId === "string" ? metadata.productId : null;
  const productTitle = productId ? items.find((item) => item.productId === productId)?.productTitle : null;
  const quantity = typeof metadata?.quantity === "number" && Number.isSafeInteger(metadata.quantity)
    ? metadata.quantity
    : null;
  if (event.type === "SHOP_ORDER_CREATED") {
    const lineCount = typeof metadata?.lineCount === "number" && Number.isSafeInteger(metadata.lineCount)
      ? metadata.lineCount
      : items.length;
    return `${lineCount} ligne${lineCount === 1 ? "" : "s"} enregistrée${lineCount === 1 ? "" : "s"}.`;
  }
  if (productTitle && quantity !== null) {
    return `${productTitle} · ${quantity} exemplaire${quantity === 1 ? "" : "s"}.`;
  }
  if (event.type === "SHOP_ORDER_EXPIRED" || event.type === "STOCK_RESERVATION_EXPIRED") {
    return "La durée de réservation est arrivée à son terme.";
  }
  if (event.type === "SHOP_ORDER_CANCELLED") return "La commande non payée a été annulée.";
  return "Événement enregistré par le service Boutique.";
}

export default async function AdminShopOrderPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  await requireAdmin();
  const { orderNumber } = await params;
  const order = await getAdminShopOrder(orderNumber);
  if (!order) notFound();

  const itemTitle = order.items.length === 1
    ? order.items[0].productTitle
    : `${order.items.length} produits`;
  const customerName = order.user.displayName?.trim() || "Membre Boutique";

  return (
    <div className="admin-main admin-order-detail">
      <AdminBackLink href="/admin/boutique/commandes">Retour aux commandes Boutique</AdminBackLink>
      <header className="admin-order-hero">
        <div>
          <p className="admin-kicker">{order.orderNumber}</p>
          <h1>{itemTitle}</h1>
          <p>{customerName} · {order.user.email}</p>
        </div>
        <div>
          <span>Statut paiement</span>
          <strong>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</strong>
          <small>Commande {ORDER_STATUS_LABELS[order.status].toLowerCase()} · workflow Boutique Phase 2</small>
        </div>
      </header>

      {order.status === "EXPIRED" ? (
        <p className="admin-alert" role="status">Cette réservation a expiré : elle ne réduit plus la disponibilité. Aucun mouvement de stock physique n’a été nécessaire.</p>
      ) : null}

      <div className="admin-order-detail__grid">
        <div className="admin-order-detail__main">
          <section className="admin-detail-window" aria-labelledby="admin-shop-items-title">
            <p className="admin-section-label">Produits snapshotés</p>
            <h2 id="admin-shop-items-title">Articles et stock réservé.</h2>
            <ul className="admin-card-list">
              {order.items.map((item, index) => (
                <li key={item.productId}>
                  <p className="admin-section-label">Article {index + 1}</p>
                  <h3>{item.productTitle}</h3>
                  <dl className="admin-detail-facts">
                    <div><dt>Quantité</dt><dd>{item.quantity}</dd></div>
                    <div><dt>Prix unitaire</dt><dd>{formatShopMoney(item.unitPriceCents)}</dd></div>
                    <div><dt>Sous-total produit</dt><dd>{formatShopMoney(item.lineTotalCents)}</dd></div>
                    <div><dt>Frais d’envoi</dt><dd>{formatShopMoney(item.lineShippingCents)}</dd></div>
                    <div><dt>Stock suivi</dt><dd>{item.inventoryTracked ? "Oui" : "Non"}</dd></div>
                    <div><dt>Stock réservé</dt><dd>{item.reservation ? `${item.reservation.quantity} · ${RESERVATION_STATUS_LABELS[item.reservation.status]}` : "Aucune réservation quantitative"}</dd></div>
                    {item.reservation ? <div className="admin-detail-facts__wide"><dt>Expiration réservation</dt><dd><time dateTime={item.reservation.expiresAt.toISOString()}>{DATE_FORMAT.format(item.reservation.expiresAt)}</time></dd></div> : null}
                  </dl>
                </li>
              ))}
            </ul>
          </section>

          <section className="admin-detail-window" aria-labelledby="admin-shop-address-title">
            <p className="admin-section-label">Livraison</p>
            <h2 id="admin-shop-address-title">Adresse snapshotée.</h2>
            {order.shippingRequired ? (
              <dl className="admin-detail-facts">
                <div><dt>Prénom</dt><dd>{order.shippingFirstName || "Non renseigné"}</dd></div>
                <div><dt>Nom</dt><dd>{order.shippingLastName || "Non renseigné"}</dd></div>
                <div className="admin-detail-facts__wide"><dt>Adresse</dt><dd>{order.shippingAddressLine1 || "Non renseignée"}</dd></div>
                {order.shippingAddressLine2 ? <div className="admin-detail-facts__wide"><dt>Complément</dt><dd>{order.shippingAddressLine2}</dd></div> : null}
                <div><dt>Code postal</dt><dd>{order.shippingPostalCode || "Non renseigné"}</dd></div>
                <div><dt>Ville</dt><dd>{order.shippingCity || "Non renseignée"}</dd></div>
                <div><dt>Pays</dt><dd>{order.shippingCountryCode || "Non renseigné"}</dd></div>
              </dl>
            ) : <p>Cette commande ne nécessite aucune expédition.</p>}
          </section>

          <section className="admin-detail-window" aria-labelledby="admin-shop-audit-title">
            <p className="admin-section-label">Historique réel</p>
            <h2 id="admin-shop-audit-title">Journal Boutique.</h2>
            {order.events.length ? (
              <ol className="admin-rights-timeline">
                {order.events.map((event) => (
                  <li key={event.id}>
                    <time className="admin-rights-timeline__when" dateTime={event.occurredAt.toISOString()}>{DATE_FORMAT.format(event.occurredAt)}</time>
                    <div className="admin-rights-timeline__content">
                      <strong>{EVENT_LABELS[event.type]}</strong>
                      <p>{eventDetail(event, order.items)}</p>
                    </div>
                    <small className="admin-rights-timeline__actor">{event.actorUserId === order.userId ? `Membre · ${customerName}` : event.actorUserId ? "Utilisateur authentifié" : "Système"}</small>
                  </li>
                ))}
              </ol>
            ) : <p className="admin-alert">Aucun événement Boutique n’est enregistré pour cette commande.</p>}
          </section>
        </div>

        <aside className="admin-order-detail__aside">
          <section className="admin-side-window" aria-labelledby="admin-shop-price-title">
            <p className="admin-section-label">Prix snapshot</p>
            <h2 id="admin-shop-price-title" className="admin-price">{formatShopMoney(order.totalCents)}</h2>
            <dl>
              <div><dt>Sous-total</dt><dd>{formatShopMoney(order.subtotalCents)}</dd></div>
              <div><dt>Envoi</dt><dd>{formatShopMoney(order.shippingCents)}</dd></div>
              <div><dt>Total</dt><dd>{formatShopMoney(order.totalCents)}</dd></div>
              <div><dt>Devise</dt><dd>{order.currency}</dd></div>
            </dl>
            <small>Montants relus depuis PostgreSQL. Aucun prix navigateur ni provider de paiement n’est utilisé ici.</small>
          </section>

          <section className="admin-side-window" aria-labelledby="admin-shop-states-title">
            <p className="admin-section-label">Cycle de vie</p>
            <h2 id="admin-shop-states-title">États enregistrés.</h2>
            <dl>
              <div><dt>Commande</dt><dd>{ORDER_STATUS_LABELS[order.status]}</dd></div>
              <div><dt>Paiement</dt><dd>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</dd></div>
              <div><dt>Préparation</dt><dd>{FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus]}</dd></div>
              <div><dt>Créée</dt><dd><time dateTime={order.createdAt.toISOString()}>{DATE_FORMAT.format(order.createdAt)}</time></dd></div>
              <div><dt>Réservée jusqu’au</dt><dd><time dateTime={order.reservationExpiresAt.toISOString()}>{DATE_FORMAT.format(order.reservationExpiresAt)}</time></dd></div>
              {order.expiredAt ? <div><dt>Expirée</dt><dd><time dateTime={order.expiredAt.toISOString()}>{DATE_FORMAT.format(order.expiredAt)}</time></dd></div> : null}
              {order.cancelledAt ? <div><dt>Annulée</dt><dd><time dateTime={order.cancelledAt.toISOString()}>{DATE_FORMAT.format(order.cancelledAt)}</time></dd></div> : null}
            </dl>
          </section>

          <section className="admin-side-window" aria-labelledby="admin-shop-customer-title">
            <p className="admin-section-label">Client</p>
            <h2 id="admin-shop-customer-title">Compte propriétaire.</h2>
            <dl>
              <div><dt>Nom</dt><dd>{customerName}</dd></div>
              <div><dt>Email</dt><dd>{order.user.email}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
