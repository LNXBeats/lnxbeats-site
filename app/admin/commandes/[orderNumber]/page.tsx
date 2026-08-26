import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { addInternalNoteAction, reconcilePaymentRefundAction, requestPaymentRefundAction } from "@/app/admin/actions";
import { AdminBackLink } from "@/components/admin-back-link";
import { AdminOrderActions } from "@/components/admin-order-actions";
import { AdminOrderDeliveryPanel } from "@/components/admin-order-delivery-panel";
import { AdminPaymentTestAction } from "@/components/admin-payment-test-action";
import { orderIllustrationFormatLabel } from "@/data/order-illustration";
import { getAllowedOrderTransitions, getOrderDeletionEligibility } from "@/lib/admin/order-machine";
import { getAdminOrder } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/session";
import { formatEuro } from "@/lib/orders/domain";
import { orderAcceptsDeliveryUpload } from "@/lib/orders/delivery";
import { assertPaymentServerEnvironment, parsePaymentsConfiguration } from "@/lib/payments/config";
import { paymentMethodPresentation, paymentStatusPresentation } from "@/lib/payments/presentation";
import {
  LIVE_REFUND_CONFIRMATION,
  LIVE_REFUND_RECONCILIATION_CONFIRMATION,
  newRefundRequestToken,
} from "@/lib/payments/refund";
import { loadAndAssertPaymentQaRuntimeEnvironment } from "@/lib/payments/qa-guard";
import { orderStatusPresentation } from "@/lib/orders/status";
import { rightsStatusPresentation } from "@/lib/rights/domain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Détail commande" };

type AdminOrderPageProps = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ etat?: string }>;
};

const stateMessages: Record<string, string> = {
  "statut-mis-a-jour": "Le statut et son événement ont été enregistrés atomiquement.",
  "transition-refusee": "Cette transition n’est pas autorisée depuis le statut actuel.",
  "annulation-paiement-a-verifier": "La commande est annulée. La session Stripe Test n’a pas pu être fermée automatiquement et a été placée en vérification.",
  "note-ajoutee": "La note interne a été ajoutée. Elle reste invisible dans l’espace client.",
  "note-invalide": "La note n’a pas été ajoutée. Vérifiez sa longueur.",
  "suppression-refusee": "Cette commande doit être conservée : la règle de suppression serveur a refusé l’action.",
  "remboursement-confirme": "Le prestataire a confirmé le remboursement. Le statut métier de la commande est inchangé.",
  "remboursement-en-cours": "Le remboursement est en cours. Aucun nouvel ordre de remboursement ne doit être créé.",
  "remboursement-a-verifier": "Le remboursement nécessite une réconciliation opérateur avant toute nouvelle tentative.",
  "remboursement-refuse": "La demande de remboursement a été refusée par les garde-fous serveur.",
};

const notificationKindPresentation = {
  OWNER_NEW_ORDER: "Nouvelle commande — propriétaire",
  CUSTOMER_PAYMENT_CONFIRMED: "Paiement confirmé — client",
  CUSTOMER_ORDER_ACCEPTED: "Commande acceptée — client",
  CUSTOMER_CREATION_STARTED: "Création démarrée — client",
  CUSTOMER_DELIVERY_READY: "Livraison disponible — client",
  OWNER_RIGHTS_REQUESTED: "Nouvelle demande de droits — propriétaire",
  CUSTOMER_RIGHTS_INFORMATION_REQUIRED: "Informations demandées — client",
  CUSTOMER_RIGHTS_PREAUTHORIZATION_READY: "Préautorisation disponible — client",
  CUSTOMER_RIGHTS_CONTRACT_READY: "Contrat prêt — client",
  OWNER_RIGHTS_CLIENT_ACCEPTED: "Contrat accepté — propriétaire",
  CUSTOMER_RIGHTS_REJECTED: "Demande de droits rejetée — client",
  CUSTOMER_RIGHTS_READY_FOR_PAYMENT: "Dossier prêt pour paiement futur — client",
  CUSTOMER_PARTIAL_REFUND: "Remboursement partiel — client",
  CUSTOMER_REFUND_COMPLETED: "Remboursement total — client",
  OWNER_PAYMENT_INCIDENT: "Incident de paiement — propriétaire",
} as const;

