import type { Metadata } from "next";
import Link from "next/link";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { listAdminCatalogProjects } from "@/lib/catalog/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Catalogue" };

const statusLabels: Record<string, string> = { DRAFT: "Brouillon", IN_DEVELOPMENT: "En développement", PUBLISHED: "Publié", ARCHIVED: "Archivé" };

export default async function AdminCataloguePage({ searchParams }: { searchParams: Promise<{ q?: string; statut?: string; etat?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  const query = params.q ?? "";
  const status = params.statut ?? "all";
  const projects = await listAdminCatalogProjects(query, status);
  const featured = projects.find((project) => project.featured) ?? (await listAdminCatalogProjects()).find((project) => project.featured);

  return (
    <div className="admin-main">
      <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
      <header className="admin-page-heading"><div><p className="admin-kicker">Catalogue PostgreSQL</p><h1>La discographie, éditable.</h1></div><div className="admin-page-heading__actions"><p>Les pages publiques et cette administration lisent désormais la même source. Chaque enregistrement reste explicite et contrôlé.</p><Link className="admin-primary-action" href="/admin/catalogue/nouveau"><span aria-hidden="true">+</span> Nouveau projet</Link></div></header>

      {params.etat === "projet-supprime" ? <p className="admin-feedback" role="status">Projet supprimé définitivement.</p> : null}
      {params.etat === "projet-supprime-media-a-verifier" ? <p className="admin-feedback" role="alert">Projet supprimé. Un objet média orphelin devra être réconcilié par la procédure de stockage.</p> : null}

      <section className="admin-catalogue-notice" id="mise-en-avant">
        <div><p className="admin-section-label">Projet mis en avant sur l’accueil</p><h2>{featured?.title ?? "Aucun projet sélectionné"}</h2></div>
        <p>Une seule mise en avant peut être active. Le changement se fait depuis la fiche du projet et remplace l’ancienne sélection dans une transaction.</p>
      </section>

      <form className="admin-catalogue-filters" action="/admin/catalogue" method="get" role="search">
        <label><span>Rechercher</span><input name="q" defaultValue={query} maxLength={120} placeholder="Titre ou slug" /></label>
        <label><span>Statut</span><select name="statut" defaultValue={status}><option value="all">Tous</option><option value="PUBLISHED">Publié</option><option value="IN_DEVELOPMENT">En développement</option><option value="DRAFT">Brouillon</option><option value="ARCHIVED">Archivé</option></select></label>
        <button type="submit">Filtrer</button>
      </form>

      <section className="admin-list-window" aria-labelledby="catalogue-title">
        <div className="admin-list-window__heading"><h2 id="catalogue-title">Catalogue LNX Beats</h2><span>{projects.length} projet{projects.length === 1 ? "" : "s"}</span></div>
        {projects.length ? <ul className="admin-catalogue-list">
          {projects.map((project) => <li key={project.id}>
            <div><strong><Link href={`/admin/catalogue/${project.slug}`}>{project.title}</Link></strong><small>{project.slug} · {statusLabels[project.status]}</small></div>
            <dl>
              <div><dt>Type</dt><dd>{project.type === "ALBUM" ? "Album" : project.type === "SINGLE" ? "Single" : "Projet"}</dd></div>
              <div><dt>Cover</dt><dd>{project.assets.some(({ role }) => role === "COVER") ? "Officielle" : "Manquante"}</dd></div>
              <div><dt>Extrait</dt><dd>{project.assets.some(({ role }) => role === "AUDIO_PREVIEW") ? "✓" : "—"}</dd></div>
              <div><dt>Liens directs</dt><dd>{project._count.platformLinks}</dd></div>
              <div><dt>Tracklist</dt><dd>{project._count.tracks || project.trackCount || "Non documentée"}</dd></div>
            </dl>
            <Link className="admin-row-action" href={`/admin/catalogue/${project.slug}`}>Modifier <span aria-hidden="true">→</span></Link>
          </li>)}
        </ul> : <div className="admin-empty"><h2>Aucun projet ne correspond.</h2><p>Modifiez la recherche ou le filtre de statut.</p></div>}
      </section>
    </div>
  );
}
