import { centsToAdminInput } from "@/lib/pricing/domain";
import { merchantMpnForProductSlug } from "@/lib/merchant/product-feed";
import type { MerchantMetadata } from "@/lib/merchant/metadata";

type ProductFieldValues = MerchantMetadata & {
  slug?: string;
  title?: string;
  description?: string;
  priceCents?: number | null;
  trackInventory?: boolean;
  stock?: number | null;
  shippingRequired?: boolean;
  shippingPriceCents?: number;
  shippingWeightGrams?: number | null;
  position?: number;
};

export function AdminProductFields({
  values = {},
  slugReadOnly = false,
}: {
  values?: ProductFieldValues;
  slugReadOnly?: boolean;
}) {
  return <div className="admin-field-grid">
    <details style={{ gridColumn: "1 / -1" }}>
      <summary>Informations Google Merchant</summary>
      <p>Les produits physiques publiés et renseignés rejoignent automatiquement le flux. Utilisez uniquement les références réelles du fabricant ; aucun code n’est inventé.</p>
      <label><span>Référence fabricant (MPN)</span><input name="merchantMpn" maxLength={70} defaultValue={values.merchantMpn ?? merchantMpnForProductSlug(values.slug ?? "") ?? ""} readOnly={Boolean(merchantMpnForProductSlug(values.slug ?? ""))} /></label>
      <label><span>GTIN / EAN réel (facultatif)</span><input name="merchantGtin" inputMode="numeric" maxLength={14} defaultValue={values.merchantGtin ?? ""} /></label>
      <label><span>Couleur commerciale réelle</span><input name="merchantColor" maxLength={100} defaultValue={values.merchantColor ?? ""} /></label>
      <label><span>Existence d’identifiants fabricant</span><select name="merchantIdentifiersAbsent" defaultValue={values.merchantIdentifiersAbsent ? "on" : "false"} disabled={Boolean(merchantMpnForProductSlug(values.slug ?? ""))}>
        <option value="false">Identifiants renseignés ci-dessus, ou à vérifier</option>
        <option value="on">Je confirme qu’aucun identifiant fabricant n’existe</option>
      </select></label>
      <small>Sans référence vérifiée ni confirmation d’absence, le produit reste exclu du flux Google. La Boutique continue de fonctionner normalement.</small>
    </details>
    <label>
      <span>Titre</span>
      <input name="title" defaultValue={values.title ?? ""} maxLength={240} required />
    </label>
    <label className={slugReadOnly ? undefined : "admin-advanced-slug"}>
      <span>{slugReadOnly ? "Adresse publique stable" : "Adresse personnalisée (facultatif)"}</span>
      <input
        name="slug"
        defaultValue={values.slug ?? ""}
        maxLength={160}
        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
        readOnly={slugReadOnly}
        aria-readonly={slugReadOnly || undefined}
        required={slugReadOnly}
      />
      {!slugReadOnly ? <small>Vide : adresse créée automatiquement depuis le titre.</small> : null}
    </label>
    <label>
      <span>Position</span>
      <input name="position" type="number" min={0} max={1_000_000} step={1} defaultValue={values.position ?? 0} required />
    </label>
    <label style={{ gridColumn: "1 / -1" }}>
      <span>Description</span>
      <textarea name="description" defaultValue={values.description ?? ""} maxLength={10_000} rows={8} required />
    </label>
    <label>
      <span>Prix</span>
      <span className="admin-money-field">
        <input
          name="price"
          type="text"
          inputMode="decimal"
          defaultValue={values.priceCents === null || values.priceCents === undefined ? "" : centsToAdminInput(values.priceCents)}
          placeholder="25,00"
          aria-describedby="admin-product-price-help"
        />
        <span className="admin-money-field__currency" aria-hidden="true">€</span>
      </span>
      <small id="admin-product-price-help" className="admin-field-help">Montant en euros, avec deux décimales au maximum. Peut rester vide en brouillon.</small>
    </label>
    <label>
      <span>Devise</span>
      <input value="EUR" readOnly aria-readonly="true" />
      <input type="hidden" name="currency" value="EUR" />
    </label>
    <label>
      <span>Stock initial / actuel</span>
      <input name="stock" type="number" min={0} max={1_000_000} step={1} defaultValue={values.stock ?? 0} />
    </label>
    <label className="admin-check">
      <input name="trackInventory" type="checkbox" defaultChecked={values.trackInventory ?? false} />
      <span>Suivre le stock</span>
    </label>
    <label className="admin-check">
      <input name="shippingRequired" type="checkbox" defaultChecked={values.shippingRequired ?? false} />
      <span>Expédition requise</span>
    </label>
    <label>
      <span>Poids logistique</span>
      <span className="admin-money-field">
        <input
          name="shippingWeightGrams"
          type="number"
          inputMode="numeric"
          min={1}
          max={30_000}
          step={1}
          defaultValue={values.shippingWeightGrams ?? ""}
          placeholder="250"
          aria-describedby="admin-product-shipping-weight-help"
        />
        <span className="admin-money-field__currency" aria-hidden="true">g</span>
      </span>
      <small id="admin-product-shipping-weight-help" className="admin-field-help">Obligatoire avant publication pour un produit expédiable. Aucun poids fictif n’est appliqué.</small>
    </label>
    <label>
      <span>Ancien frais fixe</span>
      <span className="admin-money-field">
        <input
          name="shippingPrice"
          type="text"
          inputMode="decimal"
          defaultValue={centsToAdminInput(values.shippingPriceCents ?? 0)}
          placeholder="5,00"
          aria-describedby="admin-product-shipping-help"
        />
        <span className="admin-money-field__currency" aria-hidden="true">€</span>
      </span>
      <small id="admin-product-shipping-help" className="admin-field-help">Compatibilité historique uniquement. Les nouvelles commandes Phase 5A utilisent le devis serveur versionné et ne cumulent jamais ce montant.</small>
    </label>
  </div>;
}
