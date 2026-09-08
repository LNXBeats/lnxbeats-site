import type { Metadata } from "next";
import Link from "next/link";

import { getAdminCockpit } from "@/lib/admin/cockpit";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Vue d’ensemble",
  description: "Cockpit privé LNX Beats.",
};

const DOMAIN_LABELS = {
  COMMANDER: "Commande Commander",
  SHOP_ORDER: "Commande Boutique",
  RIGHTS: "Droits & contrats",
  NOTIFICATION: "Notification",
  SHOP_RETURN: "SAV Boutique",
  FINANCIAL_EVENT: "Événement financier",
} as const;

const PRIORITY_LABELS = {
  CRITICAL: "Priorité critique",
  HIGH: "Priorité haute",
  NORMAL: "À planifier",
} as const;

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

export default async function AdminPage() {
  const session = await requireAdmin();
  const cockpit = await getAdminCockpit();
  const displayName = session.user.name?.trim();

  return (
    <div className="admin-main">
      <header className="admin-hero">
        <p className="admin-kicker">LNX Admin Cockpit</p>
        <h1>{displayName ? `Bonjour ${displayName}.` : "Bonjour."}</h1>
        <p>{cockpit.total > 0 ? `${cockpit.total} élément${cockpit.total === 1 ? "" : "s"} demande${cockpit.total === 1 ? "" : "nt"} une intervention.` : "Aucune intervention opérationnelle n’est en attente."}</p>
      </header>

      <section className="admin-overview-grid" aria-label="Compteurs opérationnels">
        <article className="admin-overview-card admin-overview-card--primary">
          <div><p>Commandes Commander</p><strong>{cockpit.counts.commander}</strong></div>
          <p>Étapes métier ou incidents financiers qui nécessitent une décision humaine.</p>
          <Link href="/admin/commandes?filtre=attention">Voir les commandes à examiner <span aria-hidden="true">→</span></Link>
        </article>

        <article className="admin-overview-card">
          <div><p>Commandes Boutique</p><strong>{cockpit.counts.shopOrders}</strong></div>
          <p>Paiements à vérifier, demandes client, préparation et expédition.</p>
          <Link href="/admin/boutique/commandes?filtre=attention">Voir les commandes à traiter <span aria-hidden="true">→</span></Link>
        </article>

        <article className="admin-overview-card">
          <div><p>Droits & contrats</p><strong>{cockpit.counts.rights}</strong></div>
          <p>Dossiers actuellement placés à une étape de traitement Admin.</p>
          <Link href="/admin/droits">Examiner les dossiers <span aria-hidden="true">→</span></Link>
        </article>

        <article className="admin-overview-card">
          <div><p>Notifications</p><strong>{cockpit.counts.notifications}</strong></div>
          <p>Échecs, incidents de distribution ou traitements interrompus.</p>
          <Link href="/admin/notifications?filtre=attention">Voir les notifications à examiner <span aria-hidden="true">→</span></Link>
        </article>

        <article className="admin-overview-card">
          <div><p>SAV Boutique</p><strong>{cockpit.counts.shopReturns}</strong></div>
          <p>Revues, réceptions, inspections et réconciliations encore nécessaires.</p>
          <Link href={cockpit.shopReturnsHref}>Voir les dossiers SAV <span aria-hidden="true">→</span></Link>
        </article>
      </section>

      <section className="admin-list-window" aria-labelledby="admin-actions-title">
        <div className="admin-list-window__heading">
          <h2 id="admin-actions-title">À traiter maintenant</h2>
          <span>{cockpit.actions.length}{cockpit.total > cockpit.actions.length ? ` sur ${cockpit.total}` : ""}</span>
        </div>
        {cockpit.actions.length ? <ul className="admin-order-list">
          {cockpit.actions.map((action) => <li key={action.key} data-priority={action.priority.toLowerCase()}>
            <Link href={action.href}>
              <span className="admin-order-list__identity">
                <small>{DOMAIN_LABELS[action.domain]}</small>
                <strong>{action.reference}</strong>
                <em>{action.label}</em>
              </span>
              <span className="admin-order-list__facts">
                <span>{PRIORITY_LABELS[action.priority]}</span>
              </span>
              <span className="admin-order-list__next">
                <small>En attente depuis le {DATE_FORMAT.format(action.occurredAt)}</small>
              </span>
              <span className="admin-order-list__arrow" aria-hidden="true">→</span>
            </Link>
          </li>)}
        </ul> : <div className="admin-empty"><h2>Rien à traiter.</h2><p>Les traitements automatiques et les dossiers archivés sans nouvelle action ne sont pas présentés comme des actions humaines.</p></div>}
      </section>
    </div>
  );
}
