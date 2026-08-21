import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { ModifyUnpaidOrderAction } from "@/components/modify-unpaid-order-action";
import { PaymentCheckoutActions } from "@/components/payment-checkout-actions";
import { PaymentReturnNotice } from "@/components/payment-return-notice";
import { PaypalReturnCapture } from "@/components/paypal-return-capture";
import { RightsOptionsSection } from "@/components/rights-options-section";
import { requireVerifiedUser } from "@/lib/auth/session";
import { clientOrderAction, clientPaymentState, orderCanStillBeEdited } from "@/lib/orders/checkout";
import { formatEuro, type OrderActor } from "@/lib/orders/domain";
import { getOrderForActor } from "@/lib/orders/service";
import { orderStatusPresentation } from "@/lib/orders/status";
import { paymentProvidersAvailable } from "@/lib/payments/availability";
import { listRightsRequestsForOrderActor } from "@/lib/rights/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Suivi de commande",
  description: "Suivi privé d’une demande LNX Beats.",
  robots: { index: false, follow: false },
};

type OrderDetailPageProps = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ paiement?: string; token?: string }>;
};

export default async function OrderDetailPage({ params, searchParams }: OrderDetailPageProps) {
  const { orderNumber } = await params;
  const query = await searchParams;
  const paymentReturn = query.paiement;
  const session = await requireVerifiedUser(`/compte/commandes/${orderNumber}`);
  const actor: OrderActor = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    status: "ACTIVE",
    emailVerified: true,
  };
  const order = await getOrderForActor(actor, orderNumber);
  if (!order) notFound();
  const status = orderStatusPresentation[order.status];
  const paymentState = clientPaymentState(order);
  const paymentProviders = await paymentProvidersAvailable();
  const rightsRequests = order.status === "DELIVERED" ? await listRightsRequestsForOrderActor(actor, order.orderNumber) : [];
  const canStartPayment = ["ready", "confirming", "failed", "expired"].includes(paymentState);

  return (
    <section className="auth-shell order-detail-shell">
      <Container className="order-detail">
        <Link className="back-link" href="/compte"><span aria-hidden="true">←</span> Retour à mon espace</Link>
        <header className="order-detail__header">
          <div>
            <p className="eyebrow">{order.orderNumber}</p>
            <h1>{order.title || order.recipient || "Votre histoire"}</h1>
            <p>{status.next}</p>
            <p><strong>Action attendue :</strong> {clientOrderAction(order)}</p>
          </div>
          <div className="order-detail__status"><span>Statut actuel</span><strong>{status.label}</strong></div>
        </header>

        {paymentReturn === "retour" || paymentReturn === "annule" || paymentReturn === "paypal-retour" || paymentReturn === "paypal-annule" ? (
          <PaymentReturnNotice
            state={paymentReturn === "retour" || paymentReturn === "paypal-retour" ? "return" : "cancel"}
            paymentState={paymentState}
            orderNumber={order.orderNumber}
          />
        ) : null}
        {paymentReturn === "paypal-retour" && query.token && paymentProviders.paypal ? (
          <PaypalReturnCapture orderNumber={order.orderNumber} providerOrderId={query.token} />
        ) : null}

        {order.status === "AWAITING_PAYMENT" ? (
          <section className="order-detail__section order-payment-panel" aria-labelledby="order-payment-title">
            <p className="auth-panel__label">Paiement</p>
            <h2 id="order-payment-title">{paymentState === "confirmed" ? "Paiement confirmé" : paymentState === "confirming" ? "Confirmation en cours" : paymentState === "review" ? "Vérification en cours" : "Commande prête à payer"}</h2>
            <p>Le montant vient du snapshot PostgreSQL. Le navigateur ne peut ni le modifier ni confirmer un paiement.</p>
            {(paymentProviders.stripe || paymentProviders.paypal) && canStartPayment ? <PaymentCheckoutActions orderNumber={order.orderNumber} amountCents={order.totalCents} providers={paymentProviders} /> : null}
            {orderCanStillBeEdited(order) ? <Link className="form-button" href={`/commander?brouillon=${encodeURIComponent(order.orderNumber)}&etape=recap`}>Modifier avant paiement</Link> : null}
            {paymentProviders.stripe && ["confirming", "failed"].includes(paymentState) ? <ModifyUnpaidOrderAction orderNumber={order.orderNumber} /> : null}
          </section>
        ) : null}

        <div className="order-detail__grid">
          <section className="order-detail__main" aria-labelledby="order-timeline-title">
            <p className="auth-panel__label">Progression</p>
            <h2 id="order-timeline-title">Le chemin de votre demande.</h2>
            <ol className="order-timeline">
              {order.events.map((event) => (
                <li key={event.id}>
                  <span aria-hidden="true" />
                  <div><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("fr-FR")}</time><strong>{orderStatusPresentation[event.toStatus].label}</strong>{event.note ? <p>{event.note}</p> : null}</div>
                </li>
              ))}
            </ol>
          </section>

          <aside className="order-detail__price" aria-label="Prix de la demande">
            <span>Total de la création</span><strong>{formatEuro(order.totalCents)}</strong>
            <p>{order.usage === "PERSONAL" ? "Usage personnel" : "Ancien snapshot commercial V0.6 — à régulariser"}</p>
            <small>Version tarifaire {order.pricingVersion} · les providers restent limités aux environnements sandbox contrôlés.</small>
          </aside>
        </div>

        <section className="order-detail__section order-delivery-future" aria-labelledby="order-delivery-title">
          <p className="auth-panel__label">Livraison</p>
          {order.delivery ? (
            <>
              <h2 id="order-delivery-title">Votre création est prête.</h2>
              <p>Le master reste privé et n’est jamais exposé par une URL R2 publique permanente.</p>
              <dl className="order-detail__facts">
                <div><dt>Format</dt><dd>{order.delivery.mimeType === "audio/wav" ? "WAV" : "MP3"}</dd></div>
                <div><dt>Taille</dt><dd>{(order.delivery.sizeBytes / (1024 * 1024)).toFixed(1)} Mo</dd></div>
                <div><dt>Livraison</dt><dd>{new Date(order.delivery.createdAt).toLocaleString("fr-FR")}</dd></div>
                {order.downloadExpiresAt ? <div><dt>Disponible jusqu’au</dt><dd>{new Date(order.downloadExpiresAt).toLocaleDateString("fr-FR")}</dd></div> : null}
              </dl>
              <a className="form-button form-button--primary" href={`/api/orders/${encodeURIComponent(order.orderNumber)}/delivery/${order.delivery.id}`}>TÉLÉCHARGER MA CRÉATION</a>
            </>
          ) : (
            <>
              <h2 id="order-delivery-title">Votre création est en cours.</h2>
              <p>Le fichier final apparaîtra ici après sa publication par LNX Beats. Aucun nouvel envoi ni paiement n’est nécessaire.</p>
            </>
          )}
        </section>

        {order.status === "DELIVERED" && order.delivery ? <RightsOptionsSection orderNumber={order.orderNumber} requests={rightsRequests} /> : null}

        <section className="order-detail__section" aria-labelledby="order-brief-title">
          <p className="auth-panel__label">Récapitulatif</p>
          <h2 id="order-brief-title">L’histoire confiée.</h2>
          <dl className="order-detail__facts">
            <div><dt>Personne ou situation</dt><dd>{order.recipient}</dd></div>
            {order.occasion ? <div><dt>Contexte</dt><dd>{order.occasion}</dd></div> : null}
            <div><dt>Direction</dt><dd>{order.musicalDirection}</dd></div>
            {order.emotion ? <div><dt>Émotion</dt><dd>{order.emotion}</dd></div> : null}
            <div className="order-detail__fact--wide"><dt>Histoire</dt><dd>{order.brief}</dd></div>
            {order.importantDetails ? <div className="order-detail__fact--wide"><dt>Détails</dt><dd>{order.importantDetails}</dd></div> : null}
            <div><dt>Cover</dt><dd>{order.coverIncluded ? "Incluse (+10 €)" : "Non"}</dd></div>
            <div><dt>Priorité</dt><dd>{order.priorityProcessing ? "Demandée (+30 €), délai à confirmer" : "Non"}</dd></div>
            <div><dt>Retour inclus</dt><dd>{order.revisionAllowance - order.revisionUsed} sur {order.revisionAllowance} restant</dd></div>
          </dl>
        </section>

        <section className="order-detail__section" aria-labelledby="order-photos-title">
          <p className="auth-panel__label">Références privées</p>
          <h2 id="order-photos-title">Médias de référence joints.</h2>
          {order.photos.length ? (
            <ul className="order-detail__photos">
              {order.photos.map((photo) => (
                <li key={photo.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/orders/${encodeURIComponent(order.orderNumber)}/photos/${photo.id}`} alt={`Photo de référence ${photo.position + 1}`} />
                </li>
              ))}
            </ul>
          ) : <p>Aucune photo jointe à cette demande.</p>}
        </section>

      </Container>
    </section>
  );
}
