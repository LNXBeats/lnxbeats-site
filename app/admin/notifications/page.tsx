import type { Metadata } from "next";
import Link from "next/link";

import { retryNotificationAction, suppressNotificationRecipientAction } from "@/app/admin/notifications/actions";
import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { adminNotificationFilters, listAdminNotificationReviewEvents, listAdminNotifications, listAdminNotificationSuppressions, parseAdminNotificationFilter, type AdminNotificationFilter } from "@/lib/notifications/admin";
import { ADMIN_NOTIFICATION_RETRY_CONFIRMATION, ADMIN_NOTIFICATION_SUPPRESSION_CONFIRMATION, notificationEventOutcomePresentation, notificationKindPresentation, notificationSuppressionReasonPresentation } from "@/lib/notifications/admin-presentation";
import { manualRetryAllowed } from "@/lib/notifications/domain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications" };

const filterLabels: Record<AdminNotificationFilter, string> = {
  attention: "À examiner", pending: "En cours", sent: "Envoyées", suppressed: "Adresses à vérifier", all: "Toutes",
};

type Props = { searchParams: Promise<{ filtre?: string; etat?: string }> };

function dateTime(value: Date | null) {
  return value?.toLocaleString("fr-FR") ?? "—";
}

type AdminNotification = Awaited<ReturnType<typeof listAdminNotifications>>[number];
type AdminNotificationReviewEvent = Awaited<ReturnType<typeof listAdminNotificationReviewEvents>>[number];
type AdminNotificationSuppression = Awaited<ReturnType<typeof listAdminNotificationSuppressions>>[number];

function NotificationActions({ notification, retry }: { notification: AdminNotification; retry: boolean }) {
  return <div className="admin-notification-actions">
    {retry ? <form action={retryNotificationAction}>
      <input type="hidden" name="notificationId" value={notification.id} />
      <label className="admin-check"><input required type="checkbox" name="retryConfirmation" value={ADMIN_NOTIFICATION_RETRY_CONFIRMATION} /> Confirmer le rejeu de cette notification existante</label>
      <button className="admin-button admin-button--quiet" type="submit" aria-label={`Rejouer la notification ${notification.resourceReference ?? notification.id}`}>REJOUER</button>
    </form> : <small>Aucun rejeu disponible</small>}
    {notification.hasRecipient && !notification.suppressionActive ? <form action={suppressNotificationRecipientAction}>
      <input type="hidden" name="notificationId" value={notification.id} />
      <label className="admin-check"><input required type="checkbox" name="suppressionConfirmation" value={ADMIN_NOTIFICATION_SUPPRESSION_CONFIRMATION} /> Confirmer le blocage de cette adresse</label>
      <button className="admin-button admin-button--quiet" type="submit" aria-label={`Bloquer la destination de ${notification.resourceReference ?? notification.id}`}>BLOQUER</button>
    </form> : null}
  </div>;
}

function NotificationTechnicalDetails({ notification }: { notification: AdminNotification }) {
  return <details className="admin-technical-details">
    <summary>Détails techniques</summary>
    <dl>
      <div><dt>Création</dt><dd>{dateTime(notification.createdAt)}</dd></div>
      <div><dt>Mise à jour</dt><dd>{dateTime(notification.updatedAt)}</dd></div>
      <div><dt>Canal / provider</dt><dd>{notification.channel} · {notification.provider ?? "En attente"}</dd></div>
      <div><dt>ID fournisseur</dt><dd>{notification.maskedProviderMessageId}</dd></div>
      <div><dt>Tentatives</dt><dd>{notification.attempts}</dd></div>
      <div><dt>Disponible</dt><dd>{dateTime(notification.availableAt)}</dd></div>
      {notification.processingStartedAt ? <div><dt>Traitement</dt><dd>{dateTime(notification.processingStartedAt)}</dd></div> : null}
      {notification.leaseExpiresAt ? <div><dt>Échéance lease</dt><dd>{dateTime(notification.leaseExpiresAt)}</dd></div> : null}
      {notification.sentAt ? <div><dt>Acceptée</dt><dd>{dateTime(notification.sentAt)}</dd></div> : null}
      {notification.deliveredAt ? <div><dt>Livrée</dt><dd>{dateTime(notification.deliveredAt)}</dd></div> : null}
      {notification.failedAt ? <div><dt>Échec</dt><dd>{dateTime(notification.failedAt)}</dd></div> : null}
      {notification.lastErrorCode ? <div><dt>Code erreur</dt><dd>{notification.lastErrorCode}</dd></div> : null}
    </dl>
    {notification.events.length ? <div className="admin-technical-details__events"><strong>Événements ({notification.events.length})</strong><ul>{notification.events.map((event) => <li key={event.id}>{dateTime(event.occurredAt)} · {notificationEventOutcomePresentation[event.outcome]} · {event.providerEventType ?? event.code ?? "Événement interne"} · {event.maskedProviderMessageId}</li>)}</ul></div> : <small>Aucun événement enregistré.</small>}
  </details>;
}

