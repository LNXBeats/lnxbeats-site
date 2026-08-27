import type { Metadata } from "next";

import { createProductAction } from "@/app/admin/boutique/actions";
import { AdminBackLink } from "@/components/admin-back-link";
import { AdminProductFields } from "@/components/admin-product-fields";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nouveau produit" };

export default async function AdminNewProductPage({ searchParams }: { searchParams: Promise<{ etat?: string }> }) {
  await requireAdmin();
  const { etat } = await searchParams;
  return <div className="admin-main">
    <AdminBackLink href="/admin/boutique">Retour à la boutique</AdminBackLink>
    <header className="admin-page-heading">
      <div><p className="admin-kicker">Nouveau produit</p><h1>Préparer une fiche.</h1></div>
      <p>Le produit sera créé en brouillon, jamais publié ni achetable automatiquement.</p>
    </header>
    {etat ? <p className="admin-feedback" role="alert">{etat === "slug-occupe" ? "Ce slug est déjà utilisé." : "Création refusée. Vérifiez les champs en centimes et les informations du produit."}</p> : null}
    <section className="admin-detail-window">
      <p className="admin-section-label">Fiche produit initiale</p>
      <form className="admin-rights-detail" action={createProductAction}>
        <AdminProductFields />
        <p className="admin-work-note">Les montants sont saisis en centimes entiers. Après création, ajoutez le visuel principal sur la fiche produit ; il sera obligatoire avant toute publication.</p>
        <button className="admin-button" type="submit">Créer le brouillon</button>
      </form>
    </section>
  </div>;
}
