import { centsToAdminInput } from "@/lib/pricing/domain";

type Values = { title?: string; providerLabel?: string; externalUrl?: string; priceCents?: number | null; position?: number };

export function AdminExternalProductFields({ values = {} }: { values?: Values }) {
  return <div className="admin-field-grid">
    <label><span>Type</span><input value="Produit externe DistroKid" readOnly aria-readonly="true" /></label>
    <label><span>Nom</span><input name="title" defaultValue={values.title ?? ""} maxLength={240} required /></label>
    <label><span>Ordre d’affichage</span><input name="position" type="number" min={0} max={1_000_000} step={1} defaultValue={values.position ?? 0} required /></label>
    <label><span>Libellé externe</span><input name="providerLabel" defaultValue={values.providerLabel ?? "PRODUIT DÉRIVÉ · DISTROKID"} maxLength={80} required /></label>
    <label style={{ gridColumn: "1 / -1" }}><span>URL directe DistroKid</span><input name="externalUrl" type="url" inputMode="url" placeholder="https://direct.distrokid.com/…" defaultValue={values.externalUrl ?? ""} required /></label>
    <label><span>Prix indicatif</span><span className="admin-money-field"><input name="price" type="text" inputMode="decimal" defaultValue={values.priceCents == null ? "" : centsToAdminInput(values.priceCents)} placeholder="17,00" /><span className="admin-money-field__currency" aria-hidden="true">€</span></span><small>Facultatif. DistroKid reste la source de vérité.</small></label>
    <label><span>Devise</span><input value="EUR" readOnly aria-readonly="true" /><input type="hidden" name="currency" value="EUR" /></label>
  </div>;
}