function ReviewEventTechnicalDetails({ event }: { event: AdminNotificationReviewEvent }) {
  return <details className="admin-technical-details">
    <summary>Détails techniques</summary>
    <dl>
      <div><dt>Événement</dt><dd>{event.providerEventType ?? "Événement fournisseur"}</dd></div>
      <div><dt>Code</dt><dd>{event.code ?? "Revue manuelle requise"}</dd></div>
      <div><dt>ID fournisseur</dt><dd>{event.maskedProviderMessageId}</dd></div>
      <div><dt>Occurrence</dt><dd>{dateTime(event.occurredAt)}</dd></div>
      <div><dt>Réception</dt><dd>{dateTime(event.createdAt)}</dd></div>
    </dl>
  </details>;
}

function SuppressionTechnicalDetails({ suppression }: { suppression: AdminNotificationSuppression }) {
  return <details className="admin-technical-details">
    <summary>Détails techniques</summary>
    <dl>
      <div><dt>Provider</dt><dd>{suppression.provider ?? "Décision Admin"}</dd></div>
      <div><dt>Motif</dt><dd>{notificationSuppressionReasonPresentation[suppression.reason]}</dd></div>
      <div><dt>Dernière décision</dt><dd>{dateTime(suppression.lastEventAt)}</dd></div>
      {suppression.removedAt ? <div><dt>Levée</dt><dd>{dateTime(suppression.removedAt)}</dd></div> : null}
      <div><dt>Mise à jour</dt><dd>{dateTime(suppression.updatedAt)}</dd></div>
    </dl>
  </details>;
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
    <header className="admin-page-heading"><div><p className="admin-section-label">Notifications</p><h1>Ce qui demande votre attention.</h1></div><p>Commencez par les envois à examiner ou en cours. Les commandes et livraisons restent indépendantes des e-mails.</p></header>
    {params.etat === "retry-planifie" ? <p className="admin-feedback" role="status">La notification existante a été replacée dans la file.</p> : params.etat === "suppression-ajoutee" ? <p className="admin-feedback" role="status">La destination a été supprimée des prochains envois.</p> : params.etat === "confirmation-requise" ? <p className="admin-feedback" role="alert">Confirmez explicitement l’action avant de continuer.</p> : params.etat ? <p className="admin-feedback" role="alert">L’action n’a pas été appliquée.</p> : null}
    <nav className="admin-filters" aria-label="Filtrer les notifications">{adminNotificationFilters.map((value) => <Link key={value} href={value === "attention" ? "/admin/notifications" : `/admin/notifications?filtre=${value}`} aria-current={filter === value ? "page" : undefined}>{filterLabels[value]}</Link>)}</nav>
    <section className="admin-panel" aria-labelledby="notifications-title"><div className="admin-panel__heading"><p className="admin-section-label">Suivi opérationnel</p><h2 id="notifications-title">{notifications.length} notification{notifications.length === 1 ? "" : "s"}</h2></div>
      {notifications.length ? <>
        <div className="admin-table-wrap admin-desktop-records" tabIndex={0} role="region" aria-label="Notifications, défilement horizontal disponible">
          <table><thead><tr><th>État / objet</th><th>Ressource</th><th>Destination</th><th>Action</th><th>Détails</th></tr></thead><tbody>{notifications.map((notification) => {
            const retry = manualRetryAllowed({ status: notification.status, suppressionActive: notification.suppressionActive, attempts: notification.attempts });
            return <tr key={notification.id}>
              <td><strong>{notification.statusLabel}</strong><small>{notificationKindPresentation[notification.kind]}</small>{notification.lastErrorMessage ? <small className="admin-record-alert">{notification.lastErrorMessage}</small> : null}{notification.suppression ? <small>{notification.suppression.active ? "Adresse bloquée" : "Blocage levé"} · {notificationSuppressionReasonPresentation[notification.suppression.reason]}</small> : null}</td>
              <td>{notification.resourceReference ?? "—"}<small>{notification.resourceType}</small></td>
              <td>{notification.maskedRecipient}</td>
              <td><NotificationActions notification={notification} retry={retry} /></td>
              <td><NotificationTechnicalDetails notification={notification} /></td>
            </tr>;
          })}</tbody></table>
        </div>
        <ul className="admin-mobile-records admin-notification-records" aria-label="Notifications">{notifications.map((notification) => {
          const retry = manualRetryAllowed({ status: notification.status, suppressionActive: notification.suppressionActive, attempts: notification.attempts });
          return <li key={notification.id}>
            <div className="admin-record-card__heading"><div><span>État</span><strong>{notification.statusLabel}</strong></div><small>{notification.resourceReference ?? "—"}</small></div>
            <p><strong>{notificationKindPresentation[notification.kind]}</strong><small>{notification.maskedRecipient}</small>{notification.lastErrorMessage ? <small className="admin-record-alert">{notification.lastErrorMessage}</small> : null}{notification.suppression ? <small>{notification.suppression.active ? "Adresse bloquée" : "Blocage levé"} · {notificationSuppressionReasonPresentation[notification.suppression.reason]}</small> : null}</p>
            <NotificationActions notification={notification} retry={retry} />
            <NotificationTechnicalDetails notification={notification} />
          </li>;
        })}</ul>
      </> : <p className="admin-empty-state">Aucune notification dans cette vue.</p>}
      <p className="admin-action-note">Les destinataires sont masqués. Aucun payload privé, secret fournisseur, URL R2 ou contenu de commande n’est affiché.</p>
    </section>
    <details className="admin-panel admin-diagnostics-panel" open={reviewEvents.length > 0}>
      <summary><span>DIAGNOSTIC TECHNIQUE</span><small>Webhooks, rapprochement, leases, retries et suppressions e-mail.</small></summary>
      <div className="admin-diagnostics-panel__content">
        <section aria-labelledby="review-events-title">
          <div className="admin-panel__heading"><p className="admin-section-label">Webhooks et rapprochement</p><h2 id="review-events-title">{reviewEvents.length} événement{reviewEvents.length === 1 ? "" : "s"} à examiner</h2></div>
          {reviewEvents.length ? <>
            <div className="admin-table-wrap admin-desktop-records" tabIndex={0} role="region" aria-label="Événements à rapprocher, défilement horizontal disponible"><table><thead><tr><th>État</th><th>Ressource</th><th>Destination</th><th>Détails</th></tr></thead><tbody>{reviewEvents.map((event) => <tr key={event.id}><td><strong>{event.statusLabel}</strong></td><td>{event.notification?.resourceReference ?? "Non rapproché"}<small>{event.notification?.resourceType ?? "Aucune ressource"}</small></td><td>{event.maskedRecipient}</td><td><ReviewEventTechnicalDetails event={event} /></td></tr>)}</tbody></table></div>
            <ul className="admin-mobile-records" aria-label="Événements à rapprocher">{reviewEvents.map((event) => <li key={event.id}><div className="admin-record-card__heading"><div><span>État</span><strong>{event.statusLabel}</strong></div><small>{event.notification?.resourceReference ?? "Non rapproché"}</small></div><p>{event.maskedRecipient}</p><ReviewEventTechnicalDetails event={event} /></li>)}</ul>
          </> : <p className="admin-empty-state">Aucun événement fournisseur ne nécessite de rapprochement manuel.</p>}
        </section>
        <section aria-labelledby="suppressions-title">
          <div className="admin-panel__heading"><p className="admin-section-label">Destinations</p><h2 id="suppressions-title">Suppressions e-mail</h2></div>
          {suppressions.length ? <>
            <div className="admin-table-wrap admin-desktop-records" tabIndex={0} role="region" aria-label="Suppressions e-mail, défilement horizontal disponible"><table><thead><tr><th>État</th><th>Destination</th><th>Motif</th><th>Détails</th></tr></thead><tbody>{suppressions.map((suppression) => <tr key={suppression.id}><td><strong>{suppression.active ? "Bloquée" : "Levée"}</strong></td><td>{suppression.maskedRecipient}</td><td>{notificationSuppressionReasonPresentation[suppression.reason]}</td><td><SuppressionTechnicalDetails suppression={suppression} /></td></tr>)}</tbody></table></div>
            <ul className="admin-mobile-records" aria-label="Suppressions e-mail">{suppressions.map((suppression) => <li key={suppression.id}><div className="admin-record-card__heading"><div><span>État</span><strong>{suppression.active ? "Bloquée" : "Levée"}</strong></div><small>{suppression.maskedRecipient}</small></div><p>{notificationSuppressionReasonPresentation[suppression.reason]}</p><SuppressionTechnicalDetails suppression={suppression} /></li>)}</ul>
          </> : <p className="admin-empty-state">Aucune suppression enregistrée.</p>}
        </section>
      </div>
    </details>
  </main>;
}
