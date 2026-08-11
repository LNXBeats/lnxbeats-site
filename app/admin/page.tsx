import type { Metadata } from "next";
import Link from "next/link";

import { getAdminOverview } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Vue d’ensemble",
  description: "Cockpit privé LNX Beats.",
};

export default async function AdminPage() {
  const session = await requireAdmin();
  const overview = await getAdminOverview();
  const displayName = session.user.name?.trim();

  return (
    <div className="admin-main">
      <header className="admin-hero">
        <p className="admin-kicker">LNX Admin Cockpit</p>
        <h1>{displayName ? `Bonjour ${displayName}.` : "Bonjour."}</h1>
        <p>Voici ce qui demande votre attention chez LNX Beats.</p>
      </header>

      <section className="admin-overview-grid" aria-label="Vue d’ensemble réelle">
        <article className="admin-overview-card admin-overview-card--primary">
          <div><p>Commandes</p><strong>{overview.orders}</strong></div>
          <dl>
            <div><dt>À examiner</dt><dd>{overview.attention}</dd></div>
            <div><dt>En création</dt><dd>{overview.active}</dd></div>
            <div><dt>Livrées</dt><dd>{overview.delivered}</dd></div>
          </dl>
          <Link href="/admin/commandes">Gérer les commandes <span aria-hidden="true">→</span></Link>
        </article>

        <article className="admin-overview-card">
          <div><p>Catalogue public</p><strong>{overview.databaseProjects}</strong></div>
          <p>{overview.databaseProjects} projet{overview.databaseProjects === 1 ? "" : "s"} administré{overview.databaseProjects === 1 ? "" : "s"} dans PostgreSQL.</p>
          <Link href="/admin/catalogue">Administrer la discographie <span aria-hidden="true">→</span></Link>
        </article>

        <article className="admin-overview-card">
          <div><p>Projet actuellement mis en avant</p><strong className="admin-overview-card__title">{overview.featuredProject?.title ?? "Aucun projet sélectionné"}</strong></div>
          <p>La sélection d’accueil est persistée dans le catalogue et limitée à un seul projet.</p>
          <Link href={overview.featuredProject ? `/admin/catalogue/${overview.featuredProject.slug}` : "/admin/catalogue#mise-en-avant"}>Modifier la configuration <span aria-hidden="true">→</span></Link>
        </article>

        <article className="admin-overview-card">
          <div><p>Membres</p><strong>{overview.members}</strong></div>
          <p>{overview.members} compte{overview.members === 1 ? "" : "s"} actuellement accessible{overview.members === 1 ? "" : "s"} dans cet espace.</p>
          <Link href="/admin/membres">Voir les membres <span aria-hidden="true">→</span></Link>
        </article>
      </section>
    </div>
  );
}