const notificationStatusPresentation = {
  PENDING: "En attente",
  PROCESSING: "En cours d’envoi",
  SENT: "Envoyée",
  FAILED: "À réessayer",
  DELIVERED: "Livrée",
  FAILED_RETRYABLE: "Nouvelle tentative planifiée",
  FAILED_FINAL: "Échec définitif",
  BOUNCED: "Adresse rejetée",
  COMPLAINED: "Plainte reçue",
  SUPPRESSED: "Adresse supprimée",
  CANCELED: "Annulée",
} as const;

const paymentAuditActionPresentation = {
  REFUND_REQUESTED: "Remboursement demandé",
  REFUND_PROVIDER_ACCEPTED: "Remboursement accepté par le prestataire",
  REFUND_CONFIRMED: "Remboursement confirmé",
  REFUND_FAILED: "Remboursement échoué",
  REFUND_RECONCILIATION_REQUIRED: "Réconciliation requise",
  INCIDENT_OPENED: "Incident ouvert",
  INCIDENT_UPDATED: "Incident mis à jour",
  INCIDENT_RESOLVED: "Incident résolu",
  RECONCILIATION_CHECKED: "Réconciliation contrôlée",
} as const;

const paymentAuditResultPresentation = {
  PENDING: "En attente",
  SUCCEEDED: "Confirmé",
  FAILED: "Échoué",
  REQUIRES_REVIEW: "Revue requise",
  NO_CHANGE: "Aucun changement",
} as const;

