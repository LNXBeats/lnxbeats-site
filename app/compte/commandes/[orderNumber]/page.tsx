import { getSiteLocale, serverT, serverDate, serverMoney } from "@/lib/i18n/server";
import { OriginalName } from "@/components/original-name";
import { T } from "@/components/site-language";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { ModifyUnpaidOrderAction } from "@/components/modify-unpaid-order-action";
import { PaymentCheckoutActions } from "@/components/payment-checkout-actions";
import { PaymentReturnNotice } from "@/components/payment-return-notice";
import { PaypalReturnCapture } from "@/components/paypal-return-capture";
import { RightsOptionsSection } from "@/components/rights-options-section";
import { orderIllustrationFormatLabel } from "@/data/order-illustration";
import { requireVerifiedUser } from "@/lib/auth/session";
import { clientOrderAction, clientPaymentState, orderCanStillBeEdited } from "@/lib/orders/checkout";
import { type OrderActor } from "@/lib/orders/domain";
import { getOrderForActor } from "@/lib/orders/service";
import { orderStatusPresentation } from "@/lib/orders/status";
import { loadRightsCommerceReadiness } from "@/lib/rights/commerce";
import { publicationLicenseEligibility } from "@/lib/rights/domain";
import { paymentProvidersAvailable } from "@/lib/payments/availability";
import { listRightsRequestsForOrderActor } from "@/lib/rights/service";
import { hasCurrentEarlyPerformanceConsent } from "@/lib/legal/early-performance-consent";

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

const fulfillmentSteps = ["Commande reçue", "Création en cours", "Finalisation", "Livraison disponible"] as const;

function fulfillmentStep(status: string) {
  if (status === "DELIVERED") return 3;
  if (status === "FINALIZING") return 2;
  if (["IN_PROGRESS", "FIRST_VERSION_READY", "REVISION_REQUESTED"].includes(status)) return 1;
  return 0;
}

function deliveryFormat(mimeType: string) {
  return ({
    "audio/mpeg": "MP3", "audio/wav": "WAV", "audio/flac": "FLAC",
    "application/zip": "ZIP", "application/pdf": "PDF",
    "image/jpeg": "JPEG", "image/png": "PNG",
  } as Record<string, string>)[mimeType] ?? "Fichier";
}

