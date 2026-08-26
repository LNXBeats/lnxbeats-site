import type { Metadata } from "next";
import Link from "next/link";

import { retryNotificationAction, suppressNotificationRecipientAction } from "@/app/admin/notifications/actions";
import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { adminNotificationFilters, listAdminNotificationReviewEvents, listAdminNotifications, listAdminNotificationSuppressions, parseAdminNotificationFilter, type AdminNotificationFilter } from "@/lib/notifications/admin";
import { ADMIN_NOTIFICATION_RETRY_CONFIRMATION, ADMIN_NOTIFICATION_SUPPRESSION_CONFIRMATION, notificationEventOutcomePresentation, notificationSuppressionReasonPresentation } from "@/lib/notifications/admin-presentation";
import { manualRetryAllowed } from "@/lib/notifications/domain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications" };

const filterLabels: Record<AdminNotificationFilter, string> = {
  attention: "À examiner", pending: "En cours", sent: "Envoyées", suppressed: "Adresses à vérifier", all: "Toutes",
};

const kindLabels = {
  OWNER_NEW_ORDER: "Nouvelle commande · propriétaire",
  CUSTOMER_PAYMENT_CONFIRMED: "Paiement confirmé · client",
  CUSTOMER_ORDER_ACCEPTED: "Commande acceptée · client",
  CUSTOMER_CREATION_STARTED: "Création démarrée · client",
  CUSTOMER_DELIVERY_READY: "Livraison disponible · client",
  OWNER_RIGHTS_REQUESTED: "Demande de droits · propriétaire",
  CUSTOMER_RIGHTS_INFORMATION_REQUIRED: "Informations demandées · client",
  CUSTOMER_RIGHTS_PREAUTHORIZATION_READY: "Préautorisation DRAFT · client",
  CUSTOMER_RIGHTS_CONTRACT_READY: "Document DRAFT · client",
  OWNER_RIGHTS_CLIENT_ACCEPTED: "Acceptation · propriétaire",
  CUSTOMER_RIGHTS_REJECTED: "Demande rejetée · client",
  CUSTOMER_RIGHTS_READY_FOR_PAYMENT: "Étape future · client",
  CUSTOMER_PARTIAL_REFUND: "Remboursement partiel · client",
  CUSTOMER_REFUND_COMPLETED: "Remboursement total · client",
  OWNER_PAYMENT_INCIDENT: "Incident paiement · propriétaire",
} as const;

type Props = { searchParams: Promise<{ filtre?: string; etat?: string }> };

function dateTime(value: Date | null) {
  return value?.toLocaleString("fr-FR") ?? "—";
}

