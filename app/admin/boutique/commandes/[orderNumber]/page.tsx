import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  createShopShippingProviderAttemptAction,
  decideShopCustomerRequestAction,
  reconcileShopCustomerRequestRefundAction,
  markShopOrderPreparingAction,
  markShopOrderReadyAction,
  markShopOrderShippedAction,
  reconcileShopShippingProviderAttemptAction,
  recordShopOrderTrackingAction,
} from "@/app/admin/boutique/actions";
import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import {
  formatShopMoney,
  shopPaymentAttemptPresentation,
  shopPaymentIncidentLabel,
  shopShippingMethodLabel,
  shopTrackingSourceLabel,
} from "@/lib/shop/order-presentation";
import { getAdminShopOrder } from "@/lib/shop/order-service";
import { shopShippingProviderQaEnabled } from "@/lib/shop/shipping-provider-config";
import {
  SHOP_CUSTOMER_REQUEST_APPROVAL,
  SHOP_CUSTOMER_REQUEST_REFUND_RECONCILIATION,
  SHOP_CUSTOMER_REQUEST_REJECTION,
} from "@/lib/shop/customer-request-domain";

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
  READY_TO_SHIP: "Prête à expédier",
  SHIPPED: "Expédiée",
  CANCELLED: "Annulée",
} as const;

const SHIPPING_PROVIDER_STATUS_LABELS = {
  REQUESTED: "Demande enregistrée",
  PENDING: "En attente de réconciliation",
  SUCCEEDED: "Résultat fictif obtenu",
  FAILED: "Échec fictif confirmé",
  REQUIRES_REVIEW: "Revue humaine requise",
} as const;

const SHIPPING_PROVIDER_SCENARIO_LABELS = {
  SUCCEEDED: "Succès déterministe",
  PENDING: "Attente puis réconciliation",
  FAILED: "Échec déterministe",
  AMBIGUOUS: "Acceptation ambiguë",
} as const;

