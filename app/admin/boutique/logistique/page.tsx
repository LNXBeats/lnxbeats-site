import type { Metadata } from "next";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { formatProductPrice } from "@/lib/shop/product-domain";
import { listAdminShippingRateVersions } from "@/lib/shop/shipping-service";
import { listAdminPackagingProfiles, SHOP_COMMERCIAL_RATE_ACTIVATION_CONFIRMATION } from "@/lib/shop/shipping-service";
import { activateCommercialShippingRateAction } from "@/app/admin/boutique/logistique/actions";
import { shopReadinessDashboard } from "@/lib/shop/readiness-scheduler";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Logistique Boutique · Administration" };

const STATUS_LABELS = {
  DRAFT: "Brouillon",
  ACTIVE: "Active en QA locale",
  ARCHIVED: "Archivée",
  RETIRED: "Retirée",
} as const;

export default async function AdminShopLogisticsPage() {
  await requireAdmin();
  const versions = await listAdminShippingRateVersions();
  const packagingProfiles = await listAdminPackagingProfiles();
  const readiness = await shopReadinessDashboard();
  return <div className="admin-main">
    <AdminBackLink href="/admin/boutique">Retour à la Boutique</AdminBackLink>
    <header className="admin-page-heading">
      <div><p className="admin-kicker">Boutique · Phase 5E</p><h1>Contrat de préparation Production.</h1></div>
      <p>La grille 2026 reste candidate tant qu’un Admin ne l’active pas explicitement. Aucun achat d’étiquette, appel transporteur ou changement Production n’est exécuté ici.</p>
    </header>

    <section className="admin-panel"><div className="admin-panel__heading"><div><p className="admin-section-label">Readiness</p><h2>Indicateurs fail-closed.</h2></div></div><dl className="admin-definition-grid"><div><dt>Grilles candidates</dt><dd>{readiness.draftRates}</dd></div><div><dt>Grilles commerciales actives</dt><dd>{readiness.activeRates}</dd></div><div><dt>Demandes client ouvertes</dt><dd>{readiness.openCustomerRequests}</dd></div><div><dt>Alertes opérateur</dt><dd>{readiness.alerts.length}</dd></div></dl>{readiness.alerts.length ? <ul className="admin-rights-timeline">{readiness.alerts.map((alert) => <li key={alert.id}><strong>{alert.kind}</strong><p>{alert.summary}</p></li>)}</ul> : <p>Aucune alerte ouverte dans la base QA.</p>}</section>

    <section className="admin-panel"><div className="admin-panel__heading"><div><p className="admin-section-label">Emballages</p><h2>Profils versionnés.</h2></div></div>{packagingProfiles.map((profile) => <dl className="admin-definition-grid" key={profile.id}><div><dt>Profil</dt><dd>{profile.name} · {profile.version}</dd></div><div><dt>Statut</dt><dd>{profile.status}</dd></div><div><dt>Poids physique</dt><dd>{profile.physicalWeightGrams} g</dd></div><div><dt>Capacité</dt><dd>{profile.maximumItemQuantity} articles</dd></div><div><dt>Facturé dans le poids client</dt><dd>{profile.customerBillableWeightIncluded ? "Oui" : "Non"}</dd></div></dl>)}</section>

    {versions.length ? <div className="admin-panel-stack">
      {versions.map((version) => <section className="admin-panel" key={version.id}>
        <div className="admin-panel__heading">
          <div><p className="admin-section-label">{STATUS_LABELS[version.status]}</p><h2>{version.version}</h2></div>
          <strong>{version.countryCode} · {version.currency}</strong>
        </div>
        <dl className="admin-definition-grid">
          <div><dt>Service interne</dt><dd>{version.service}</dd></div>
          <div><dt>Poids minimum</dt><dd>{version.minimumBillableWeightGrams} g</dd></div>
          <div><dt>Emballage physique</dt><dd>{version.packagingWeightGrams} g</dd></div>
          <div><dt>Poids facturable</dt><dd>{version.billableWeightPolicy === "PRODUCTS_ONLY" ? "Produits uniquement" : "Produits + emballage"}</dd></div>
          <div><dt>Périmètre</dt><dd>{version.scope === "COMMERCIAL_CANDIDATE" ? "Candidate France · activation Admin requise" : "QA interne non contractuelle"}</dd></div>
          {version.sourceLabel ? <div><dt>Source</dt><dd>{version.sourceLabel}</dd></div> : null}
        </dl>
        <div className="admin-list-window">
          <div className="admin-list-window__heading"><h3>Paliers</h3><span>{version.tiers.length}</span></div>
          <ol className="admin-rights-timeline admin-logistics-tier-list">
            {version.tiers.map((tier) => <li key={tier.id}>
              <div className="admin-rights-timeline__content">
                <strong>Jusqu’à {tier.maxWeightGrams} g</strong>
                <p>{formatProductPrice(tier.priceCents, version.currency)}</p>
              </div>
            </li>)}
          </ol>
        </div>
        {version.status === "DRAFT" && version.scope === "COMMERCIAL_CANDIDATE" ? <form className="admin-form" action={activateCommercialShippingRateAction}><input type="hidden" name="version" value={version.version} /><label className="admin-check"><input type="checkbox" name="confirmation" value={SHOP_COMMERCIAL_RATE_ACTIVATION_CONFIRMATION} required />Je confirme l’activation locale explicite de cette candidate et l’archivage de l’ancienne ACTIVE.</label><button className="admin-button" type="submit">ACTIVER CETTE GRILLE QA</button></form> : null}
      </section>)}
    </div> : <section className="admin-panel">
      <h2>Aucune grille QA installée.</h2>
      <p>Le checkout d’un produit expédiable reste fermé jusqu’à l’installation explicite d’une fixture locale valide.</p>
    </section>}
  </div>;
}
