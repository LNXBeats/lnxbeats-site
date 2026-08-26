import type { Metadata } from "next";

import { AdminBackLink } from "@/components/admin-back-link";
import { CatalogCreateForm } from "@/components/catalog-create-form";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nouveau projet" };

export default async function AdminNewCatalogProjectPage({ searchParams }: { searchParams: Promise<{ etat?: string }> }) {
  await requireAdmin();
  const { etat } = await searchParams;

  return <div className="admin-main admin-catalogue-editor">
    <AdminBackLink href="/admin/catalogue">Retour au catalogue</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-kicker">Nouveau projet</p><h1>Ouvrir une nouvelle histoire.</h1></div><p>Commencez avec les faits disponibles. Le projet reste brouillon et masqué tant que vous ne choisissez pas explicitement de le publier.</p></header>
    {etat === "slug-occupe" ? <p className="admin-feedback" role="alert">Ce slug est déjà utilisé. Choisissez une adresse différente.</p> : etat === "position-occupee" ? <p className="admin-feedback" role="alert">Cette position catalogue est déjà utilisée. Laissez le champ vide pour ajouter le projet à la fin.</p> : etat === "creation-refusee" ? <p className="admin-feedback" role="alert">Création refusée. Vérifiez le statut, la visibilité, le jukebox et les valeurs saisies.</p> : null}
    <section className="admin-detail-window">
      <p className="admin-section-label">Informations initiales</p>
      <CatalogCreateForm />
    </section>
  </div>;
}
