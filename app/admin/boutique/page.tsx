import type { Metadata } from "next";
import Link from "next/link";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { formatProductPrice } from "@/lib/shop/product-domain";
import { listAdminProducts } from "@/lib/shop/product-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Boutique · Administration" };

const STATUS_LABELS = { DRAFT: "Brouillon", PUBLISHED: "Publié", ARCHIVED: "Archivé" } as const;

export default async function AdminShopPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; statut?: string; etat?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const query = params.q ?? "";
  const status = params.statut ?? "all";
  const products = await listAdminProducts(query, status);

  return <div className="admin-main">
    <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
    <header className="admin-page-heading">
      <div><p className="admin-kicker">Boutique</p><h1>Les produits, sous contrôle.</h1></div>
      <div className="admin-page-heading__actions">
        <p>Les produits naissent en brouillon. La publication alimente la Boutique QA ; le paiement produit reste volontairement désactivé.</p>
        <Link className="admin-primary-action" href="/admin/boutique/nouveau"><span aria-hidden="true">+</span> Nouveau produit</Link>
        <Link className="admin-row-action" href="/admin/boutique/logistique">Consulter la logistique <span aria-hidden="true">→</span></Link>
      </div>
    </header>

    {params.etat ? <p className="admin-feedback" role="alert">
      {params.etat === "conflit" ? "La fiche a changé dans un autre onglet. Rechargez-la avant de recommencer."
        : params.etat === "slug-occupe" ? "Ce slug est déjà utilisé."
          : params.etat === "slug-immuable" ? "Le slug d’un produit existant ne peut pas être modifié."
          : params.etat === "confirmation-requise" ? "Confirmez explicitement cette action sensible avant de continuer."
          : params.etat === "publication-incomplete" ? "Publication refusée : la fiche, le prix, le poids logistique et au moins une image publique sont requis."
          : params.etat === "stock-reserve" ? "Opération refusée : le stock doit couvrir toutes les réservations actives."
            : "L’opération a été refusée sans modifier le produit."}
    </p> : null}

    <form className="admin-catalogue-filters" action="/admin/boutique" method="get" role="search">
      <label><span>Rechercher</span><input name="q" defaultValue={query} maxLength={120} placeholder="Titre ou slug" /></label>
      <label><span>Statut</span><select name="statut" defaultValue={status}>
        <option value="all">Tous</option><option value="DRAFT">Brouillons</option><option value="PUBLISHED">Publiés</option><option value="ARCHIVED">Archivés</option>
      </select></label>
      <button type="submit">Filtrer</button>
    </form>

    <section className="admin-list-window" aria-labelledby="products-title">
      <div className="admin-list-window__heading"><h2 id="products-title">Produits</h2><span>{products.length} produit{products.length === 1 ? "" : "s"}</span></div>
      {products.length ? <ul className="admin-catalogue-list">
        {products.map((product) => <li key={product.id}>
          <div><strong><Link href={`/admin/boutique/${product.slug}`}>{product.title}</Link></strong><small>{product.slug} · {STATUS_LABELS[product.status]}</small></div>
          <dl>
            <div><dt>Prix</dt><dd>{formatProductPrice(product.priceCents, product.currency)}</dd></div>
            <div><dt>Stock</dt><dd>{product.trackInventory ? product.stock ?? 0 : "Non suivi"}</dd></div>
            <div><dt>Images</dt><dd>{product._count.assets}</dd></div>
            <div><dt>Expédition</dt><dd>{product.shippingRequired ? product.shippingWeightGrams ? `${product.shippingWeightGrams} g · devis serveur` : "Poids à renseigner" : "Non"}</dd></div>
          </dl>
          <Link className="admin-row-action" href={`/admin/boutique/${product.slug}`}>Modifier <span aria-hidden="true">→</span></Link>
        </li>)}
      </ul> : <div className="admin-empty"><h2>Aucun produit.</h2><p>Créez un brouillon ou modifiez les filtres.</p></div>}
    </section>
  </div>;
}