export default async function OrderDetailPage({ params, searchParams }: OrderDetailPageProps) {
  const locale = await getSiteLocale();
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
  const [paymentProviders, rightsCommerce] = await Promise.all([
    paymentProvidersAvailable(),
    loadRightsCommerceReadiness(),
  ]);
  const rightsRequests = order.status === "DELIVERED" ? await listRightsRequestsForOrderActor(actor, order.orderNumber) : [];
  const publicationEligibility = publicationLicenseEligibility({
    ownerMatches: true,
    orderStatus: order.status,
    deliveredAt: order.deliveredAt,
    expectedAmountCents: order.totalCents,
    expectedCurrency: order.currency,
    payments: order.payments,
    deliveries: order.deliveries,
    workTitle: order.title || order.recipient,
    existingStatuses: rightsRequests.filter((request) => request.type === "PUBLICATION_LICENSE").map((request) => request.status),
  });
  const hasEarlyPerformanceConsent = hasCurrentEarlyPerformanceConsent({
    earlyPerformanceConsentVersion: order.earlyPerformanceConsentVersion,
    earlyPerformanceConsentHashSha256: order.earlyPerformanceConsentHashSha256,
    earlyPerformanceConsentAcceptedAt: order.earlyPerformanceConsentAcceptedAt
      ? new Date(order.earlyPerformanceConsentAcceptedAt)
      : null,
  });
  const canStartPayment = hasEarlyPerformanceConsent && ["ready", "confirming", "failed", "expired"].includes(paymentState);
  const activeFulfillmentStep = fulfillmentStep(order.status);
  const confirmedPayment = order.payments.find((payment) => payment.status === "SUCCEEDED");

  return (
    <section className="auth-shell order-detail-shell">
      <Container className="order-detail">
        <Link className="back-link" href="/compte"><span aria-hidden="true">←</span> <T text="Retour à mon espace" /></Link>
        <header className="order-detail__header">
          <div>
            <p className="eyebrow">{order.orderNumber}</p>
            <h1>{order.title || order.recipient ? <OriginalName>{order.title || order.recipient}</OriginalName> : <T text="Votre histoire" />}</h1>
            <p>{<T text={status.next} />}</p>
            <p><strong><T text="Action attendue :" /></strong> {<T text={clientOrderAction(order)} />}</p>
          </div>
          <div className="order-detail__status"><span><T text="Statut actuel" /></span><strong>{<T text={status.label} />}</strong></div>
        </header>

        {!orderCanStillBeEdited(order) ? <nav className="order-fulfillment-progress" aria-label={serverT(locale, "Progression de la commande")}>
          <ol>
            {fulfillmentSteps.map((step, index) => <li key={step} data-state={index < activeFulfillmentStep ? "complete" : index === activeFulfillmentStep ? "current" : "future"} aria-current={index === activeFulfillmentStep ? "step" : undefined}><span aria-hidden="true">{index + 1}</span><strong>{<T text={step} />}</strong></li>)}
          </ol>
        </nav> : null}

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
            <p className="auth-panel__label"><T text="Paiement" /></p>
            <h2 id="order-payment-title">{paymentState === "confirmed" ? <T text="Paiement confirmé" /> : paymentState === "confirming" ? <T text="Confirmation en cours" /> : paymentState === "review" ? <T text="Vérification en cours" /> : <T text="Commande prête à payer" />}</h2>
            <p><T text="Le montant enregistré pour cette commande est vérifié par LNX Studio. Il ne peut pas être modifié depuis cette page." /></p>
            {(paymentProviders.stripe || paymentProviders.paypal) && canStartPayment ? <PaymentCheckoutActions orderNumber={order.orderNumber} amountCents={order.totalCents} providers={paymentProviders} /> : null}
            {!hasEarlyPerformanceConsent ? <p><strong><T text="Une confirmation distincte est nécessaire avant le paiement." /></strong> <T text="Revenez dans Commander pour demander expressément le commencement de la création avant la fin du délai de rétractation." /></p> : null}
            {orderCanStillBeEdited(order) ? <Link className="form-button" href={`/commander?brouillon=${encodeURIComponent(order.orderNumber)}&etape=recap`}><T text="Modifier avant paiement" /></Link> : null}
            {paymentProviders.stripe && ["confirming", "failed"].includes(paymentState) ? <ModifyUnpaidOrderAction orderNumber={order.orderNumber} /> : null}
          </section>
        ) : null}

        <div className="order-detail__grid">
          <section className="order-detail__main" aria-labelledby="order-timeline-title">
            <p className="auth-panel__label"><T text="Progression" /></p>
            <h2 id="order-timeline-title"><T text="Le chemin de votre demande." /></h2>
            <ol className="order-timeline">
              {order.events.map((event) => (
                <li key={event.id}>
                  <span aria-hidden="true" />
                  <div><time dateTime={event.createdAt}>{serverDate(locale, new Date(event.createdAt), {dateStyle:"short",timeStyle:"short"})}</time><strong>{<T text={orderStatusPresentation[event.toStatus].label} />}</strong>{event.note ? <p>{event.note}</p> : null}</div>
                </li>
              ))}
            </ol>
          </section>

          <aside className="order-detail__price" aria-label={serverT(locale, "Prix de la demande")}>
            <span><T text="Total de la création" /></span><strong>{serverMoney(locale,order.totalCents)}</strong>
            <p>{order.usage === "PERSONAL" ? <T text="Usage personnel" /> : <T text="Ancien snapshot commercial V0.6 — à régulariser" />}</p>
            <small><T text="Version tarifaire" />{" "}{order.pricingVersion} <T text="· le montant et son statut sont contrôlés par LNX Studio." /></small>
          </aside>
        </div>

        <section className="order-detail__section order-delivery-future" aria-labelledby="order-delivery-title">
          <p className="auth-panel__label"><T text="Livraison" /></p>
          {order.deliveries.length ? (
            <>
              <h2 id="order-delivery-title"><T text="Votre création est prête." /></h2>
              <p><T text="Vos livrables restent privés. Chaque lecture ou téléchargement nécessite votre session LNX Studio ; aucun lien public permanent n’est créé." /></p>
              <ul className="order-delivery-list">
                {order.deliveries.map((delivery, index) => <li key={delivery.id}>
                  <div><span><T text="Livrable" />{" "}{index + 1}</span><strong>{<OriginalName>{delivery.filename}</OriginalName>}</strong><small>{deliveryFormat(delivery.mimeType)} · {(delivery.sizeBytes / (1024 * 1024)).toFixed(1)} <T text="Mo" /></small></div>
                  {delivery.assetType === "AUDIO" ? <audio controls preload="metadata" src={`/api/orders/${encodeURIComponent(order.orderNumber)}/delivery/${delivery.id}?lecture=1`}><T text="Votre navigateur ne peut pas lire ce fichier audio." /></audio> : null}
                  <a className="form-button form-button--primary" href={`/api/orders/${encodeURIComponent(order.orderNumber)}/delivery/${delivery.id}`}><T text="TÉLÉCHARGER" /></a>
                </li>)}
              </ul>
              <dl className="order-detail__facts">
                {confirmedPayment?.paidAt ? <div><dt><T text="Paiement confirmé" /></dt><dd>{serverDate(locale, new Date(confirmedPayment.paidAt), {dateStyle:"short",timeStyle:"short"})}</dd></div> : null}
                <div><dt><T text="Livraison" /></dt><dd>{order.deliveredAt ? serverDate(locale, new Date(order.deliveredAt), {dateStyle:"short",timeStyle:"short"}) : <T text="Disponible" />}</dd></div>
                {order.downloadExpiresAt ? <div><dt><T text="Disponible jusqu’au" /></dt><dd>{serverDate(locale, new Date(order.downloadExpiresAt), {dateStyle:"short"})}</dd></div> : null}
              </dl>
            </>
          ) : (
            <>
              <h2 id="order-delivery-title"><T text="Votre création est en cours." /></h2>
              <p><T text="Le fichier final apparaîtra ici après sa publication par LNX Beats. Aucun nouvel envoi ni paiement n’est nécessaire." /></p>
            </>
          )}
        </section>

        <RightsOptionsSection requests={rightsRequests} eligible={publicationEligibility.eligible} commerceOpen={rightsCommerce.open} orderNumber={order.orderNumber} workTitle={order.title || order.recipient || "Création LNX"} />

        <section className="order-detail__section" aria-labelledby="order-brief-title">
          <p className="auth-panel__label"><T text="Récapitulatif" /></p>
          <h2 id="order-brief-title"><T text="L’histoire confiée." /></h2>
          <dl className="order-detail__facts">
            <div><dt><T text="Personne ou situation" /></dt><dd>{order.recipient}</dd></div>
            {order.occasion ? <div><dt><T text="Contexte" /></dt><dd>{order.occasion}</dd></div> : null}
            <div><dt><T text="Direction" /></dt><dd>{order.musicalDirection}</dd></div>
            {order.emotion ? <div><dt><T text="Émotion" /></dt><dd>{order.emotion}</dd></div> : null}
            <div className="order-detail__fact--wide"><dt><T text="Histoire" /></dt><dd>{order.brief}</dd></div>
            {order.importantDetails ? <div className="order-detail__fact--wide"><dt><T text="Détails" /></dt><dd>{order.importantDetails}</dd></div> : null}
            {order.coverIncluded ? <div><dt><T text="Illustration personnalisée" /></dt><dd><T text="Incluse (+10 €)" /></dd></div> : null}
            {order.coverIncluded ? <div><dt><T text="Format demandé" /></dt><dd>{<T text={orderIllustrationFormatLabel(order.illustrationFormat)} />}</dd></div> : null}
            {order.coverIncluded && order.illustrationFormat === "CUSTOM" ? <div><dt><T text="Précision" /></dt><dd>{order.illustrationFormatCustom}</dd></div> : null}
            <div><dt><T text="Priorité" /></dt><dd>{order.priorityProcessing ? <T text="Demandée (+30 €), délai à confirmer" /> : "Non"}</dd></div>
            <div><dt><T text="Retour inclus" /></dt><dd>{order.revisionAllowance - order.revisionUsed} <T text="sur" />{" "}{order.revisionAllowance} <T text="restant" /></dd></div>
            <div><dt><T text="Commencement avant 14 jours" /></dt><dd>{order.earlyPerformanceConsentAcceptedAt ? <T text="Demande enregistrée le {date}" values={{date:serverDate(locale, new Date(order.earlyPerformanceConsentAcceptedAt), {dateStyle:"short",timeStyle:"short"})}} /> : <T text="À confirmer avant paiement" />}</dd></div>
          </dl>
        </section>

        <section className="order-detail__section" aria-labelledby="order-photos-title">
          <p className="auth-panel__label"><T text="Références privées" /></p>
          <h2 id="order-photos-title"><T text="Médias de référence joints." /></h2>
          {order.photos.length ? (
            <ul className="order-detail__photos">
              {order.photos.map((photo) => (
                <li key={photo.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/orders/${encodeURIComponent(order.orderNumber)}/photos/${photo.id}`} alt={serverT(locale,"Photo de référence {number}",{number:photo.position+1})} />
                </li>
              ))}
            </ul>
          ) : <p><T text="Aucune photo jointe à cette demande." /></p>}
        </section>

      </Container>
    </section>
  );
}