const SHIPPING_PROVIDER_ERROR_LABELS: Record<string, string> = {
  FAKE_LOCAL_REQUEST_REJECTED: "La demande fictive a été refusée.",
  AMBIGUOUS_PROVIDER_ACCEPTANCE: "Le résultat fictif est ambigu : aucune hypothèse de succès n’est autorisée.",
  MANUAL_TRACKING_CONFLICT: "Un suivi manuel est déjà actif. Il reste prioritaire et n’a pas été écrasé.",
  ACTIVE_PROVIDER_TRACKING_CONFLICT: "Un autre suivi provider est actif. Une revue humaine est nécessaire.",
  PROVIDER_RESPONSE_UNCERTAIN: "La réponse provider est incertaine. Une revue humaine est nécessaire.",
  ORDER_ALREADY_SHIPPED: "La remise physique a gagné la course. Le résultat provider est conservé pour revue sans modifier le suivi actif.",
};

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
  SHIPMENT_READY: "Expédition prête",
  TRACKING_RECORDED: "Suivi enregistré",
  SHIPPING_PROVIDER_REQUESTED: "Demande provider QA enregistrée",
  SHIPPING_PROVIDER_RECONCILED: "Provider transporteur QA réconcilié",
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
  if (event.type === "PREPARATION_STARTED") return "L’atelier a commencé la préparation de la commande.";
  if (event.type === "SHIPMENT_READY") return "Le colis est prêt pour sa remise au transporteur.";
  if (event.type === "TRACKING_RECORDED") {
    return metadata?.source === "PROVIDER"
      ? "Le suivi fictif confirmé par le provider QA a été adopté avant expédition."
      : "Un suivi manuel a été enregistré ou corrigé avant expédition.";
  }
  if (event.type === "SHIPPING_PROVIDER_REQUESTED") return "Une intention unique a été enregistrée pour le provider transporteur fictif QA.";
  if (event.type === "SHIPPING_PROVIDER_RECONCILED") return "Le résultat fictif a été persisté sans confirmer la remise physique du colis.";
  if (event.type === "ORDER_SHIPPED") return "LNX Beats a enregistré la remise du colis au transporteur ; cela ne confirme pas sa livraison.";
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
  const providerQaEnabled = shopShippingProviderQaEnabled();
  const latestProviderAttempt = order.shippingProviderAttempts[0] ?? null;

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
  const cancellationProvider = financialPayment?.provider ?? "PROVIDER NON CONFIRMÉ";
  const cancellationAmountCents = financialPayment?.amountCents ?? order.totalCents;
  const expectedCancellationRestockUnits = order.items.reduce(
    (total, item) => total + (
      item.inventoryTracked && item.reservation?.status === "CONFIRMED"
        ? item.quantity
        : 0
    ),
    0,
  );
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
      {state === "expedition-prete" ? <p className="admin-alert" role="status">Le colis est prêt à être remis au transporteur.</p> : null}
      {state === "suivi-enregistre" ? <p className="admin-alert" role="status">Le suivi manuel a été enregistré.</p> : null}
      {state === "commande-expediee" ? <p className="admin-alert" role="status">La commande est marquée expédiée.</p> : null}
      {state === "provider-qa-enregistre" ? <p className="admin-alert" role="status">Le résultat du provider transporteur fictif QA a été enregistré.</p> : null}
      {state === "provider-qa-reconcilie" ? <p className="admin-alert" role="status">La tentative provider fictive QA a été réconciliée.</p> : null}

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
                {order.shippingMethod ? <div><dt>Mode d’expédition</dt><dd>{shopShippingMethodLabel(order.shippingMethod)}</dd></div> : null}
                {order.shippingWeightGrams ? <div><dt>Poids produits</dt><dd>{order.shippingWeightGrams} g</dd></div> : null}
                {order.shippingBillableGrams ? <div><dt>Poids facturable</dt><dd>{order.shippingBillableGrams} g</dd></div> : null}
              </dl>
            ) : <p>Cette commande ne nécessite aucune expédition.</p>}
          </section>

          <section className="admin-detail-window" aria-labelledby="admin-shop-shipment-title">
            <p className="admin-section-label">Expédition opérationnelle</p>
            <h2 id="admin-shop-shipment-title">Snapshots et suivi.</h2>
            <dl className="admin-detail-facts">
              <div><dt>État</dt><dd>{FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus]}</dd></div>
              <div><dt>Mode</dt><dd>{shopShippingMethodLabel(order.shippingMethod)}</dd></div>
              {order.shippingCarrier ? <div><dt>Transporteur</dt><dd>{order.shippingCarrier}</dd></div> : null}
              {order.trackingNumber ? <div><dt>Numéro de suivi</dt><dd>{order.trackingNumber}</dd></div> : null}
              {order.trackingSource ? <div><dt>Source du suivi</dt><dd>{shopTrackingSourceLabel(order.trackingSource)}</dd></div> : null}
              {order.trackingRecordedAt ? <div><dt>Suivi enregistré</dt><dd><time dateTime={order.trackingRecordedAt.toISOString()}>{DATE_FORMAT.format(order.trackingRecordedAt)}</time></dd></div> : null}
              {order.trackingUrl ? <div className="admin-detail-facts__wide"><dt>Lien de suivi</dt><dd><a className="admin-inline-link" href={order.trackingUrl} target="_blank" rel="noopener noreferrer">Ouvrir le suivi</a></dd></div> : null}
            </dl>
            {!order.trackingNumber ? <p className="admin-alert">Aucun suivi n’est encore enregistré.</p> : null}
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
              {order.readyToShipAt ? <div><dt>Prête à expédier</dt><dd><time dateTime={order.readyToShipAt.toISOString()}>{DATE_FORMAT.format(order.readyToShipAt)}</time></dd></div> : null}
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
                      <dl className="admin-detail-facts admin-payment-attempt-facts">
                        <div className="admin-payment-attempt-facts__compact"><dt>Statut</dt><dd>{presentation.statusLabel}</dd></div>
                        <div className="admin-payment-attempt-facts__compact"><dt>Montant</dt><dd>{formatShopMoney(payment.amountCents)}</dd></div>
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
            <section className="admin-side-window" aria-labelledby="admin-shop-ready-title">
              <p className="admin-section-label">Fulfillment</p>
              <h2 id="admin-shop-ready-title">Déclarer le colis prêt.</h2>
              <p>Cette étape termine la préparation interne sans déclarer le colis expédié.</p>
              <form action={markShopOrderReadyAction}>
                <input type="hidden" name="orderNumber" value={order.orderNumber} />
                <label className="admin-check">
                  <input type="checkbox" name="confirmation" value="CONFIRM_SHOP_READY_TO_SHIP" required />
                  Je confirme que le colis est prêt à être remis au transporteur.
                </label>
                <button className="admin-button" type="submit">MARQUER PRÊTE À EXPÉDIER</button>
              </form>
            </section>
          ) : null}

          {providerQaEnabled && order.status === "OPEN" && order.paymentStatus === "PAID" && !order.paymentReviewAt && (order.fulfillmentStatus === "READY_TO_SHIP" || latestProviderAttempt) ? (
            <section className="admin-side-window admin-shipping-provider-qa" aria-labelledby="admin-shop-provider-title">
              <p className="admin-section-label">Provider transporteur — QA</p>
              <h2 id="admin-shop-provider-title">Simulation locale sans affranchissement.</h2>
              <p>Provider déterministe fictif. Aucun réseau, achat, bordereau postal réel ou remise physique au transporteur.</p>
              {latestProviderAttempt ? (
                <div className="admin-payment-attempt-card">
                  <dl className="admin-detail-facts admin-shipping-provider-facts">
                    <div><dt>Statut QA</dt><dd>{SHIPPING_PROVIDER_STATUS_LABELS[latestProviderAttempt.status]}</dd></div>
                    <div><dt>Scénario</dt><dd>{SHIPPING_PROVIDER_SCENARIO_LABELS[latestProviderAttempt.scenario]}</dd></div>
                    <div><dt>Tentative logique</dt><dd>#{latestProviderAttempt.attemptNumber}</dd></div>
                    <div><dt>Réconciliations</dt><dd>{latestProviderAttempt.reconciliationCount}</dd></div>
                    {latestProviderAttempt.providerShipmentId ? <div className="admin-detail-facts__wide admin-shipping-provider-facts__identifier"><dt>Identifiant fictif interne</dt><dd>{latestProviderAttempt.providerShipmentId}</dd></div> : null}
                    {latestProviderAttempt.trackingNumber ? <div className="admin-detail-facts__wide admin-shipping-provider-facts__identifier"><dt>Suivi fictif reçu</dt><dd>{latestProviderAttempt.trackingNumber}</dd></div> : null}
                    {latestProviderAttempt.errorCode ? <div className="admin-detail-facts__wide"><dt>Décision sûre</dt><dd>{SHIPPING_PROVIDER_ERROR_LABELS[latestProviderAttempt.errorCode] ?? "Résultat technique à examiner."}</dd></div> : null}
                  </dl>
                  <small>La clé d’idempotence reste persistée côté serveur. Aucun secret ni payload provider brut n’est conservé.</small>
                  {latestProviderAttempt.status === "REQUESTED" || latestProviderAttempt.status === "PENDING" ? (
                    <form action={reconcileShopShippingProviderAttemptAction}>
                      <input type="hidden" name="orderNumber" value={order.orderNumber} />
                      <input type="hidden" name="attemptId" value={latestProviderAttempt.id} />
                      <label className="admin-check">
                        <input type="checkbox" name="confirmation" value="CONFIRM_FAKE_SHIPPING_PROVIDER_RECONCILIATION_QA" required />
                        Je confirme la réconciliation du provider transporteur fictif QA.
                      </label>
                      <button className="admin-button admin-button--secondary" type="submit">RÉCONCILIER LA TENTATIVE QA</button>
                    </form>
                  ) : null}
                  {latestProviderAttempt.status === "REQUIRES_REVIEW" ? (
                    <p className="admin-alert" role="status">Aucune nouvelle tentative automatique : une vérification humaine serait obligatoire avec un vrai provider.</p>
                  ) : null}
                  {latestProviderAttempt.status === "SUCCEEDED" ? (
                    <p className="admin-alert">{order.fulfillmentStatus === "SHIPPED"
                      ? "La confirmation physique distincte a depuis marqué la commande expédiée ; le succès provider ne l’avait pas fait."
                      : "Le suivi est disponible, mais la commande reste prête à expédier jusqu’à la confirmation physique distincte."}</p>
                  ) : null}
                  {latestProviderAttempt.status === "FAILED" ? (
                    <p className="admin-alert">Échec final de cette intention QA. Aucun retry automatique n’est autorisé.</p>
                  ) : null}
                </div>
              ) : (
                <form className="admin-form" action={createShopShippingProviderAttemptAction}>
                  <input type="hidden" name="orderNumber" value={order.orderNumber} />
                  <label>Scénario fictif
                    <select name="scenario" defaultValue="SUCCEEDED" required>
                      <option value="SUCCEEDED">SUCCEEDED — suivi fictif disponible</option>
                      <option value="PENDING">PENDING — réconciliation requise</option>
                      <option value="FAILED">FAILED — aucun suivi actif</option>
                      <option value="AMBIGUOUS">AMBIGUOUS — revue humaine requise</option>
                    </select>
                  </label>
                  <label className="admin-check">
                    <input type="checkbox" name="confirmation" value="CONFIRM_FAKE_SHIPPING_PROVIDER_QA" required />
                    Je confirme l’exécution du provider transporteur fictif QA.
                  </label>
                  <button className="admin-button" type="submit">PRÉPARER UNE ÉTIQUETTE FICTIVE QA</button>
                </form>
              )}
            </section>
          ) : null}

          {order.status === "OPEN" && order.paymentStatus === "PAID" && !order.paymentReviewAt && order.fulfillmentStatus === "READY_TO_SHIP" ? (
            <section className="admin-side-window" aria-labelledby="admin-shop-tracking-title">
              <p className="admin-section-label">Suivi manuel</p>
              <h2 id="admin-shop-tracking-title">{order.trackingNumber ? "Corriger le suivi avant départ." : "Enregistrer le suivi."}</h2>
              <form className="admin-form admin-shipping-tracking-form" action={recordShopOrderTrackingAction}>
                <input type="hidden" name="orderNumber" value={order.orderNumber} />
                <label>Transporteur ou mode<input name="carrier" maxLength={120} defaultValue={order.shippingCarrier ?? "Colissimo"} required /></label>
                <label>Numéro de suivi<input name="trackingNumber" maxLength={160} defaultValue={order.trackingNumber ?? ""} required /></label>
                <label>URL de suivi HTTPS (facultative)<input name="trackingUrl" type="url" maxLength={1000} defaultValue={order.trackingUrl ?? ""} /></label>
                <label className="admin-check">
                  <input type="checkbox" name="confirmation" value="CONFIRM_SHOP_TRACKING" required />
                  Je confirme la saisie manuelle de ces informations de suivi.
                </label>
                <button className="admin-button" type="submit">ENREGISTRER LE SUIVI</button>
              </form>
            </section>
          ) : null}

          {order.status === "OPEN" && order.paymentStatus === "PAID" && !order.paymentReviewAt && order.fulfillmentStatus === "READY_TO_SHIP" && order.trackingNumber ? (
            <section className="admin-side-window" aria-labelledby="admin-shop-shipped-title">
              <p className="admin-section-label">Confirmation d’expédition</p>
              <h2 id="admin-shop-shipped-title">Confirmer la remise au transporteur.</h2>
              <p>Cette action signifie que LNX Beats a remis le colis au transporteur. Elle n’affirme ni livraison, ni distribution, ni réception par le client.</p>
              <form action={markShopOrderShippedAction}>
                <input type="hidden" name="orderNumber" value={order.orderNumber} />
                <label className="admin-check">
                  <input type="checkbox" name="confirmation" value="CONFIRM_SHOP_SHIPMENT" required />
                  Je confirme la remise effective du colis au transporteur.
                </label>
                <button className="admin-button" type="submit">CONFIRMER L’EXPÉDITION</button>
              </form>
            </section>
          ) : null}

          {order.customerRequests.length ? (
            <section className="admin-side-window">
              <p className="admin-section-label">Demandes client</p>
              <h2>Décision humaine obligatoire.</h2>
              {order.customerRequests.map((request) => {
                const isCancellation = request.type === "PAID_ORDER_CANCELLATION";
                return (
                  <div className="admin-panel-stack" key={request.id}>
                    <p>
                      <strong>{isCancellation ? "Annulation après paiement" : "Correction d’adresse"}</strong><br />
                      {request.requestNumber} · {request.status}
                    </p>
                    <p>{request.reason}</p>
                    {request.status === "REQUESTED" ? (
                      <form className="admin-form" action={decideShopCustomerRequestAction}>
                        <input type="hidden" name="orderNumber" value={order.orderNumber} />
                        <input type="hidden" name="requestNumber" value={request.requestNumber} />
                        {isCancellation ? (
                          <p>
                            L’acceptation déclenche le remboursement total de {formatShopMoney(cancellationAmountCents)}
                            {` via ${cancellationProvider}`}, livraison de {formatShopMoney(order.shippingCents)} comprise,
                            puis annule la commande après confirmation financière. Le workflow prévoit de rétablir
                            {` ${expectedCancellationRestockUnits} unité${expectedCancellationRestockUnits === 1 ? "" : "s"}`} de stock au maximum, une seule fois.
                          </p>
                        ) : null}
                        <label>Décision motivée<textarea name="comment" minLength={5} maxLength={1000} required /></label>
                        <label>Confirmation
                          <select name="confirmation" defaultValue="" required>
                            <option value="" disabled>Choisir</option>
                            <option value={SHOP_CUSTOMER_REQUEST_APPROVAL}>
                              {isCancellation
                                ? `Confirmer annulation + remboursement ${formatShopMoney(cancellationAmountCents)} via ${cancellationProvider}`
                                : "Confirmer l’acceptation"}
                            </option>
                            <option value={SHOP_CUSTOMER_REQUEST_REJECTION}>Confirmer le refus</option>
                          </select>
                        </label>
                        <div className="admin-action-row">
                          <button className="admin-button" name="decision" value="APPROVE" type="submit">
                            {isCancellation
                              ? `ANNULER ET REMBOURSER ${formatShopMoney(cancellationAmountCents)} VIA ${cancellationProvider}`
                              : "ACCEPTER"}
                          </button>
                          <button className="admin-button admin-button--quiet" name="decision" value="REJECT" type="submit">REFUSER</button>
                        </div>
                      </form>
                    ) : <p>{request.decisionComment}</p>}
                    {request.refundAttempt && ["PENDING", "PROCESSING", "REQUIRES_REVIEW"].includes(request.refundAttempt.status)
                      ? request.refundAttempt.providerRefundId ? (
                          <form className="admin-form" action={reconcileShopCustomerRequestRefundAction}>
                            <input type="hidden" name="orderNumber" value={order.orderNumber} />
                            <input type="hidden" name="requestNumber" value={request.requestNumber} />
                            <label className="admin-check">
                              <input type="checkbox" name="confirmation" value={SHOP_CUSTOMER_REQUEST_REFUND_RECONCILIATION} required />
                              Je confirme la vérification de cette tentative existante auprès du prestataire.
                            </label>
                            <button className="admin-button" type="submit">RÉCONCILIER LA TENTATIVE</button>
                          </form>
                        ) : <p><strong>Réconciliation manuelle requise :</strong> aucune référence provider fiable n’est encore disponible.</p>
                      : null}
                  </div>
                );
              })}
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
