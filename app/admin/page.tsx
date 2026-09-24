import type { Metadata } from "next";
import Link from "next/link";

import { AdminActionCenter } from "@/components/admin-action-center";
import { AdminIcon, type AdminIconName } from "@/components/admin-icons";
import { AdminStatCard } from "@/components/admin-v21-ui";
import { getAdminCockpit } from "@/lib/admin/cockpit";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

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
const quickAccess: readonly { href: string; label: string; detail: string; icon: AdminIconName }[] = [
  { href: "/admin/creations", label: "Créations", detail: "Médias et collaborateurs", icon: "video" },
  { href: "/admin/boutique", label: "Produits", detail: "Fiches et disponibilité", icon: "box" },
  { href: "/admin/membres", label: "Membres", detail: "Comptes et accès", icon: "users" },
  { href: "/admin/facturation", label: "Facturation", detail: "Factures et avoirs", icon: "file" },
];

export default async function AdminPage() {
  await requireAdmin();
  const [cockpit, creationDrafts, invoiceCount, projectCount] = await Promise.all([
    getAdminCockpit(),
    prisma.creation.count({ where: { status: "DRAFT" } }),
    prisma.invoice.count(),
    prisma.project.count(),
  ]);

  return (
    <div className="admin-main admin-v21-home">
      <header className="admin-v21-intro">
        <div><p className="admin-kicker">LNX Admin · cockpit</p><h1>Bienvenue.</h1><p>Tout ce qui nécessite votre attention, en un coup d’œil.</p></div>
        <span>{cockpit.total > 0 ? `${cockpit.total} dossier${cockpit.total === 1 ? "" : "s"} à examiner` : "Aucune intervention en attente"}</span>
      </header>

      <section className="admin-v21-stats" aria-label="Indicateurs opérationnels">
        <AdminStatCard icon="music" title="Commandes" count={cockpit.counts.commander} caption="à traiter" href="/admin/commandes?filtre=attention" tone="attention" />
        <AdminStatCard icon="shop" title="Boutique" count={cockpit.counts.shopOrders} caption="à traiter" href="/admin/boutique/commandes?filtre=attention" tone="attention" />
        <AdminStatCard icon="heart" title="SAV" count={cockpit.counts.shopReturns} caption="à examiner" href={cockpit.shopReturnsHref} tone="attention" />
        <AdminStatCard icon="bell" title="Notifications" count={cockpit.counts.notifications} caption="à examiner" href="/admin/notifications?filtre=attention" tone="attention" />
        <AdminStatCard icon="video" title="Créations" count={creationDrafts} caption="brouillons" href="/admin/creations?statut=DRAFT" />
        <AdminStatCard icon="file" title="Contrats" count={cockpit.counts.rights} caption="à traiter" href="/admin/droits" tone="attention" />
        <AdminStatCard icon="file" title="Factures" count={invoiceCount} caption="émises" href="/admin/facturation" />
        <AdminStatCard icon="audio" title="Discographie" count={projectCount} caption="projets" href="/admin/catalogue" />
      </section>

      <AdminActionCenter total={cockpit.total} actions={cockpit.actions.map((action) => ({ key: action.key, domain: action.domain, type: DOMAIN_LABELS[action.domain], reference: action.reference, label: action.label, priority: action.priority, date: action.occurredAt.toISOString(), href: action.href }))} />
      <section className="admin-v21-quick" aria-labelledby="admin-quick-title"><div className="admin-v21-quick__heading"><p className="admin-kicker">Raccourcis</p><h2 id="admin-quick-title">Opérations quotidiennes</h2></div><div>{quickAccess.map((item) => <Link key={item.href} href={item.href}><AdminIcon name={item.icon} /><span><strong>{item.label}</strong><small>{item.detail}</small></span><AdminIcon name="arrow" /></Link>)}</div></section>
    </div>
  );
}
