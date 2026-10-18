import type { Metadata } from "next";
import Link from "next/link";

import { AdminActionCenter } from "@/components/admin-action-center";
import { AdminCreationWorkCenter } from "@/components/admin-creation-work-center";
import { AdminIcon, type AdminIconName } from "@/components/admin-icons";
import { AdminStatCard } from "@/components/admin-v21-ui";
import { getAdminCockpit } from "@/lib/admin/cockpit";
import { getCreationWorkQueue } from "@/lib/admin/creation-work";
import { orderAdminKpis } from "@/lib/admin/kpi-presentation";
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

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ suivi?: string }> }) {
  await requireAdmin();
  const [cockpit, work, creationDrafts, invoiceCount, projectCount, params] = await Promise.all([
    getAdminCockpit(),
    getCreationWorkQueue(),
    prisma.creation.count({ where: { status: "DRAFT" } }),
    prisma.invoice.count(),
    prisma.project.count(),
    searchParams,
  ]);
  // Financial receipts retain their review state and original screen. They are
  // not creation jobs and are no longer mixed into this work center.
  const otherActions = cockpit.actions.filter(({ domain }) => domain !== "COMMANDER" && domain !== "FINANCIAL_EVENT");
  const otherTotal = cockpit.counts.shopOrders + cockpit.counts.shopReturns + cockpit.counts.notifications + cockpit.counts.rights;
  const stats = [
    { icon: "music", title: "Commandes", count: work.items.length, caption: work.limited ? "créations affichées (vue limitée)" : "créations à suivre", href: "#centre-creations", tone: "attention" },
    { icon: "shop", title: "Boutique", count: cockpit.counts.shopOrders, caption: "à traiter", href: "/admin/boutique/commandes?filtre=attention", tone: "attention" },
    { icon: "heart", title: "SAV", count: cockpit.counts.shopReturns, caption: "à examiner", href: cockpit.shopReturnsHref, tone: "attention" },
    { icon: "bell", title: "Notifications", count: cockpit.counts.notifications, caption: "à examiner", href: "/admin/notifications?filtre=attention", tone: "attention" },
    { icon: "video", title: "Créations", count: creationDrafts, caption: "brouillons", href: "/admin/creations?statut=DRAFT", tone: "neutral" },
    { icon: "file", title: "Contrats", count: cockpit.counts.rights, caption: "à traiter", href: "/admin/droits", tone: "attention" },
    { icon: "file", title: "Factures", count: invoiceCount, caption: "émises", href: "/admin/facturation", tone: "neutral" },
    { icon: "audio", title: "Discographie", count: projectCount, caption: "projets", href: "/admin/catalogue", tone: "neutral" },
  ] satisfies { icon: AdminIconName; title: string; count: number; caption: string; href: string; tone: "attention" | "neutral" }[];
  const orderedStats = orderAdminKpis(stats);

  return (
    <div className="admin-main admin-v21-home">
      <header className="admin-v21-intro">
        <div><p className="admin-kicker">LNX Admin · cockpit</p><h1>Bienvenue.</h1><p>Vos créations à traiter et leur échéance, en un coup d’œil.</p></div>
        <span>{work.items.length} création{work.items.length === 1 ? "" : "s"} à suivre{work.limited ? " (vue limitée)" : ""}</span>
      </header>

      <section className="admin-v21-stats" aria-label="Indicateurs opérationnels">
        {orderedStats.map((item) => <AdminStatCard key={item.title} {...item} />)}
      </section>

      <AdminCreationWorkCenter items={work.items} hidden={work.hidden} limited={work.limited} initialNow={work.now} notice={params.suivi} />
      {otherTotal > 0 ? <details className="admin-creation-work__other"><summary>Autres dossiers à examiner ({otherTotal})</summary><AdminActionCenter total={otherTotal} actions={otherActions.map((action) => ({ key: action.key, domain: action.domain, type: DOMAIN_LABELS[action.domain], reference: action.reference, label: action.label, priority: action.priority, date: action.occurredAt.toISOString(), href: action.href }))} /></details> : null}
      <section className="admin-v21-quick" aria-labelledby="admin-quick-title"><div className="admin-v21-quick__heading"><p className="admin-kicker">Raccourcis</p><h2 id="admin-quick-title">Opérations quotidiennes</h2></div><div>{quickAccess.map((item) => <Link key={item.href} href={item.href}><AdminIcon name={item.icon} /><span><strong>{item.label}</strong><small>{item.detail}</small></span><AdminIcon name="arrow" /></Link>)}</div></section>
    </div>
  );
}
