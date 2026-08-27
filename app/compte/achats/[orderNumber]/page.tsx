import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { cancelShopOrderAction } from "@/app/compte/achats/actions";
import { Container } from "@/components/container";
import { PaymentCheckoutActions } from "@/components/payment-checkout-actions";
import { PaymentReturnNotice } from "@/components/payment-return-notice";
import { PaypalReturnCapture } from "@/components/paypal-return-capture";
import { requireVerifiedUser } from "@/lib/auth/session";
import { parseShopOrderNumber } from "@/lib/shop/order-domain";
import {
  canResumeShopPaypalCapture,
  effectiveShopOrderStatus,
  formatShopMoney,
  shopFulfillmentLabel,
  shopOrderPaymentState,
  shopReservationIsActive,
} from "@/lib/shop/order-presentation";
import { shopPaymentProvidersAvailable } from "@/lib/shop/payment-config";
import { getMemberShopOrder } from "@/lib/shop/order-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Commande Boutique",
  robots: { index: false, follow: false },
};

type Context = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ etat?: string; paiement?: string; token?: string }>;
};

function availableProviders() {
  try {
    return shopPaymentProvidersAvailable();
  } catch {
    return { stripe: false, paypal: false } as const;
  }
}

export default async function MemberShopOrderPage({ params, searchParams }: Context) {
  const session = await requireVerifiedUser("/compte");
  const rawOrderNumber = decodeURIComponent((await params).orderNumber);
  let orderNumber: string;
  try {
    orderNumber = parseShopOrderNumber(rawOrderNumber);
  } catch {
    notFound();
  }
  const order = await getMemberShopOrder(session.user.id, orderNumber);
  if (!order) notFound();
  const query = await searchParams;
  const state = query.etat;
  const effectiveStatus = effectiveShopOrderStatus(order);
  const canCancel = effectiveStatus === "OPEN"
    && order.paymentStatus === "AWAITING_PAYMENT"
    && order.paymentReviewAt === null;
  const paymentState = shopOrderPaymentState(order);
  const providers = availableProviders();
  const canPay = canCancel
    && shopReservationIsActive(order.reservationExpiresAt)
    && order.totalCents > 0
    && (providers.stripe || providers.paypal);
  const paymentReturn = query.paiement;
  const canResumePaypalCapture = paymentReturn === "paypal-retour"
    && canResumeShopPaypalCapture(order.payments, query.token);
  const confirmedPayment = order.payments.find(({ status }) => [
    "SUCCEEDED",
    "REFUND_PENDING",
    "PARTIALLY_REFUNDED",
    "REFUNDED",
  ].includes(status)) ?? null;
  const paymentProvider = confirmedPayment?.provider === "STRIPE"
    ? "Carte bancaire / Apple Pay"
    : confirmedPayment?.provider === "PAYPAL"
      ? "PayPal"
      : null;

  return (
    <div className="auth-shell account-shell">
      <Container className="auth-shell__inner auth-shell__inner--account">
        <Link className="text-link" href="/compte"><span aria-hidden="true">←</span> Retour à mon espace</Link>
        <header className="auth-intro">
          <p className="eyebrow">Commande Boutique</p>
          <h1>{order.orderNumber}</h1>
          <div className="account-intro__summary">
            <p>
              {order.paymentReviewAt
                  ? "Un paiement authentique nécessite une vérification humaine. La préparation reste verrouillée."
                : order.paymentStatus === "PAID"
                  ? `Paiement confirmé — ${shopFulfillmentLabel(order.fulfillmentStatus).toLowerCase()}.`
                  : effectiveStatus === "OPEN"
                ? "Commande préparée — vos articles restent réservés temporairement jusqu’au paiement."
                : effectiveStatus === "EXPIRED"
                  ? "La réservation de stock a expiré. Revenez au panier pour vérifier la disponibilité."
                  : "Cette commande a été annulée."}
            </p>
          </div>
        </header>

        {state === "commande-annulee" ? <p className="auth-form__success" role="status">Commande annulée et stock libéré.</p> : null}
        {state === "annulation-refusee" ? <p className="auth-form__error" role="alert">Cette commande ne peut plus être annulée.</p> : null}

        {paymentReturn === "retour" || paymentReturn === "annule" || paymentReturn === "paypal-retour" || paymentReturn === "paypal-annule" ? (
          <PaymentReturnNotice
            state={paymentReturn === "retour" || paymentReturn === "paypal-retour" ? "return" : "cancel"}
            paymentState={paymentState}
            orderNumber={order.orderNumber}
            target="shop"
          />
        ) : null}
        {canResumePaypalCapture && query.token ? (
          <PaypalReturnCapture
            orderNumber={order.orderNumber}
            providerOrderId={query.token}
            target="shop"
          />
        ) : null}

        <div className="auth-account-stack">
          <section className="member-orders">
            <div className="member-orders__heading"><div><p className="auth-panel__label">Articles</p><h2>Votre sélection.</h2></div></div>
            <ul className="member-order-list">
              {order.items.map((item) => {
                const stockState = !item.inventoryTracked
                  ? "non suivi"
                  : effectiveStatus === "EXPIRED" && item.reservation?.status === "ACTIVE"
                    ? "réservation expirée"
                  : item.reservation?.status === "ACTIVE"
                    ? "réservé temporairement"
                    : item.reservation?.status === "CONFIRMED"
                      ? "confirmé"
                      : item.reservation?.status === "EXPIRED"
                        ? "réservation expirée"
                        : item.reservation?.status === "RELEASED"
                          ? "réservation libérée"
                          : "état indisponible";
                return <li key={item.productId}>
                  <div className="account-shop-line">
                    <span><strong>{item.productTitle}</strong><small>Quantité : {item.quantity}</small></span>
                    <span><small>{formatShopMoney(item.unitPriceCents)} par unité</small><strong>{formatShopMoney(item.lineTotalCents)}</strong></span>
                  </div>
                  <p>Expédition : {item.shippingRequired ? formatShopMoney(item.lineShippingCents) : "aucune"}. Stock : {stockState}.</p>
                </li>
              })}
            </ul>
          </section>

          <section className="member-orders">
            <div className="member-orders__heading"><div><p className="auth-panel__label">Récapitulatif</p><h2>Montants figés.</h2></div></div>
            <dl className="auth-profile">
              <div><dt>Sous-total</dt><dd>{formatShopMoney(order.subtotalCents)}</dd></div>
              <div><dt>Expédition</dt><dd>{formatShopMoney(order.shippingCents)}</dd></div>
              <div><dt>Total</dt><dd><strong>{formatShopMoney(order.totalCents)}</strong></dd></div>
              <div><dt>Paiement</dt><dd>{order.paymentReviewAt ? "À vérifier" : order.paymentStatus === "PAID" ? "Confirmé" : order.paymentStatus === "CANCELLED" ? "Annulé" : "En attente"}</dd></div>
              {paymentProvider ? <div><dt>Moyen</dt><dd>{paymentProvider}</dd></div> : null}
              <div><dt>Préparation</dt><dd>{shopFulfillmentLabel(order.fulfillmentStatus)}</dd></div>
              <div><dt>Réservation jusqu’au</dt><dd>{new Date(order.reservationExpiresAt).toLocaleString("fr-FR")}</dd></div>
              {order.termsVersion ? <div><dt>Conditions acceptées</dt><dd>{order.termsVersion}</dd></div> : null}
              {order.preparingAt ? <div><dt>Préparation démarrée</dt><dd>{order.preparingAt.toLocaleString("fr-FR")}</dd></div> : null}
              {order.shippedAt ? <div><dt>Expédiée</dt><dd>{order.shippedAt.toLocaleString("fr-FR")}</dd></div> : null}
            </dl>
          </section>

          {canPay ? (
            <section className="member-orders order-payment-panel" aria-labelledby="shop-order-payment-title">
              <div className="member-orders__heading"><div><p className="auth-panel__label">Paiement</p><h2 id="shop-order-payment-title">Finaliser votre achat.</h2></div></div>
              <p>Vos articles sont réservés temporairement jusqu’au {order.reservationExpiresAt.toLocaleString("fr-FR")}. Le montant est relu depuis la commande enregistrée.</p>
              <PaymentCheckoutActions
                orderNumber={order.orderNumber}
                amountCents={order.totalCents}
                providers={providers}
                target="shop"
              />
            </section>
          ) : order.paymentStatus === "AWAITING_PAYMENT" && effectiveStatus === "OPEN" ? (
            <p className="auth-form__notice" role="status">Aucun moyen de paiement Boutique n’est disponible dans cet environnement. Votre commande reste enregistrée jusqu’à l’expiration indiquée.</p>
          ) : null}

          {order.fulfillmentStatus === "SHIPPED" ? (
            <section className="member-orders" aria-labelledby="shop-order-shipping-title">
              <div className="member-orders__heading"><div><p className="auth-panel__label">Expédition</p><h2 id="shop-order-shipping-title">Votre commande est partie.</h2></div></div>
              <dl className="auth-profile">
                {order.shippingCarrier ? <div><dt>Transporteur</dt><dd>{order.shippingCarrier}</dd></div> : null}
                {order.trackingNumber ? <div><dt>Numéro de suivi</dt><dd>{order.trackingNumber}</dd></div> : null}
                {order.trackingUrl ? <div><dt>Suivi</dt><dd><a className="text-link" href={order.trackingUrl} target="_blank" rel="noreferrer">Ouvrir le suivi <span aria-hidden="true">↗</span></a></dd></div> : null}
              </dl>
            </section>
          ) : null}

          {order.shippingRequired ? (
            <section className="member-orders">
              <div className="member-orders__heading"><div><p className="auth-panel__label">Livraison</p><h2>Adresse enregistrée.</h2></div></div>
              <address className="account-shop-address">
                {order.shippingFirstName} {order.shippingLastName}<br />
                {order.shippingAddressLine1}<br />
                {order.shippingAddressLine2 ? <>{order.shippingAddressLine2}<br /></> : null}
                {order.shippingPostalCode} {order.shippingCity}<br />
                {order.shippingCountryCode}
              </address>
            </section>
          ) : null}

          {canCancel ? (
            <details className="auth-panel account-disclosure">
              <summary>Annuler cette préparation <span aria-hidden="true">＋</span></summary>
              <div>
                <p>L’annulation libère immédiatement la réservation de stock tant qu’aucun paiement n’est confirmé ou placé en revue.</p>
                <form action={cancelShopOrderAction}>
                  <input name="orderNumber" type="hidden" value={order.orderNumber} />
                  <input name="confirmation" type="hidden" value="CONFIRM_SHOP_ORDER_CANCELLATION" />
                  <button className="button button--quiet" type="submit">Confirmer l’annulation</button>
                </form>
              </div>
            </details>
          ) : null}
        </div>
      </Container>
    </div>
  );
}
