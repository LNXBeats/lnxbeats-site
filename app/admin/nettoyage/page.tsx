import type { Metadata } from "next";

import { AdminBackLink } from "@/components/admin-back-link";
import { AdminCleanupForm } from "@/components/admin-cleanup-form";
import { requireAdmin } from "@/lib/auth/session";
import { listAdminArchives, listAdminCleanupCandidates } from "@/lib/admin/cleanup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nettoyage & archives" };

const TYPE_LABELS = { MUSIC_ORDER: "Commande musicale", SHOP_ORDER: "Commande Boutique", RIGHTS_REQUEST: "Droits & contrats" } as const;

export default async function AdminCleanupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const query = await searchParams;
  const [candidates, archives] = await Promise.all([listAdminCleanupCandidates(), listAdminArchives()]);
  const state = typeof query.etat === "string" ? query.etat : "";
  return <main className="admin-main">
    <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-kicker">Opérations Admin</p><h1>Nettoyer les essais, sans effacer l’histoire.</h1></div><p>La classification s’appuie sur les relations métier. Un titre « QA » ou « test » ne suffit jamais à autoriser une suppression.</p></header>
    {state === "plan-applique" ? <>
      <p className="admin-feedback" role="status">Plan appliqué : {String(query.supprimes ?? "0")} suppression(s), {String(query.archives ?? "0")} archivage(s), {String(query.ignores ?? "0")} élément(s) ignoré(s).</p>
    </> : state ? <p className="admin-feedback" role="alert">Aucune mutation appliquée : la sélection, la confirmation ou la classification a changé.</p> : null}
    <section className="admin-panel" aria-labelledby="cleanup-preview-title">
      <div className="admin-panel__heading"><p className="admin-section-label">Prévisualisation</p><h2 id="cleanup-preview-title">Essais et dossiers détectés</h2></div>
      <p>Les commandes Boutique, paiements, factures, avoirs, remboursements et contrats ne sont jamais supprimés définitivement par cet outil.</p>
      <AdminCleanupForm candidates={candidates} />
    </section>
    <section className="admin-panel" aria-labelledby="archives-title">
      <div className="admin-panel__heading"><p className="admin-section-label">Archives</p><h2 id="archives-title">{archives.length} dossier{archives.length === 1 ? "" : "s"} hors des vues courantes</h2></div>
      {archives.length ? <ul className="admin-archive-list">{archives.map((archive) => <li key={archive.id}><strong>{archive.recordReference}</strong><span>{TYPE_LABELS[archive.recordType]} · {archive.archivedAt.toLocaleString("fr-FR")}</span><p>{archive.reason}</p></li>)}</ul> : <p>Aucun dossier archivé.</p>}
    </section>
  </main>;
}
