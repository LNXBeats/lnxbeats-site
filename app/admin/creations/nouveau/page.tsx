import type { Metadata } from "next";

import { createCreationAction } from "@/app/admin/creations/actions";
import { AdminBackLink } from "@/components/admin-back-link";
import { AdminCreationFields } from "@/components/admin-creation-fields";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nouvelle création" };

export default async function AdminNewCreationPage({
  searchParams,
}: {
  searchParams: Promise<{ etat?: string }>;
}) {
  await requireAdmin();
  const { etat } = await searchParams;
  return <div className="admin-main">
    <AdminBackLink href="/admin/creations">Retour aux créations</AdminBackLink>
    <header className="admin-page-heading">
      <div><p className="admin-kicker">Nouvelle création</p><h1>Préparer une collaboration.</h1></div>
      <p>La fiche sera créée en brouillon. Aucun contenu ne devient public automatiquement.</p>
    </header>
    {etat ? <p className="admin-feedback" role="alert">
      {etat === "slug-occupe" ? "Ce slug est déjà utilisé." : "Création refusée. Vérifiez les informations de la fiche."}
    </p> : null}
    <section className="admin-detail-window">
      <p className="admin-section-label">Fiche initiale</p>
      <form className="admin-rights-detail" action={createCreationAction}>
        <AdminCreationFields />
        <p className="admin-work-note">Après création, ajoutez les médias avec l’outil dédié. La publication restera impossible tant que les médias ne sont pas publics et leurs droits validés.</p>
        <button className="admin-button" type="submit">Créer le brouillon</button>
      </form>
    </section>
  </div>;
}