export default async function AdminOrderPage({ params, searchParams }: AdminOrderPageProps) {
  const session = await requireAdmin();
  const { orderNumber } = await params;
  const order = await getAdminOrder(orderNumber);
  if (!order) notFound();
  const deletion = getOrderDeletionEligibility(order);
  const message = stateMessages[(await searchParams).etat ?? ""];
  const currentStatus = orderStatusPresentation[order.status];
  let paymentConfiguration;
  try {
    await loadAndAssertPaymentQaRuntimeEnvironment();
    paymentConfiguration = assertPaymentServerEnvironment();
  } catch {
    paymentConfiguration = null;
  }
  let liveRefundsEnabled = false;
  try {
    const paymentsConfiguration = parsePaymentsConfiguration();
    liveRefundsEnabled = paymentsConfiguration.enabled
      && paymentsConfiguration.deploymentEnvironment === "production"
      && paymentsConfiguration.liveRefundsEnabled === true;
  } catch {
    liveRefundsEnabled = false;
  }
  const canRunStripeTest = paymentConfiguration?.enabled === true
    && paymentConfiguration.mode === "test"
    && order.status === "AWAITING_PAYMENT"
    && order.userId === session.user.id
    && !order.payments.some((payment) => ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED", "REQUIRES_REVIEW"].includes(payment.status));
  const deliveries = order.assets
    .filter(({ role, asset }) => role === "DELIVERY" && ["AUDIO", "DOCUMENT", "IMAGE"].includes(asset.type))
    .map(({ asset, createdAt }) => ({
      id: asset.id,
      assetType: asset.type as "AUDIO" | "DOCUMENT" | "IMAGE",
      filename: asset.filename,
      mimeType: asset.mimeType,
      sizeBytes: Number(asset.sizeBytes),
      durationMs: asset.durationMs,
      width: asset.width,
      height: asset.height,
      storageBackend: asset.storageBackend,
      storageProvider: asset.storageProvider,
      visibility: asset.visibility,
      createdAt: createdAt.toISOString(),
    }));
  const hasSuccessfulPayment = order.payments.some((payment) => ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status));
  const deliveryRequiredToPublish = order.status === "FINALIZING" && deliveries.length === 0;
  const transitions = getAllowedOrderTransitions(order.status)
    .filter(({ to }) => to !== "DELIVERED" || deliveries.length > 0);

  return (
    <div className="admin-main admin-order-detail">
      <AdminBackLink href="/admin/commandes">Retour aux commandes</AdminBackLink>
      {message ? <p className="admin-feedback" role="status">{message}</p> : null}
      <header className="admin-order-hero">
        <div><p className="admin-kicker">{order.orderNumber}</p><h1>{order.title || order.recipient || "Histoire sans titre"}</h1><p>{order.customerName || "Client"} · {order.customerEmail}</p></div>
        <div><span>Statut actuel</span><strong>{currentStatus.label}</strong><small>Créée le {new Date(order.createdAt).toLocaleDateString("fr-FR")}</small></div>
      </header>

      <div className="admin-order-detail__grid">
        <div className="admin-order-detail__main">
          <section className="admin-detail-window" aria-labelledby="admin-brief-title">
            <p className="admin-section-label">Brief complet</p><h2 id="admin-brief-title">Ce qui a été confié.</h2>
            <dl className="admin-detail-facts">
              <div><dt>Destinataire</dt><dd>{order.recipient || "Non renseigné"}</dd></div>
              <div><dt>Contexte</dt><dd>{order.occasion || "Non renseigné"}</dd></div>
              <div><dt>Direction musicale</dt><dd>{order.musicalDirection || "Non renseignée"}</dd></div>
              <div><dt>Émotion</dt><dd>{order.emotion || "Non renseignée"}</dd></div>
              {order.coverIncluded ? <div><dt>Illustration</dt><dd>Demandée</dd></div> : null}
              {order.coverIncluded ? <div><dt>Format demandé</dt><dd>{orderIllustrationFormatLabel(order.illustrationFormat)}</dd></div> : null}
              {order.coverIncluded && order.illustrationFormat === "CUSTOM" ? <div><dt>Précision</dt><dd>{order.illustrationFormatCustom}</dd></div> : null}
              <div className="admin-detail-facts__wide"><dt>Histoire</dt><dd>{order.brief || "Non renseignée"}</dd></div>
              {order.importantDetails ? <div className="admin-detail-facts__wide"><dt>Détails importants</dt><dd>{order.importantDetails}</dd></div> : null}
            </dl>
          </section>

          <section className="admin-detail-window" aria-labelledby="admin-photos-title">
            <p className="admin-section-label">Références privées</p><h2 id="admin-photos-title">Médias fournis par le client.</h2>
            {order.assets.some(({ role, asset }) => role === "REFERENCE" && asset.type === "IMAGE") ? (
              <ul className="admin-private-photos">
                {order.assets.filter(({ role, asset }) => role === "REFERENCE" && asset.type === "IMAGE").map(({ asset, position }) => (
                  <li key={asset.id}>
                    {/* Private authenticated response: bypassing the public image optimizer is intentional. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/orders/${encodeURIComponent(order.orderNumber)}/photos/${asset.id}`} alt={`Référence privée ${position + 1}`} />
                    <span>{asset.width && asset.height ? `${asset.width} × ${asset.height} px` : "Dimensions non documentées"}</span>
                  </li>
                ))}
              </ul>
            ) : <p>Aucune photo jointe à cette commande.</p>}
          </section>

          <section className="admin-detail-window" aria-labelledby="admin-timeline-title">
            <p className="admin-section-label">Historique réel</p><h2 id="admin-timeline-title">Timeline.</h2>
            <ol className="admin-timeline">
              {order.events.map((event) => <li key={event.id}><span aria-hidden="true" /><div><time dateTime={event.createdAt.toISOString()}>{event.createdAt.toLocaleString("fr-FR")}</time><p><strong>{orderStatusPresentation[event.toStatus].label}</strong>{event.visibility === "INTERNAL" ? <em>Interne</em> : <em>Client</em>}</p>{event.note ? <blockquote>{event.note}</blockquote> : null}<small>{event.actor ? `Par ${event.actor.displayName} · ${event.actor.role === "ADMIN" ? "Administrateur" : "Client"}` : "Par le système"}</small></div></li>)}
            </ol>
          </section>
        </div>

        <aside className="admin-order-detail__aside">
          <section className="admin-side-window">
            <p className="admin-section-label">Prix snapshot</p><strong className="admin-price">{formatEuro(order.totalCents)}</strong>
            <dl><div><dt>Création</dt><dd>{formatEuro(order.basePriceCents)}</dd></div>{order.coverIncluded ? <div><dt>Illustration</dt><dd>{formatEuro(order.coverPriceCents)}</dd></div> : null}<div><dt>Priorité</dt><dd>{order.priorityProcessing ? formatEuro(order.priorityPriceCents) : "Non"}</dd></div><div><dt>Révisions</dt><dd>{order.revisionUsed} / {order.revisionAllowance}</dd></div></dl>
            <small>Tarif {order.pricingVersion}. Le montant du navigateur n’est jamais utilisé comme source de vérité.</small>
          </section>

          <section className="admin-side-window" aria-labelledby="admin-payments-title">
            <p className="admin-section-label">Paiements</p><h2 id="admin-payments-title">{order.payments.length ? `${order.payments.length} tentative${order.payments.length > 1 ? "s" : ""}` : "Aucune tentative"}</h2>
            {order.payments.map((payment) => (
              <div key={payment.id} className="admin-payment-record">
              <dl>
                <div><dt>Statut</dt><dd>{paymentStatusPresentation[payment.status]}</dd></div>
                <div><dt>Montant</dt><dd>{formatEuro(payment.amountCents)} · {payment.currency}</dd></div>
                <div><dt>Remboursé</dt><dd>{formatEuro(payment.refundedAmountCents)}</dd></div>
                <div><dt>Solde remboursable</dt><dd>{formatEuro(Math.max(0, payment.amountCents - payment.refundedAmountCents - payment.refundAttempts.filter((attempt) => ["PROCESSING", "PENDING", "REQUIRES_REVIEW"].includes(attempt.status)).reduce((sum, attempt) => sum + attempt.amountCents, 0)))}</dd></div>
                <div><dt>Prestataire</dt><dd>{payment.provider === "STRIPE" ? "Stripe" : "PayPal"}</dd></div>
                <div><dt>Environnement</dt><dd>{payment.mode === "TEST" ? "MODE TEST" : "LIVE"}</dd></div>
                {payment.mode === "LIVE" ? <div><dt>Remboursements Live</dt><dd>{liveRefundsEnabled ? "Autorisés" : "Désactivés"}</dd></div> : null}
                <div><dt>Moyen</dt><dd>{payment.paymentMethod ? paymentMethodPresentation[payment.paymentMethod] : "Non déterminé"}</dd></div>
                <div><dt>ID externe</dt><dd>{payment.providerPaymentId ?? payment.providerCheckoutId ?? "Non attribué"}</dd></div>
                {payment.status === "REQUIRES_REVIEW" || payment.failureCode?.startsWith("WEBHOOK_") || payment.events.length ? <div><dt>Alerte</dt><dd>Réconciliation technique requise</dd></div> : null}
                <div><dt>Tarif</dt><dd>{payment.pricingVersion}</dd></div>
                <div><dt>Créée</dt><dd>{payment.createdAt.toLocaleString("fr-FR")}</dd></div>
                <div><dt>Dernière mise à jour</dt><dd>{payment.updatedAt.toLocaleString("fr-FR")}</dd></div>
              </dl>
              {payment.refundAttempts.length ? <details className="admin-refund-history"><summary>Historique remboursements ({payment.refundAttempts.length})</summary>{payment.refundAttempts.map((attempt) => <div key={attempt.id} className="admin-refund-attempt"><p><strong>{formatEuro(attempt.amountCents)}</strong> · {attempt.status === "SUCCEEDED" ? "Confirmé" : attempt.status === "PENDING" || attempt.status === "PROCESSING" ? "En cours" : attempt.status === "FAILED" ? "Échoué" : "À réconcilier"}</p><small>{attempt.createdAt.toLocaleString("fr-FR")} · {attempt.source === "ADMIN" ? "Demandé par Admin" : "Détecté chez le prestataire"}{attempt.providerRefundId ? ` · Réf. ${attempt.providerRefundId}` : ""}{attempt.failureCode ? ` · Diagnostic ${attempt.failureCode}` : ""}</small>{["PENDING", "PROCESSING", "REQUIRES_REVIEW"].includes(attempt.status) ? payment.mode === "LIVE" && !liveRefundsEnabled ? <p><strong>Réconciliation Live désactivée — revue opérateur requise.</strong></p> : <form action={reconcilePaymentRefundAction}><input type="hidden" name="orderNumber" value={order.orderNumber} /><input type="hidden" name="attemptId" value={attempt.id} /><label><input type="checkbox" name="confirmation" value={payment.mode === "LIVE" ? LIVE_REFUND_RECONCILIATION_CONFIRMATION : "CONFIRM_REFUND_RECONCILIATION"} required /> {payment.mode === "LIVE" ? "Je confirme cette vérification auprès du prestataire LIVE." : "Je confirme cette vérification TEST."}</label><button type="submit">Réconcilier cette tentative</button></form> : null}</div>)}</details> : null}
              {payment.incidents.length ? <details className="admin-refund-history" open><summary>Incidents financiers ({payment.incidents.length})</summary>{payment.incidents.map((incident) => <div key={incident.id} className="admin-refund-attempt"><p><strong>{incident.type === "DISPUTE" ? "Litige" : incident.type === "CHARGEBACK" ? "Chargeback" : "Reversal"}</strong> · {incident.status === "RESOLVED" ? "Résolu" : incident.status === "UNDER_REVIEW" ? "En revue" : "Ouvert"}</p><small>{incident.amountCents ? formatEuro(incident.amountCents) : "Montant à vérifier"} · Revue opérateur {incident.requiresOperatorReview ? "requise" : "terminée"} · Réf. {incident.providerIncidentId}</small></div>)}</details> : null}
              {payment.auditEvents.length ? <details className="admin-refund-history"><summary>Journal financier ({payment.auditEvents.length})</summary>{payment.auditEvents.map((event) => <div key={event.id} className="admin-refund-attempt"><p><strong>{paymentAuditActionPresentation[event.action]}</strong> · {paymentAuditResultPresentation[event.result]}</p><small>{event.createdAt.toLocaleString("fr-FR")}{event.amountCents ? ` · ${formatEuro(event.amountCents)}` : ""} · {event.actorRole === "ADMIN" ? "Administrateur" : "Système"}</small></div>)}</details> : null}
              {payment.mode === "TEST" && ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status) ? <details className="admin-refund-panel"><summary>Rembourser ce paiement TEST</summary><p><strong>Le remboursement modifie l’état financier mais ne modifie pas automatiquement l’état de la commande.</strong></p><form action={requestPaymentRefundAction}><input type="hidden" name="orderNumber" value={order.orderNumber} /><input type="hidden" name="refundKind" value="FULL" /><input type="hidden" name="requestToken" value={newRefundRequestToken()} /><label><input type="checkbox" name="confirmation" value="CONFIRM_FINANCIAL_REFUND" required /> Je confirme le remboursement total auprès du prestataire.</label><button type="submit">Rembourser totalement</button></form><form action={requestPaymentRefundAction}><input type="hidden" name="orderNumber" value={order.orderNumber} /><input type="hidden" name="refundKind" value="PARTIAL" /><input type="hidden" name="requestToken" value={newRefundRequestToken()} /><label htmlFor={`refund-amount-${payment.id}`}>Montant partiel en euros</label><input id={`refund-amount-${payment.id}`} name="amount" inputMode="decimal" placeholder="10,00" required /><label><input type="checkbox" name="confirmation" value="CONFIRM_FINANCIAL_REFUND" required /> Je confirme ce remboursement partiel.</label><button type="submit">Rembourser partiellement</button></form></details> : null}
              {payment.mode === "LIVE" && ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status) ? liveRefundsEnabled ? <details className="admin-refund-panel"><summary>Rembourser ce paiement LIVE</summary><p><strong>MODE LIVE — OPÉRATION FINANCIÈRE RÉELLE.</strong> Le montant est relu depuis PostgreSQL et l’état métier de la commande reste inchangé.</p><form action={requestPaymentRefundAction}><input type="hidden" name="orderNumber" value={order.orderNumber} /><input type="hidden" name="refundKind" value="FULL" /><input type="hidden" name="requestToken" value={newRefundRequestToken()} /><label><input type="checkbox" name="confirmation" value={LIVE_REFUND_CONFIRMATION} required /> Je confirme le remboursement réel du solde de {formatEuro(Math.max(0, payment.amountCents - payment.refundedAmountCents))}.</label><button type="submit">Confirmer le remboursement LIVE</button></form><form action={requestPaymentRefundAction}><input type="hidden" name="orderNumber" value={order.orderNumber} /><input type="hidden" name="refundKind" value="PARTIAL" /><input type="hidden" name="requestToken" value={newRefundRequestToken()} /><label htmlFor={`refund-live-amount-${payment.id}`}>Montant réel partiel en euros</label><input id={`refund-live-amount-${payment.id}`} name="amount" inputMode="decimal" placeholder="10,00" required /><label><input type="checkbox" name="confirmation" value={LIVE_REFUND_CONFIRMATION} required /> Je confirme ce remboursement financier LIVE réel.</label><button type="submit">Confirmer le remboursement partiel LIVE</button></form></details> : <div className="admin-refund-panel"><p><strong>Remboursements Live désactivés.</strong></p><p>Aucune demande ni réconciliation Live ne peut être lancée depuis LNX Studio. Consultez le runbook et faites valider la procédure avant toute action chez le prestataire.</p></div> : null}
              </div>
            ))}
            {canRunStripeTest ? <AdminPaymentTestAction orderNumber={order.orderNumber} amountCents={order.totalCents} /> : null}
            <small>Résumé PostgreSQL en lecture seule. Seul l’identifiant externe utile à la réconciliation est affiché ; aucun secret ni donnée carte ne l’est.</small>
          </section>

          <section className="admin-side-window" aria-labelledby="admin-actions-title">
            <p className="admin-section-label">Prochaine étape</p><h2 id="admin-actions-title">Actions autorisées.</h2>
            <AdminOrderActions
              orderNumber={order.orderNumber}
              transitions={transitions}
              deletionEligible={deletion.eligible}
              deletionReason={deletion.reason}
              emptyReason={deliveryRequiredToPublish ? "Ajoutez d’abord au moins un livrable privé valide. La publication sera ensuite disponible." : undefined}
            />
          </section>

          <details className="admin-side-window admin-note-panel">
            <summary>Ajouter une note interne</summary><p>Cette note ne sera jamais affichée dans l’espace client.</p>
            <form action={addInternalNoteAction}><input type="hidden" name="orderNumber" value={order.orderNumber} /><label htmlFor="internal-note">Note</label><textarea id="internal-note" name="note" rows={5} maxLength={1000} required /><button type="submit">Enregistrer la note</button></form>
          </details>

          <section className="admin-side-window">
            <AdminOrderDeliveryPanel
              orderNumber={order.orderNumber}
              deliveries={deliveries}
              canUpload={orderAcceptsDeliveryUpload(order.status, hasSuccessfulPayment)}
              published={order.status === "DELIVERED"}
              publishedAt={order.deliveredAt?.toISOString() ?? null}
            />
          </section>

          <section className="admin-side-window" aria-labelledby="admin-notifications-title">
            <p className="admin-section-label">Notifications</p>
            <h2 id="admin-notifications-title">{order.notifications.length ? `${order.notifications.length} message${order.notifications.length > 1 ? "s" : ""}` : "Aucun message"}</h2>
            {order.notifications.map((notification) => (
              <dl key={notification.id}>
                <div><dt>Objet</dt><dd>{notificationKindPresentation[notification.kind]}</dd></div>
                <div><dt>Canal</dt><dd>{notification.channel}</dd></div>
                <div><dt>Statut</dt><dd>{notificationStatusPresentation[notification.status]}</dd></div>
                <div><dt>Tentatives</dt><dd>{notification.attempts}</dd></div>
                <div><dt>Créée</dt><dd>{notification.createdAt.toLocaleString("fr-FR")}</dd></div>
                {notification.sentAt ? <div><dt>Envoyée</dt><dd>{notification.sentAt.toLocaleString("fr-FR")}</dd></div> : null}
                {notification.lastErrorCode ? <div><dt>Suivi</dt><dd>Envoi à réessayer séparément</dd></div> : null}
              </dl>
            ))}
            <small>Aucun secret, payload fournisseur, lien R2 ou contenu de master n’est affiché.</small>
          </section>

          <section className="admin-side-window" aria-labelledby="admin-rights-title">
            <p className="admin-section-label">Droits & contrats</p><h2 id="admin-rights-title">{order.rightsRequests.length ? `${order.rightsRequests.length} demande${order.rightsRequests.length > 1 ? "s" : ""}` : "Aucune demande"}</h2>
            {order.rightsRequests.map((rights) => <dl key={rights.id}><div><dt>Référence</dt><dd><Link href={`/admin/droits/${rights.requestNumber}`}>{rights.requestNumber}</Link></dd></div><div><dt>Offre</dt><dd>{rights.type === "PUBLICATION_LICENSE" ? "Licence 150 €" : "Partenariat 1 500 €"}</dd></div><div><dt>Statut</dt><dd>{rightsStatusPresentation[rights.status].label}</dd></div><div><dt>Paiement</dt><dd>Désactivé</dd></div></dl>)}
            {order.rightsRequests.length ? <p>Ouvrir la rubrique Droits & contrats pour la revue, les documents et l’historique.</p> : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
