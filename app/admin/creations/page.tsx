import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { AdminBackLink } from "@/components/admin-back-link";
import { AdminIcon } from "@/components/admin-icons";
import { AdminProgress, AdminStatusBadge } from "@/components/admin-v21-ui";
import { requireAdmin } from "@/lib/auth/session";
import { listAdminCreations } from "@/lib/creations/service";
import { getAdminCatalogPage } from "@/lib/catalog/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Créations · Administration" };

const STATUS_LABELS = { DRAFT: "Brouillon", PUBLISHED: "Publié", ARCHIVED: "Archivé" } as const;

export default async function AdminCreationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; statut?: string; etat?: string; page?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const query = params.q ?? "";
  const status = params.statut ?? "all";
  const requestedPage = /^\d+$/.test(params.page ?? "") ? Number(params.page) : 1;
  const [catalogue, discography] = await Promise.all([
    listAdminCreations(query, status, requestedPage),
    getAdminCatalogPage("", "all", 1),
  ]);

  const pageHref = (page: number) => {
    const values = new URLSearchParams();
    if (query) values.set("q", query);
    if (status !== "all") values.set("statut", status);
    if (page > 1) values.set("page", String(page));
    const suffix = values.toString();
    return suffix ? `/admin/creations?${suffix}` : "/admin/creations";
  };

  return <div className="admin-main">
    <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
    <header className="admin-page-heading">
      <div><p className="admin-kicker">Créations & collaborations</p><h1>Créations multimédia</h1></div>
      <div className="admin-page-heading__actions">
        <p>Chaque création démarre en brouillon. La publication reste bloquée sans résumé et média public aux droits validés.</p>
        <Link className="admin-primary-action" href="/admin/creations/nouveau"><span aria-hidden="true">+</span> Nouvelle création</Link>
      </div>
    </header>

    <nav className="admin-v2-section-hub" aria-label="Espaces de création">
      <Link href="/admin/creations" aria-current="page"><strong>Créations & collaborations</strong><span>{catalogue.counts.PUBLISHED} publiées · {catalogue.counts.DRAFT} brouillons · médias et collaborateurs</span></Link>
      <Link href="/admin/catalogue"><strong>Catalogue & discographie</strong><span>{discography.total} projets · albums, singles, tracklists et jukebox</span></Link>
    </nav>

    {params.etat ? <p className="admin-feedback" role="alert">
      {params.etat === "conflit" ? "La fiche a changé dans un autre onglet. Rechargez-la avant de recommencer."
        : params.etat === "slug-occupe" ? "Ce slug est déjà utilisé."
          : params.etat === "slug-immuable" ? "Le slug d’une création existante ne peut pas être modifié."
            : params.etat === "publication-incomplete" ? "Publication refusée : renseignez le résumé, le média principal et des médias publics aux droits validés."
              : params.etat === "depublication-requise" ? "Dépubliez la création avant de l’archiver."
                : "L’opération a été refusée sans modifier la création."}
    </p> : null}

    <form className="admin-catalogue-filters" action="/admin/creations" method="get" role="search">
      <label><span>Rechercher</span><input name="q" defaultValue={query} maxLength={120} placeholder="Titre, slug ou collaborateur" /></label>
      <label><span>Statut</span><select name="statut" defaultValue={status}>
        <option value="all">Tous ({Object.values(catalogue.counts).reduce((sum, count) => sum + count, 0)})</option>
        <option value="PUBLISHED">Publiés ({catalogue.counts.PUBLISHED})</option>
        <option value="DRAFT">Brouillons ({catalogue.counts.DRAFT})</option>
        <option value="ARCHIVED">Archivés ({catalogue.counts.ARCHIVED})</option>
      </select></label>
      <button type="submit">Filtrer</button>
    </form>

    <section className="admin-list-window" aria-labelledby="creations-title">
      <div className="admin-list-window__heading">
        <h2 id="creations-title">Créations</h2>
        <span>{catalogue.total} création{catalogue.total === 1 ? "" : "s"} · page {catalogue.page}/{catalogue.pageCount}</span>
      </div>
      {catalogue.creations.length ? <ul className="admin-v21-entity-grid">
        {catalogue.creations.map((creation) => {
          const cover = creation.assets.find((asset) => asset.role === "COVER");
          const audio = creation.assets.filter((asset) => asset.role === "AUDIO").length;
          const video = creation.assets.filter((asset) => asset.role === "VIDEO").length;
          const collaborators = creation._count.collaborators || (creation.collaborator ? 1 : 0);
          const filled = [creation.summary, creation.category, cover, audio + video > 0, collaborators > 0, creation._count.externalLinks > 0, creation.seoTitle && creation.seoDescription].filter(Boolean).length;
          return <li key={creation.id} className="admin-v21-entity-card">
            <div className="admin-v21-entity-card__main">
              <div className="admin-v21-entity-card__art">{cover ? <Image unoptimized src={`/api/admin/creations/media/${cover.assetId}`} width={92} height={92} alt="" /> : <AdminIcon name="music" />}</div>
              <div><span className="admin-v21-entity-card__eyebrow">{creation.category || "Catégorie non renseignée"}</span><h3><Link href={`/admin/creations/${creation.slug}`}>{creation.title}</Link></h3><AdminStatusBadge label={STATUS_LABELS[creation.status]} tone={creation.status === "PUBLISHED" ? "ok" : creation.status === "DRAFT" ? "attention" : "neutral"} /></div>
            </div>
            <div className="admin-v21-entity-card__facts"><span><AdminIcon name="audio" /> {audio} audio</span><span><AdminIcon name="video" /> {video} vidéo</span><span><AdminIcon name="users" /> {collaborators}</span><span><AdminIcon name="link" /> {creation._count.externalLinks}</span></div>
            <AdminProgress label="Fiche renseignée · 7 critères éditoriaux" value={filled / 7 * 100} />
            <Link className="admin-v21-entity-card__action" href={`/admin/creations/${creation.slug}`}>Modifier la fiche <AdminIcon name="arrow" /></Link>
          </li>;
        })}
      </ul> : <div className="admin-empty"><h2>Aucune création.</h2><p>Créez un brouillon ou modifiez les filtres.</p></div>}
      {catalogue.pageCount > 1 ? <nav className="admin-pagination" aria-label="Pagination des créations">
        {catalogue.page > 1 ? <Link href={pageHref(catalogue.page - 1)}>← Précédente</Link> : <span aria-disabled="true">← Précédente</span>}
        <span>Page {catalogue.page} sur {catalogue.pageCount}</span>
        {catalogue.page < catalogue.pageCount ? <Link href={pageHref(catalogue.page + 1)}>Suivante →</Link> : <span aria-disabled="true">Suivante →</span>}
      </nav> : null}
    </section>
  </div>;
}
