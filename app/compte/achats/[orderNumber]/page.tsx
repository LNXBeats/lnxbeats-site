import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { cancelShopOrderAction } from "@/app/compte/achats/actions";
import { Container } from "@/components/container";
import { requireVerifiedUser } from "@/lib/auth/session";
import { parseShopOrderNumber } from "@/lib/shop/order-domain";
import { effectiveShopOrderStatus, formatShopMoney } from "@/lib/shop/order-presentation";
import { getMemberShopOrder } from "@/lib/shop/order-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Commande Boutique",
  robots: { index: false, follow: false },
};

type Context = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ etat?: string }>;
};

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
  const state = (await searchParams).etat;
  const effectiveStatus = effectiveShopOrderStatus(order);
  const canCancel = effectiveStatus === "OPEN" && order.paymentStatus === "AWAITING_PAYMENT";

  return (
    <div className="auth-shell account-shell">
      <Container className="auth-shell__inner auth-shell__inner--account">
        <Link className="text-link" href="/compte"><span aria-hidden="true">←</span> Retour à mon espace</Link>
        <header className="auth-intro">
          <p className="eyebrow">Commande Boutique</p>
          <h1>{order.orderNumber}</h1>
          <div className="account-intro__summary">
            <p>
              {effectiveStatus === "OPEN"
                ? "Commande préparée — paiement non activé dans cet environnement."
                : effectiveStatus === "EXPIRED"
                  ? "La réservation de stock a expiré. Aucun paiement n’a été créé."
                  : "Cette commande a été annulée. Aucun paiement n’a été créé."}
            </p>
          </div>
        </header>

        {state === "commande-annulee" ? <p className="auth-form__success" role="status">Commande annulée et stock libéré.</p> : null}
        {state === "annulation-refusee" ? <p className="auth-form__error" role="alert">Cette commande ne peut plus être annulée.</p> : null}

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
              <div><dt>Paiement</dt><dd>{order.paymentStatus === "PAID" ? "Confirmé" : "Non activé"}</dd></div>
              <div><dt>Réservation jusqu’au</dt><dd>{new Date(order.reservationExpiresAt).toLocaleString("fr-FR")}</dd></div>
            </dl>
          </section>

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
                <p>L’annulation libère immédiatement la réservation de stock. Aucun paiement n’a été créé.</p>
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
