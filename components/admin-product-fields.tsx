type ProductFieldValues = {
  slug?: string;
  title?: string;
  description?: string;
  priceCents?: number | null;
  trackInventory?: boolean;
  stock?: number | null;
  shippingRequired?: boolean;
  shippingPriceCents?: number;
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
    <label>
      <span>Titre</span>
      <input name="title" defaultValue={values.title ?? ""} maxLength={240} required />
    </label>
    <label>
      <span>Slug</span>
      <input
        name="slug"
        defaultValue={values.slug ?? ""}
        maxLength={160}
        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
        readOnly={slugReadOnly}
        aria-readonly={slugReadOnly || undefined}
        required
      />
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
      <span>Prix en centimes</span>
      <input name="priceCents" type="number" min={1} max={10_000_000} step={1} defaultValue={values.priceCents ?? ""} placeholder="2500 pour 25 €" />
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
      <span>Frais d’envoi en centimes</span>
      <input name="shippingPriceCents" type="number" min={0} max={1_000_000} step={1} defaultValue={values.shippingPriceCents ?? 0} />
    </label>
  </div>;
}
