import type { Metadata } from "next";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { formatProductPrice } from "@/lib/shop/product-domain";
import { listAdminShippingRateVersions } from "@/lib/shop/shipping-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Logistique Boutique · Administration" };

const STATUS_LABELS = {
  DRAFT: "Brouillon",
  ACTIVE: "Active en QA locale",
  RETIRED: "Retirée",
} as const;

export default async function AdminShopLogisticsPage() {
  await requireAdmin();
  const versions = await listAdminShippingRateVersions();
  return <div className="admin-main">
    <AdminBackLink href="/admin/boutique">Retour à la Boutique</AdminBackLink>
    <header className="admin-page-heading">
      <div><p className="admin-kicker">Boutique · Phase 5A</p><h1>Logistique versionnée.</h1></div>
      <p>Consultation uniquement. Ces grilles sont des fixtures internes de QA : aucun tarif La Poste, achat d’étiquette ou suivi automatique n’est actif.</p>
    </header>

    {versions.length ? <div className="admin-panel-stack">
      {versions.map((version) => <section className="admin-panel" key={version.id}>
        <div className="admin-panel__heading">
          <div><p className="admin-section-label">{STATUS_LABELS[version.status]}</p><h2>{version.version}</h2></div>
          <strong>{version.countryCode} · {version.currency}</strong>
        </div>
        <dl className="admin-definition-grid">
          <div><dt>Service interne</dt><dd>{version.service}</dd></div>
          <div><dt>Poids minimum</dt><dd>{version.minimumBillableWeightGrams} g</dd></div>
          <div><dt>Emballage QA</dt><dd>{version.packagingWeightGrams} g</dd></div>
          <div><dt>Périmètre</dt><dd>QA interne non contractuelle</dd></div>
        </dl>
        <div className="admin-list-window">
          <div className="admin-list-window__heading"><h3>Paliers</h3><span>{version.tiers.length}</span></div>
          <ol className="admin-rights-timeline">
            {version.tiers.map((tier) => <li key={tier.id}>
              <div className="admin-rights-timeline__content">
                <strong>Jusqu’à {tier.maxWeightGrams} g</strong>
                <p>{formatProductPrice(tier.priceCents, version.currency)}</p>
              </div>
            </li>)}
          </ol>
        </div>
      </section>)}
    </div> : <section className="admin-panel">
      <h2>Aucune grille QA installée.</h2>
      <p>Le checkout d’un produit expédiable reste fermé jusqu’à l’installation explicite d’une fixture locale valide.</p>
    </section>}
  </div>;
}