export default async function AdminNotificationsPage({ searchParams }: Props) {
  await requireAdmin();
  const params = await searchParams;
  const filter = parseAdminNotificationFilter(params.filtre);
  const [notifications, reviewEvents, suppressions] = await Promise.all([
    listAdminNotifications(filter),
    listAdminNotificationReviewEvents(),
    listAdminNotificationSuppressions(),
  ]);
  return <main className="admin-main">
    <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-section-label">Notifications</p><h1>Suivi transactionnel.</h1></div><p>Outbox PostgreSQL, retries bornés et statuts fournisseur. Les commandes et livraisons restent indépendantes des e-mails.</p></header>
    {params.etat === "retry-planifie" ? <p className="admin-feedback" role="status">La notification existante a été replacée dans la file.</p> : params.etat === "suppression-ajoutee" ? <p className="admin-feedback" role="status">La destination a été supprimée des prochains envois.</p> : params.etat === "confirmation-requise" ? <p className="admin-feedback" role="alert">Confirmez explicitement l’action avant de continuer.</p> : params.etat ? <p className="admin-feedback" role="alert">L’action n’a pas été appliquée.</p> : null}
    <nav className="admin-filters" aria-label="Filtrer les notifications">{adminNotificationFilters.map((value) => <Link key={value} href={value === "attention" ? "/admin/notifications" : `/admin/notifications?filtre=${value}`} aria-current={filter === value ? "page" : undefined}>{filterLabels[value]}</Link>)}</nav>
    <section className="admin-panel" aria-labelledby="notifications-title"><div className="admin-panel__heading"><p className="admin-section-label">Outbox</p><h2 id="notifications-title">{notifications.length} notification{notifications.length === 1 ? "" : "s"}</h2></div>
      <div className="admin-table-wrap"><table><thead><tr><th>Date / objet</th><th>Destination</th><th>Statut</th><th>Suivi</th><th>Ressource</th><th>Action</th></tr></thead><tbody>{notifications.map((notification) => {
        const retry = manualRetryAllowed({
          status: notification.status,
          suppressionActive: notification.suppressionActive,
          attempts: notification.attempts,
        });
        return <tr key={notification.id}>
          <td>{dateTime(notification.createdAt)}<small>{kindLabels[notification.kind]}</small><small>Mise à jour : {dateTime(notification.updatedAt)}</small></td>
          <td>{notification.maskedRecipient}<small>{notification.channel} · {notification.provider ?? "En attente"}</small><small>ID fournisseur : {notification.maskedProviderMessageId}</small></td>
          <td>{notification.statusLabel}<small>{notification.lastErrorMessage ?? "Aucune erreur"}</small>{notification.lastErrorCode ? <small>Code : {notification.lastErrorCode}</small> : null}{notification.suppression ? <small>{notification.suppression.active ? "Adresse bloquée" : "Blocage levé"} · {notificationSuppressionReasonPresentation[notification.suppression.reason]} · {dateTime(notification.suppression.lastEventAt)}</small> : null}</td>
          <td>{notification.attempts} tentative{notification.attempts > 1 ? "s" : ""}<small>Disponible : {dateTime(notification.availableAt)}</small>{notification.processingStartedAt ? <small>Traitement : {dateTime(notification.processingStartedAt)}</small> : null}{notification.leaseExpiresAt ? <small>Échéance de la lease : {dateTime(notification.leaseExpiresAt)}</small> : null}{notification.sentAt ? <small>Acceptée : {dateTime(notification.sentAt)}</small> : null}{notification.deliveredAt ? <small>Livrée : {dateTime(notification.deliveredAt)}</small> : null}{notification.failedAt ? <small>Échec : {dateTime(notification.failedAt)}</small> : null}<details><summary>Événements ({notification.events.length})</summary>{notification.events.length ? <ul>{notification.events.map((event) => <li key={event.id}>{dateTime(event.occurredAt)} · {notificationEventOutcomePresentation[event.outcome]} · {event.providerEventType ?? event.code ?? "Événement interne"} · {event.maskedProviderMessageId}</li>)}</ul> : <small>Aucun événement enregistré.</small>}</details></td>
          <td>{notification.resourceReference ?? "—"}<small>{notification.resourceType}</small></td>
          <td>{retry ? <form action={retryNotificationAction}><input type="hidden" name="notificationId" value={notification.id} /><label><input required type="checkbox" name="retryConfirmation" value={ADMIN_NOTIFICATION_RETRY_CONFIRMATION} /> Confirmer le rejeu de cette notification existante</label><button className="admin-button admin-button--quiet" type="submit" aria-label={`Rejouer la notification ${notification.resourceReference ?? notification.id}`}>REJOUER</button></form> : <small>Aucun rejeu disponible</small>}{notification.hasRecipient && !notification.suppressionActive ? <form action={suppressNotificationRecipientAction}><input type="hidden" name="notificationId" value={notification.id} /><label><input required type="checkbox" name="suppressionConfirmation" value={ADMIN_NOTIFICATION_SUPPRESSION_CONFIRMATION} /> Confirmer le blocage de cette adresse</label><button className="admin-button admin-button--quiet" type="submit" aria-label={`Bloquer la destination de ${notification.resourceReference ?? notification.id}`}>BLOQUER</button></form> : null}</td>
        </tr>;
      })}</tbody></table>{!notifications.length ? <p>Aucune notification dans cette vue.</p> : null}</div>
      <p className="admin-action-note">Les destinataires sont masqués. Aucun payload privé, secret fournisseur, URL R2 ou contenu de commande n’est affiché.</p>
    </section>
    <section className="admin-panel" aria-labelledby="review-events-title">
      <div className="admin-panel__heading"><p className="admin-section-label">Webhooks et rapprochement</p><h2 id="review-events-title">{reviewEvents.length} événement{reviewEvents.length === 1 ? "" : "s"} à examiner</h2></div>
      <div className="admin-table-wrap"><table><thead><tr><th>Date</th><th>Événement</th><th>Destination</th><th>Rapprochement</th></tr></thead><tbody>{reviewEvents.map((event) => <tr key={event.id}><td>{dateTime(event.occurredAt)}<small>Reçu : {dateTime(event.createdAt)}</small></td><td>{event.providerEventType ?? "Événement fournisseur"}<small>{event.code ?? "Revue manuelle requise"}</small><small>ID fournisseur : {event.maskedProviderMessageId}</small></td><td>{event.maskedRecipient}</td><td>{event.notification?.resourceReference ?? "Non rapproché"}<small>{event.notification ? `${event.notification.resourceType} · ${event.statusLabel}` : event.statusLabel}</small></td></tr>)}</tbody></table>{!reviewEvents.length ? <p>Aucun événement fournisseur ne nécessite de rapprochement manuel.</p> : null}</div>
    </section>
    <section className="admin-panel" aria-labelledby="suppressions-title">
      <div className="admin-panel__heading"><p className="admin-section-label">Destinations</p><h2 id="suppressions-title">Suppressions e-mail</h2></div>
      <div className="admin-table-wrap"><table><thead><tr><th>Destination</th><th>État</th><th>Motif</th><th>Dernière décision</th></tr></thead><tbody>{suppressions.map((suppression) => <tr key={suppression.id}><td>{suppression.maskedRecipient}</td><td>{suppression.active ? "Bloquée" : "Levée"}<small>{suppression.provider ?? "Décision Admin"}</small></td><td>{notificationSuppressionReasonPresentation[suppression.reason]}</td><td>{dateTime(suppression.lastEventAt)}{suppression.removedAt ? <small>Levée : {dateTime(suppression.removedAt)}</small> : null}<small>Mise à jour : {dateTime(suppression.updatedAt)}</small></td></tr>)}</tbody></table>{!suppressions.length ? <p>Aucune suppression enregistrée.</p> : null}</div>
    </section>
  </main>;
}
