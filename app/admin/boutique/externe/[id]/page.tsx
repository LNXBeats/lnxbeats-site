import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  archiveExternalProductAction,
  publishExternalProductAction,
  unpublishExternalProductAction,
  updateExternalProductAction,
} from "@/app/admin/boutique/externe/actions";
import { AdminBackLink } from "@/components/admin-back-link";
import { AdminExternalProductFields } from "@/components/admin-external-product-fields";
import { AdminProductImageForm } from "@/components/admin-product-image-form";
import { requireAdmin } from "@/lib/auth/session";
import {
  EXTERNAL_PRODUCT_ACTION_CONFIRMATIONS,
  externalProductPublicationBlockers,
  formatExternalProductPrice,
  parseExternalProductIdentity,
} from "@/lib/shop/external-product-domain";
import { getAdminExternalProduct } from "@/lib/shop/external-product-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Produit externe DistroKid · Administration" };
const STATUS = { DRAFT: "Brouillon", PUBLISHED: "Visible", ARCHIVED: "Archivé" } as const;
const ACTION = { CREATED: "Produit externe créé", UPDATED: "Fiche externe modifiée", PUBLISHED: "Produit externe rendu visible", UNPUBLISHED: "Produit externe masqué", ARCHIVED: "Produit externe archivé", STOCK_ADJUSTED: "Stock ajusté" } as const;
const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

export default async function ExternalProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ etat?: string }> }) {
  await requireAdmin();
  const [{ id: rawId }, { etat }] = await Promise.all([params, searchParams]);
  let id: string;
  try { id = parseExternalProductIdentity(rawId); } catch { notFound(); }
  const product = await getAdminExternalProduct(id);
  if (!product) notFound();
  const blockers = externalProductPublicationBlockers(product);
  const editable = product.status !== "ARCHIVED";
  return <div className="admin-main admin-rights-detail">
    <AdminBackLink href="/admin/boutique">Retour à la boutique</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-kicker">Produit externe DistroKid · {STATUS[product.status]}</p><h1>{product.title}</h1></div><p>{formatExternalProductPrice(product.priceCents, product.currency)} · position {product.position} · aucun stock LNX · version {product.lockVersion}</p></header>
    {etat ? <p className="admin-feedback" role={etat === "operation-refusee" || etat === "conflit" ? "alert" : "status"}>{etat === "produit-cree" ? "Le brouillon externe a été créé." : etat === "produit-enregistre" ? "La fiche externe a été enregistrée." : etat === "produit-publie" ? "Le produit externe est visible." : etat === "produit-depublie" ? "Le produit externe est masqué." : etat === "produit-archive" ? "Le produit externe est archivé." : "Opération refusée sans modification."}</p> : null}
    <section className="admin-panel"><div className="admin-panel__heading"><h2>Fiche externe</h2></div>{editable ? <form action={updateExternalProductAction} className="admin-rights-detail"><input type="hidden" name="productId" value={product.id} /><input type="hidden" name="lockVersion" value={product.lockVersion} /><AdminExternalProductFields values={product} /><p className="admin-work-note">Le lien est limité à HTTPS sur direct.distrokid.com. La vente, les taxes, la livraison et le paiement restent chez DistroKid.</p><button className="admin-button" type="submit">Enregistrer la fiche</button></form> : <p className="admin-alert">Cette fiche est archivée et conservée en lecture seule.</p>}</section>
    <section className="admin-panel"><div className="admin-panel__heading"><h2>Visuel du produit externe</h2></div><AdminProductImageForm endpoint={`/api/admin/boutique/external-products/${encodeURIComponent(product.id)}/image`} productId={product.id} lockVersion={product.lockVersion} productTitle={product.title} status={product.status} initialState={etat} currentImage={product.image ? { id: product.image.id, filename: product.image.filename, mimeType: product.image.mimeType, sizeBytes: product.image.sizeBytes.toString(), width: product.image.width, height: product.image.height, alt: product.image.alt ?? "", updatedAt: product.image.updatedAt.toISOString() } : null} /></section>
    <section className="admin-panel"><div className="admin-panel__heading"><h2>Visibilité</h2></div>{blockers.length ? <p className="admin-alert">Publication fermée : {blockers.includes("IMAGE_MISSING") ? "visuel public avec texte alternatif requis" : "fiche invalide"}.</p> : null}{editable ? <div className="admin-action-row">{product.status === "DRAFT" ? <form action={publishExternalProductAction}><input type="hidden" name="productId" value={product.id} /><input type="hidden" name="lockVersion" value={product.lockVersion} /><label className="admin-check"><input type="checkbox" name="confirmation" value={EXTERNAL_PRODUCT_ACTION_CONFIRMATIONS.publish} required /><span>Je confirme l’affichage de ce produit externe.</span></label><button className="admin-button" type="submit" disabled={blockers.length > 0}>Rendre visible</button></form> : <form action={unpublishExternalProductAction}><input type="hidden" name="productId" value={product.id} /><input type="hidden" name="lockVersion" value={product.lockVersion} /><label className="admin-check"><input type="checkbox" name="confirmation" value={EXTERNAL_PRODUCT_ACTION_CONFIRMATIONS.unpublish} required /><span>Je confirme le masquage de ce produit externe.</span></label><button className="admin-button admin-button--quiet" type="submit">Masquer</button></form>}<form action={archiveExternalProductAction}><input type="hidden" name="productId" value={product.id} /><input type="hidden" name="lockVersion" value={product.lockVersion} /><label className="admin-check"><input type="checkbox" name="confirmation" value={EXTERNAL_PRODUCT_ACTION_CONFIRMATIONS.archive} required /><span>Je confirme l’archivage de cette fiche externe.</span></label><button className="admin-button admin-button--danger" type="submit">Archiver</button></form></div> : null}</section>
    <section className="admin-panel"><div className="admin-panel__heading"><h2>Journal d’audit</h2></div><ol className="admin-rights-timeline">{product.auditEvents.map((event) => <li key={event.id}><time className="admin-rights-timeline__when" dateTime={event.occurredAt.toISOString()}>{DATE.format(event.occurredAt)}</time><div className="admin-rights-timeline__content"><strong>{ACTION[event.action]}</strong></div><small className="admin-rights-timeline__actor">{event.actorAdmin?.displayName || "Administrateur supprimé"}</small></li>)}</ol></section>
  </div>;
}
