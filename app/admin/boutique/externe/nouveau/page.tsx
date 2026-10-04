import type { Metadata } from "next";

import { createExternalProductAction } from "@/app/admin/boutique/externe/actions";
import { AdminBackLink } from "@/components/admin-back-link";
import { AdminExternalProductFields } from "@/components/admin-external-product-fields";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nouveau produit externe DistroKid" };

export default async function NewExternalProductPage({ searchParams }: { searchParams: Promise<{ etat?: string }> }) {
  await requireAdmin();
  const { etat } = await searchParams;
  return <div className="admin-main">
    <AdminBackLink href="/admin/boutique">Retour à la boutique</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-kicker">Produit externe DistroKid</p><h1>Préparer une mise en avant.</h1></div><p>DistroKid gère intégralement la vente. Aucun panier, stock ou paiement LNX n’est créé.</p></header>
    {etat ? <p className="admin-feedback" role="alert">Création refusée. Vérifiez l’URL DistroKid et les champs.</p> : null}
    <section className="admin-detail-window"><p className="admin-section-label">Fiche externe initiale</p><form className="admin-rights-detail" action={createExternalProductAction}><AdminExternalProductFields /><button className="admin-button" type="submit">Créer le brouillon externe</button></form></section>
  </div>;
}
