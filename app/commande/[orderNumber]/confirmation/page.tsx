import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { orderIllustrationFormatLabel } from "@/data/order-illustration";
import { ModifyUnpaidOrderAction } from "@/components/modify-unpaid-order-action";
import { PaymentCheckoutActions } from "@/components/payment-checkout-actions";
import { PaymentReturnNotice } from "@/components/payment-return-notice";
import { PaypalReturnCapture } from "@/components/paypal-return-capture";
import { requireVerifiedUser } from "@/lib/auth/session";
import { clientPaymentState } from "@/lib/orders/checkout";
import { formatEuro, type OrderActor } from "@/lib/orders/domain";
import { getOrderForActor } from "@/lib/orders/service";
import { paymentProvidersAvailable } from "@/lib/payments/availability";
import { hasCurrentEarlyPerformanceConsent } from "@/lib/legal/early-performance-consent";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirmation de paiement", robots: { index: false, follow: false } };

type ConfirmationPageProps = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ paiement?: string; token?: string }>;
};

export default async function OrderConfirmationPage({ params, searchParams }: ConfirmationPageProps) {
  const { orderNumber } = await params;
  const session = await requireVerifiedUser(`/commande/${orderNumber}/confirmation`);
  const actor: OrderActor = { id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role, status: "ACTIVE", emailVerified: true };
  const order = await getOrderForActor(actor, orderNumber);
  if (!order) notFound();
  const query = await searchParams;
  const returnState = query.paiement === "annule" || query.paiement === "paypal-annule" ? "cancel" : "return";
  const paymentState = clientPaymentState(order);
  const paymentProviders = await paymentProvidersAvailable();
  const hasEarlyPerformanceConsent = hasCurrentEarlyPerformanceConsent({
    earlyPerformanceConsentVersion: order.earlyPerformanceConsentVersion,
    earlyPerformanceConsentHashSha256: order.earlyPerformanceConsentHashSha256,
    earlyPerformanceConsentAcceptedAt: order.earlyPerformanceConsentAcceptedAt
      ? new Date(order.earlyPerformanceConsentAcceptedAt)
      : null,
  });
  const canRetry = hasEarlyPerformanceConsent && (["ready", "failed", "expired"].includes(paymentState)
    || (returnState === "cancel" && paymentState === "confirming"));
  const illustrationOption = order.coverIncluded
    ? `Illustration (${orderIllustrationFormatLabel(order.illustrationFormat)}${order.illustrationFormat === "CUSTOM" && order.illustrationFormatCustom ? ` · ${order.illustrationFormatCustom}` : ""})`
    : null;

  return (
    <section className="auth-shell order-confirmation-shell">
      <Container className="order-confirmation">
        <p className="eyebrow">{order.orderNumber}</p>
        <h1>Suivi du paiement.</h1>
        <PaymentReturnNotice state={returnState} paymentState={paymentState} orderNumber={order.orderNumber} />
        {query.paiement === "paypal-retour" && query.token && paymentProviders.paypal ? (
          <PaypalReturnCapture orderNumber={order.orderNumber} providerOrderId={query.token} />
        ) : null}
        <dl className="order-confirmation__summary">
          <div><dt>Projet</dt><dd>{order.title || order.recipient || "Votre création"}</dd></div>
          <div><dt>Total</dt><dd>{formatEuro(order.totalCents)}</dd></div>
          <div><dt>Options</dt><dd>{[illustrationOption, order.priorityProcessing ? "Priorité" : null].filter(Boolean).join(" · ") || "Aucune"}</dd></div>
        </dl>
        {(paymentProviders.stripe || paymentProviders.paypal) && canRetry ? <PaymentCheckoutActions orderNumber={order.orderNumber} amountCents={order.totalCents} providers={paymentProviders} /> : null}
        {!hasEarlyPerformanceConsent ? <p><strong>Paiement bloqué.</strong> Confirmez d’abord votre demande de commencement anticipé depuis Commander.</p> : null}
        {paymentProviders.stripe && ["confirming", "failed"].includes(paymentState) ? <ModifyUnpaidOrderAction orderNumber={order.orderNumber} /> : null}
        <div className="form-navigation">
          <Link className="form-button" href={`/compte/commandes/${encodeURIComponent(order.orderNumber)}`}>Voir ma commande</Link>
          <Link className="form-button" href="/compte">Mon espace</Link>
        </div>
      </Container>
    </section>
  );
}
