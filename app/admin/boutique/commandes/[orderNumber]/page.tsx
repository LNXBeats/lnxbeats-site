import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  markShopOrderPreparingAction,
  markShopOrderShippedAction,
} from "@/app/admin/boutique/actions";
import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import {
  formatShopMoney,
  shopPaymentAttemptPresentation,
  shopPaymentIncidentLabel,
} from "@/lib/shop/order-presentation";
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
  SHOP_TERMS_ACCEPTED: "Conditions de vente acceptées",
  SHOP_PAYMENT_PROCESSING: "Paiement Boutique initié",
  SHOP_PAYMENT_CONFIRMED: "Paiement Boutique confirmé",
  SHOP_PAYMENT_FAILED: "Tentative de paiement échouée",
  SHOP_PAYMENT_REQUIRES_REVIEW: "Paiement Boutique à vérifier",
  PREPARATION_STARTED: "Préparation démarrée",
  ORDER_SHIPPED: "Commande expédiée",
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
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ etat?: string }>;
}) {
  await requireAdmin();
  const { orderNumber } = await params;
  const order = await getAdminShopOrder(orderNumber);
  if (!order) notFound();
  const state = (await searchParams).etat;

  const itemTitle = order.items.length === 1
    ? order.items[0].productTitle
    : `${order.items.length} produits`;
  const customerName = order.user.displayName?.trim() || "Membre Boutique";
  const financialPayment = order.payments.find(({ status }) => [
    "SUCCEEDED",
    "REFUND_PENDING",
    "PARTIALLY_REFUNDED",
    "REFUNDED",
  ].includes(status)) ?? order.payments.find(({ status }) => status === "REQUIRES_REVIEW") ?? null;
  const paymentProvider = financialPayment?.provider === "STRIPE"
    ? "Carte bancaire / Apple Pay"
    : financialPayment?.provider === "PAYPAL"
      ? "PayPal"
      : "Non confirmé";
  const auditEvents = [...order.events, ...order.lifecycleEvents]
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id.localeCompare(right.id));

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
          <strong>{order.paymentReviewAt ? "À vérifier" : PAYMENT_STATUS_LABELS[order.paymentStatus]}</strong>
          <small>Commande {ORDER_STATUS_LABELS[order.status].toLowerCase()} · workflow Boutique</small>
        </div>
      </header>

      {state === "preparation-demarree" ? <p className="admin-alert" role="status">La préparation de cette commande a commencé.</p> : null}
      {state === "commande-expediee" ? <p className="admin-alert" role="status">La commande est marquée expédiée.</p> : null}

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
                    <div><dt>Frais d’envoi</dt><dd>{item.shippingRequired && order.shippingQuoteVersion ? "Devis groupé" : formatShopMoney(item.lineShippingCents)}</dd></div>
                    {item.lineShippingWeightGrams ? <div><dt>Poids logistique</dt><dd>{item.lineShippingWeightGrams} g</dd></div> : null}
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
                {order.shippingQuoteVersion ? <div><dt>Version devis</dt><dd>{order.shippingQuoteVersion}</dd></div> : null}
                {order.shippingMethod ? <div><dt>Service interne</dt><dd>{order.shippingMethod}</dd></div> : null}
                {order.shippingWeightGrams ? <div><dt>Poids produits</dt><dd>{order.shippingWeightGrams} g</dd></div> : null}
                {order.shippingBillableGrams ? <div><dt>Poids facturable</dt><dd>{order.shippingBillableGrams} g</dd></div> : null}
              </dl>
            ) : <p>Cette commande ne nécessite aucune expédition.</p>}
          </section>

          <section className="admin-detail-window" aria-labelledby="admin-shop-audit-title">
            <p className="admin-section-label">Historique réel</p>
            <h2 id="admin-shop-audit-title">Journal Boutique.</h2>
            {auditEvents.length ? (
              <ol className="admin-rights-timeline">
                {auditEvents.map((event) => (
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
              {order.preparingAt ? <div><dt>Préparation démarrée</dt><dd><time dateTime={order.preparingAt.toISOString()}>{DATE_FORMAT.format(order.preparingAt)}</time></dd></div> : null}
              {order.shippedAt ? <div><dt>Expédiée</dt><dd><time dateTime={order.shippedAt.toISOString()}>{DATE_FORMAT.format(order.shippedAt)}</time></dd></div> : null}
            </dl>
          </section>

          <section className="admin-side-window" aria-labelledby="admin-shop-payment-title">
            <p className="admin-section-label">Paiement</p>
            <h2 id="admin-shop-payment-title">Preuve financière.</h2>
            <dl>
              <div><dt>Moyen</dt><dd>{paymentProvider}</dd></div>
              <div><dt>Statut</dt><dd>{order.paymentReviewAt ? "À vérifier" : PAYMENT_STATUS_LABELS[order.paymentStatus]}</dd></div>
              <div><dt>Montant</dt><dd>{financialPayment ? formatShopMoney(financialPayment.amountCents) : formatShopMoney(order.totalCents)}</dd></div>
              {financialPayment?.paidAt ? <div><dt>Confirmé</dt><dd><time dateTime={financialPayment.paidAt.toISOString()}>{DATE_FORMAT.format(financialPayment.paidAt)}</time></dd></div> : null}
              {order.paymentReviewAt ? <div><dt>Incident</dt><dd>{shopPaymentIncidentLabel(order.paymentReviewCode)}</dd></div> : null}
              {order.termsVersion ? <div><dt>Conditions acceptées</dt><dd>{order.termsVersion}</dd></div> : null}
            </dl>
            <small>Aucun identifiant provider ni payload brut n’est exposé dans cette interface.</small>
          </section>

          <section className="admin-side-window" aria-labelledby="admin-shop-payment-attempts-title">
            <p className="admin-section-label">Tentatives financières</p>
            <h2 id="admin-shop-payment-attempts-title">Tous les moyens sollicités.</h2>
            {order.payments.length ? (
              <ol className="admin-card-list">
                {order.payments.map((payment, index) => {
                  const presentation = shopPaymentAttemptPresentation(payment);
                  return (
                    <li key={payment.id}>
                      <p className="admin-section-label">Tentative {index + 1}</p>
                      <h3>{presentation.providerLabel}</h3>
                      <dl className="admin-detail-facts">
                        <div><dt>Statut</dt><dd>{presentation.statusLabel}</dd></div>
                        <div><dt>Montant</dt><dd>{formatShopMoney(payment.amountCents)}</dd></div>
                        <div className="admin-detail-facts__wide"><dt>{presentation.dateLabel}</dt><dd><time dateTime={presentation.date.toISOString()}>{DATE_FORMAT.format(presentation.date)}</time></dd></div>
                        {presentation.incidentLabel ? <div className="admin-detail-facts__wide"><dt>Incident</dt><dd>{presentation.incidentLabel}</dd></div> : null}
                      </dl>
                    </li>
                  );
                })}
              </ol>
            ) : <p>Aucune tentative de paiement enregistrée.</p>}
            <small>Les références techniques et payloads provider restent masqués.</small>
          </section>

          {order.status === "OPEN" && order.paymentStatus === "PAID" && !order.paymentReviewAt && order.fulfillmentStatus === "PENDING" ? (
            <section className="admin-side-window" aria-labelledby="admin-shop-preparing-title">
              <p className="admin-section-label">Fulfillment</p>
              <h2 id="admin-shop-preparing-title">Commencer la préparation.</h2>
              <p>Cette action est disponible uniquement après paiement confirmé.</p>
              <form action={markShopOrderPreparingAction}>
                <input type="hidden" name="orderNumber" value={order.orderNumber} />
                <label className="admin-check">
                  <input type="checkbox" name="confirmation" value="CONFIRM_SHOP_PREPARATION" required />
                  Je confirme le démarrage de la préparation.
                </label>
                <button className="admin-button" type="submit">MARQUER EN PRÉPARATION</button>
              </form>
            </section>
          ) : null}

          {order.status === "OPEN" && order.paymentStatus === "PAID" && !order.paymentReviewAt && order.fulfillmentStatus === "PREPARING" ? (
            <section className="admin-side-window" aria-labelledby="admin-shop-shipped-title">
              <p className="admin-section-label">Fulfillment</p>
              <h2 id="admin-shop-shipped-title">Marquer expédiée.</h2>
              <form action={markShopOrderShippedAction}>
                <input type="hidden" name="orderNumber" value={order.orderNumber} />
                <label>Transporteur (facultatif)<input name="carrier" maxLength={120} /></label>
                <label>Numéro de suivi (facultatif)<input name="trackingNumber" maxLength={160} /></label>
                <label>URL de suivi HTTPS (facultative)<input name="trackingUrl" type="url" maxLength={500} /></label>
                <label className="admin-check">
                  <input type="checkbox" name="confirmation" value="CONFIRM_SHOP_SHIPMENT" required />
                  Je confirme que cette commande a été expédiée.
                </label>
                <button className="admin-button" type="submit">MARQUER EXPÉDIÉE</button>
              </form>
            </section>
          ) : null}

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
