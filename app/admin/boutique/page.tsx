import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { AdminBackLink } from "@/components/admin-back-link";
import { AdminIcon } from "@/components/admin-icons";
import { AdminStatusBadge } from "@/components/admin-v21-ui";
import { requireAdmin } from "@/lib/auth/session";
import { formatProductPrice } from "@/lib/shop/product-domain";
import { listAdminProducts } from "@/lib/shop/product-service";
import { getShopAdminOperationalStatus, shopAdminOperationalLabel } from "@/lib/shop/admin-operational-status";

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
  const [products, operations] = await Promise.all([
    listAdminProducts(query, status),
    Promise.resolve(getShopAdminOperationalStatus()),
  ]);

  return <div className="admin-main">
    <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
    <header className="admin-page-heading">
      <div><p className="admin-kicker">Boutique</p><h1>Produits & disponibilité</h1></div>
      <div className="admin-page-heading__actions">
        <p>Les produits naissent en brouillon. Leur publication alimente la Boutique publique lorsque les guards opérationnels sont prêts.</p>
        <Link className="admin-primary-action" href="/admin/boutique/nouveau"><span aria-hidden="true">+</span> Nouveau produit</Link>
        <Link className="admin-row-action" href="/admin/boutique/logistique">Consulter la logistique <span aria-hidden="true">→</span></Link>
        {process.env.SHOP_AFTER_SALES_ENABLED === "true" ? <Link className="admin-row-action" href="/admin/boutique/retours">Consulter le SAV <span aria-hidden="true">→</span></Link> : null}
      </div>
    </header>

    <details className="admin-v21-technical-disclosure"><summary>Voir les diagnostics logistiques et opérationnels</summary><section className="admin-operations-strip" aria-label="État opérationnel de la Boutique">
      <div><span>Boutique publique</span><strong>{shopAdminOperationalLabel[operations.shop]}</strong></div>
      <div><span>Paiements</span><strong>{shopAdminOperationalLabel[operations.payments]}</strong></div>
      <div><span>Livraison</span><strong>{shopAdminOperationalLabel[operations.shipping]}</strong></div>
      <div><span>SAV financier</span><strong>{shopAdminOperationalLabel[operations.afterSales]}</strong></div>
      <div><span>Suivi</span><strong>{shopAdminOperationalLabel[operations.tracking]}</strong></div>
      <div><span>API transporteur</span><strong>{shopAdminOperationalLabel[operations.carrierApi]}</strong></div>
    </section></details>

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
      {products.length ? <ul className="admin-v21-entity-grid">
        {products.map((product) => <li key={product.id} className="admin-v21-entity-card">
          <div className="admin-v21-entity-card__main"><div className="admin-v21-entity-card__art">{product._count.assets > 0 ? <Image unoptimized src={`/api/admin/boutique/products/${product.id}/image`} width={92} height={92} alt="" /> : <AdminIcon name="box" />}</div><div><span className="admin-v21-entity-card__eyebrow">Produit · {product.slug}</span><h3><Link href={`/admin/boutique/${product.slug}`}>{product.title}</Link></h3><AdminStatusBadge label={STATUS_LABELS[product.status]} tone={product.status === "PUBLISHED" ? "ok" : product.status === "DRAFT" ? "attention" : "neutral"} /></div></div>
          <div className="admin-v21-product-facts"><strong>{formatProductPrice(product.priceCents, product.currency)}</strong><span>{product.trackInventory ? product.stock == null ? "Stock non renseigné" : `Stock enregistré : ${product.stock}` : "Stock non suivi"}</span><small>{product.shippingRequired ? product.shippingWeightGrams ? `Poids produit : ${product.shippingWeightGrams} g` : "Poids à renseigner" : "Sans expédition"}</small></div>
          <Link className="admin-v21-entity-card__action" href={`/admin/boutique/${product.slug}`}>Voir ou modifier <AdminIcon name="arrow" /></Link>
        </li>)}
      </ul> : <div className="admin-empty"><h2>Aucun produit.</h2><p>Créez un brouillon ou modifiez les filtres.</p></div>}
    </section>
  </div>;
}
