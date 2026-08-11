import type { Metadata } from "next";
import Link from "next/link";

import { homeEditorial } from "@/data/home";
import { getProjectBySlug } from "@/data/discography";
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
  const spotlight = getProjectBySlug(homeEditorial.spotlightProjectSlug);
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
          <div><p>Catalogue public</p><strong>{overview.localProjects}</strong></div>
          <p>{overview.localProjects} projet{overview.localProjects === 1 ? "" : "s"} dans le catalogue. L’édition sera activée lorsque le catalogue pourra être géré directement ici.</p>
          <Link href="/admin/catalogue">Auditer la discographie <span aria-hidden="true">→</span></Link>
        </article>

        <article className="admin-overview-card">
          <div><p>Projet actuellement mis en avant</p><strong className="admin-overview-card__title">{spotlight?.title ?? "Aucun projet sélectionné"}</strong></div>
          <p>La modification sera disponible depuis l’administration lorsque l’édition du catalogue sera activée.</p>
          <Link href="/admin/catalogue#mise-en-avant">Voir la configuration <span aria-hidden="true">→</span></Link>
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
