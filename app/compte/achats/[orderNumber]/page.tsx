import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { cancelShopOrderAction, createShopCustomerRequestAction } from "@/app/compte/achats/actions";
import { Container } from "@/components/container";
import { PaymentCheckoutActions } from "@/components/payment-checkout-actions";
import { PaymentReturnNotice } from "@/components/payment-return-notice";
import { PaypalReturnCapture } from "@/components/paypal-return-capture";
import { requireVerifiedUser } from "@/lib/auth/session";
import { shopAfterSalesQaEnabled } from "@/lib/shop/after-sales-config";
import { shopReturnStatusLabel } from "@/lib/shop/after-sales-presentation";
import { listShopReturnsForOrder } from "@/lib/shop/after-sales-service";
import { parseShopOrderNumber } from "@/lib/shop/order-domain";
import {
  canResumeShopPaypalCapture,
  effectiveShopOrderStatus,
  formatShopMoney,
  shopCountryLabel,
  shopCustomerRequestStatusLabel,
  shopFulfillmentLabel,
  shopOrderPaymentState,
  shopReservationIsActive,
  shopShippingMethodLabel,
} from "@/lib/shop/order-presentation";
import { shopPaymentProvidersAvailable } from "@/lib/shop/payment-config";
import { getMemberShopOrder } from "@/lib/shop/order-service";
import { SHOP_CUSTOMER_REQUEST_CONFIRMATION } from "@/lib/shop/customer-request-domain";

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
  const afterSalesEnabled = shopAfterSalesQaEnabled();
  const returnRequests = afterSalesEnabled ? await listShopReturnsForOrder(session.user.id, order.id) : [];
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
  const hasTrackingDetails = Boolean(order.shippingCarrier || order.trackingNumber || order.trackingUrl);

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
        {state === "demande-transmise" ? <p className="auth-form__success" role="status">Votre demande a été transmise à l’Administration sans modifier la commande.</p> : null}
        {state === "demande-refusee" ? <p className="auth-form__error" role="alert">Cette demande n’est pas recevable dans l’état actuel de la commande.</p> : null}

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
                  <p>Expédition : {item.shippingRequired ? order.shippingQuoteVersion ? "incluse dans le devis groupé" : formatShopMoney(item.lineShippingCents) : "aucune"}. Stock : {stockState}.</p>
                </li>
              })}
            </ul>
          </section>

          <section className="member-orders">
            <div className="member-orders__heading"><div><p className="auth-panel__label">Récapitulatif</p><h2>Montants figés.</h2></div></div>
            <dl className="auth-profile">
              <div><dt>Sous-total</dt><dd>{formatShopMoney(order.subtotalCents)}</dd></div>
              <div><dt>Expédition</dt><dd>{formatShopMoney(order.shippingCents)}</dd></div>
              {order.shippingMethod ? <div><dt>Mode de livraison</dt><dd>{shopShippingMethodLabel(order.shippingMethod)}</dd></div> : null}
              {order.shippingCountryCode ? <div><dt>Destination</dt><dd>{shopCountryLabel(order.shippingCountryCode)}</dd></div> : null}
              <div><dt>Total</dt><dd><strong>{formatShopMoney(order.totalCents)}</strong></dd></div>
              <div><dt>Paiement</dt><dd>{order.paymentReviewAt ? "À vérifier" : order.paymentStatus === "PAID" ? "Confirmé" : order.paymentStatus === "CANCELLED" ? "Annulé" : "En attente"}</dd></div>
              {paymentProvider ? <div><dt>Moyen</dt><dd>{paymentProvider}</dd></div> : null}
              <div><dt>Préparation</dt><dd>{shopFulfillmentLabel(order.fulfillmentStatus)}</dd></div>
              <div><dt>Réservation jusqu’au</dt><dd>{new Date(order.reservationExpiresAt).toLocaleString("fr-FR")}</dd></div>
              {order.termsVersion ? <div><dt>Conditions acceptées</dt><dd>Conditions générales de vente</dd></div> : null}
              {order.preparingAt ? <div><dt>Préparation démarrée</dt><dd>{order.preparingAt.toLocaleString("fr-FR")}</dd></div> : null}
              {order.readyToShipAt ? <div><dt>Prête à expédier</dt><dd>{order.readyToShipAt.toLocaleString("fr-FR")}</dd></div> : null}
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

          {order.shippingRequired && order.paymentStatus === "PAID" ? (
            <section className="member-orders" aria-labelledby="shop-order-shipping-title">
              <div className="member-orders__heading"><div><p className="auth-panel__label">Expédition</p><h2 id="shop-order-shipping-title">{order.fulfillmentStatus === "SHIPPED" ? "Votre commande a été remise au transporteur." : "Suivi de votre expédition."}</h2></div></div>
              {order.fulfillmentStatus === "SHIPPED" && hasTrackingDetails ? <dl className="auth-profile">
                <div><dt>Statut</dt><dd>Expédiée par LNX Beats</dd></div>
                {order.shippedAt ? <div><dt>Date d’expédition</dt><dd>{order.shippedAt.toLocaleString("fr-FR")}</dd></div> : null}
                {order.shippingMethod ? <div><dt>Mode</dt><dd>{shopShippingMethodLabel(order.shippingMethod)}</dd></div> : null}
                {order.shippingCarrier ? <div><dt>Transporteur</dt><dd>{order.shippingCarrier}</dd></div> : null}
                {order.trackingNumber ? <div><dt>Numéro de suivi</dt><dd>{order.trackingNumber}</dd></div> : null}
                {order.trackingUrl ? <div><dt>Suivi</dt><dd><a className="text-link" href={order.trackingUrl} target="_blank" rel="noopener noreferrer">Suivre l’expédition</a></dd></div> : null}
              </dl> : <p className="auth-form__notice">Les informations de suivi seront affichées ici lorsqu’elles seront disponibles.</p>}
              {order.fulfillmentStatus === "SHIPPED" ? <p className="auth-form__notice">« Expédiée » signifie que LNX Beats a enregistré la remise du colis au transporteur. Cela ne confirme pas sa livraison au client.</p> : null}
            </section>
          ) : null}

          {afterSalesEnabled && order.paymentStatus === "PAID" && !order.paymentReviewAt ? (
            <section className="member-orders" aria-labelledby="shop-order-sav-title">
              <div className="member-orders__heading"><div><p className="auth-panel__label">Après-vente</p><h2 id="shop-order-sav-title">Retour ou incident.</h2></div></div>
              <p>Déclarez les articles concernés. Toute demande est relue humainement avant retour, remboursement ou remise en stock.</p>
              <div className="auth-form__secondary-actions"><Link className="button button--quiet" href={`/compte/achats/${encodeURIComponent(order.orderNumber)}/sav`}>OUVRIR UNE DEMANDE SAV</Link></div>
              {returnRequests.length ? <ul className="member-order-list">{returnRequests.map((request) => <li key={request.id}><Link className="text-link" href={`/compte/sav/${encodeURIComponent(request.requestNumber)}`}>{request.requestNumber} · {shopReturnStatusLabel(request.status)}</Link></li>)}</ul> : null}
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
                {shopCountryLabel(order.shippingCountryCode)}
              </address>
            </section>
          ) : null}

          {order.paymentStatus === "PAID" && order.fulfillmentStatus !== "SHIPPED" ? <section className="member-orders"><div className="member-orders__heading"><div><p className="auth-panel__label">Demandes avant expédition</p><h2>Une décision Admin reste requise.</h2></div></div>{order.customerRequests.length ? <ul className="member-order-list">{order.customerRequests.map((request) => <li key={request.id}><strong>{request.type === "PAID_ORDER_CANCELLATION" ? "Annulation" : "Correction d’adresse"}</strong><p>{request.requestNumber} · {shopCustomerRequestStatusLabel(request.status)}</p></li>)}</ul> : null}<details className="auth-panel account-disclosure"><summary>Demander l’annulation <span aria-hidden="true">＋</span></summary><form className="auth-form" action={createShopCustomerRequestAction}><input type="hidden" name="orderNumber" value={order.orderNumber} /><input type="hidden" name="type" value="PAID_ORDER_CANCELLATION" /><input type="hidden" name="confirmation" value={SHOP_CUSTOMER_REQUEST_CONFIRMATION} /><label><span>Motif</span><textarea name="reason" minLength={10} maxLength={1000} required /></label><button className="button button--quiet" type="submit">TRANSMETTRE LA DEMANDE</button></form></details>{order.shippingRequired ? <details className="auth-panel account-disclosure"><summary>Demander une correction d’adresse <span aria-hidden="true">＋</span></summary><form className="auth-form" action={createShopCustomerRequestAction}><input type="hidden" name="orderNumber" value={order.orderNumber} /><input type="hidden" name="type" value="SHIPPING_ADDRESS_CORRECTION" /><input type="hidden" name="confirmation" value={SHOP_CUSTOMER_REQUEST_CONFIRMATION} /><label>Prénom<input name="firstName" defaultValue={order.shippingFirstName ?? ""} maxLength={100} required /></label><label>Nom<input name="lastName" defaultValue={order.shippingLastName ?? ""} maxLength={100} required /></label><label>Adresse<input name="addressLine1" defaultValue={order.shippingAddressLine1 ?? ""} maxLength={240} required /></label><label>Complément<input name="addressLine2" defaultValue={order.shippingAddressLine2 ?? ""} maxLength={240} /></label><label>Code postal<input name="postalCode" defaultValue={order.shippingPostalCode ?? ""} inputMode="numeric" pattern="[0-9]{5}" required /></label><label>Ville<input name="city" defaultValue={order.shippingCity ?? ""} maxLength={120} required /></label><input type="hidden" name="countryCode" value="FR" /><label>Motif<input name="reason" minLength={10} maxLength={1000} required /></label><button className="button button--quiet" type="submit">TRANSMETTRE LA CORRECTION</button></form></details> : null}</section> : null}

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
