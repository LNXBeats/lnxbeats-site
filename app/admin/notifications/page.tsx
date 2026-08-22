import type { Metadata } from "next";
import Link from "next/link";

import { retryNotificationAction } from "@/app/admin/notifications/actions";
import { requireAdmin } from "@/lib/auth/session";
import { adminNotificationFilters, listAdminNotifications, parseAdminNotificationFilter, type AdminNotificationFilter } from "@/lib/notifications/admin";
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

export default async function AdminNotificationsPage({ searchParams }: Props) {
  await requireAdmin();
  const params = await searchParams;
  const filter = parseAdminNotificationFilter(params.filtre);
  const notifications = await listAdminNotifications(filter);
  return <main className="admin-main">
    <header className="admin-page-heading"><div><p className="admin-section-label">Notifications</p><h1>Suivi transactionnel.</h1></div><p>Outbox PostgreSQL, retries bornés et statuts fournisseur. Les commandes et livraisons restent indépendantes des e-mails.</p></header>
    {params.etat === "retry-planifie" ? <p className="admin-feedback" role="status">La notification existante a été replacée dans la file.</p> : params.etat ? <p className="admin-feedback" role="alert">L’action n’a pas été appliquée.</p> : null}
    <nav className="admin-filters" aria-label="Filtrer les notifications">{adminNotificationFilters.map((value) => <Link key={value} href={value === "attention" ? "/admin/notifications" : `/admin/notifications?filtre=${value}`} aria-current={filter === value ? "page" : undefined}>{filterLabels[value]}</Link>)}</nav>
    <section className="admin-panel" aria-labelledby="notifications-title"><div className="admin-panel__heading"><p className="admin-section-label">Outbox</p><h2 id="notifications-title">{notifications.length} notification{notifications.length === 1 ? "" : "s"}</h2></div>
      <div className="admin-table-wrap"><table><thead><tr><th>Date / objet</th><th>Destination</th><th>Statut</th><th>Tentatives</th><th>Ressource</th><th>Action</th></tr></thead><tbody>{notifications.map((notification) => {
        const retry = manualRetryAllowed({
          status: notification.status,
          suppressionActive: notification.suppressionActive,
          attempts: notification.attempts,
        });
        return <tr key={notification.id}><td>{notification.createdAt.toLocaleString("fr-FR")}<small>{kindLabels[notification.kind]}</small></td><td>{notification.maskedRecipient}<small>{notification.channel} · {notification.provider ?? "En attente"}</small></td><td>{notification.statusLabel}<small>{notification.lastErrorMessage ?? "Aucune erreur"}</small></td><td>{notification.attempts}<small>{notification.status === "FAILED_RETRYABLE" ? `Prochaine : ${notification.availableAt.toLocaleString("fr-FR")}` : "Maximum 5"}</small></td><td>{notification.resourceReference ?? "—"}<small>{notification.resourceType}</small></td><td>{retry ? <form action={retryNotificationAction}><input type="hidden" name="notificationId" value={notification.id} /><button className="admin-button admin-button--quiet" type="submit" aria-label={`Rejouer la notification ${notification.resourceReference ?? notification.id}`}>REJOUER</button></form> : <small>Aucune action</small>}</td></tr>;
      })}</tbody></table>{!notifications.length ? <p>Aucune notification dans cette vue.</p> : null}</div>
      <p className="admin-action-note">Les destinataires sont masqués. Aucun payload privé, secret fournisseur, URL R2 ou contenu de commande n’est affiché.</p>
    </section>
  </main>;
}
