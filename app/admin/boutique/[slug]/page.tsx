import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  adjustProductStockAction,
  archiveProductAction,
  publishProductAction,
  unpublishProductAction,
  updateProductAction,
} from "@/app/admin/boutique/actions";
import { AdminBackLink } from "@/components/admin-back-link";
import { AdminProductImageForm } from "@/components/admin-product-image-form";
import { AdminProductFields } from "@/components/admin-product-fields";
import { requireAdmin } from "@/lib/auth/session";
import {
  countPublishableProductImages,
  formatProductPrice,
  getProductPublicationBlockers,
  PRODUCT_ACTION_CONFIRMATIONS,
} from "@/lib/shop/product-domain";
import { getAdminProduct } from "@/lib/shop/product-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Produit · Administration" };

const STATUS_LABELS = { DRAFT: "Brouillon", PUBLISHED: "Publié", ARCHIVED: "Archivé" } as const;
const PUBLICATION_BLOCKER_LABELS: Record<string, string> = {
  TITLE_MISSING: "titre manquant",
  DESCRIPTION_MISSING: "description manquante",
  PRICE_INVALID: "prix invalide",
  CURRENCY_INVALID: "devise invalide",
  STOCK_INVALID: "stock invalide",
  SHIPPING_INCOHERENT: "expédition incohérente",
  SHIPPING_INVALID: "frais d’envoi invalides",
  IMAGE_MISSING: "visuel principal public avec texte alternatif requis",
};
const ACTION_LABELS = {
  CREATED: "Produit créé",
  UPDATED: "Fiche modifiée",
  PUBLISHED: "Produit publié",
  UNPUBLISHED: "Produit dépublié",
  ARCHIVED: "Produit archivé",
  STOCK_ADJUSTED: "Stock ajusté",
} as const;
const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

function Feedback({ state }: { state?: string }) {
  const message = state === "produit-cree" ? "Le brouillon produit a été créé."
    : state === "produit-enregistre" ? "La fiche produit a été enregistrée."
      : state === "produit-publie" ? "Le produit a été publié."
        : state === "produit-depublie" ? "Le produit est revenu en brouillon."
          : state === "produit-archive" ? "Le produit a été archivé."
            : state === "stock-ajuste" ? "Stock mis à jour."
              : state === "confirmation-requise" ? "Confirmez explicitement l’ajustement de stock."
                : state === "conflit" ? "Le stock a changé dans un autre onglet. Rechargez la page avant de recommencer."
                  : state === "stock-reserve" ? "Opération refusée : le stock doit couvrir toutes les réservations actives."
                  : state === "operation-refusee" ? "Ajustement refusé. Vérifiez la quantité et le motif."
                    : null;
  const isError = state === "confirmation-requise" || state === "conflit" || state === "stock-reserve" || state === "operation-refusee";
  return message ? <p className="admin-feedback" role={isError ? "alert" : "status"}>{message}</p> : null;
}

export default async function AdminProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ etat?: string }>;
}) {
  await requireAdmin();
  const [{ slug }, { etat }] = await Promise.all([params, searchParams]);
  const product = await getAdminProduct(slug);
  if (!product) notFound();
  const publicationBlockers = getProductPublicationBlockers({
    ...product,
    assetCount: countPublishableProductImages(product.assets.filter(({ position }) => position === 0).map(({ asset }) => asset)),
  });
  const editable = product.status !== "ARCHIVED";
  const primaryImageRelation = product.assets.find(({ position }) => position === 0) ?? null;

  return <div className="admin-main admin-rights-detail">
    <AdminBackLink href="/admin/boutique">Retour à la boutique</AdminBackLink>
    <header className="admin-page-heading">
      <div><p className="admin-kicker">Produit · {STATUS_LABELS[product.status]}</p><h1>{product.title}</h1></div>
      <p>{formatProductPrice(product.priceCents, product.currency)} · {product.trackInventory ? `${product.stock ?? 0} physique · ${product.activeReservedQuantity} réservé · ${product.availableQuantity ?? 0} disponible` : "Stock non suivi"} · version {product.lockVersion}</p>
    </header>
    <Feedback state={etat} />

    <section className="admin-panel">
      <div className="admin-panel__heading"><h2>Fiche produit</h2></div>
      {editable ? <form action={updateProductAction} className="admin-rights-detail">
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="lockVersion" value={product.lockVersion} />
        <AdminProductFields values={product} slugReadOnly />
        <label className="admin-check">
          <input type="checkbox" name="confirmation" value={PRODUCT_ACTION_CONFIRMATIONS.stock} />
          <span>Je confirme toute modification du suivi de stock ou de sa quantité.</span>
        </label>
        <p className="admin-work-note">Une sauvegarde concurrente sera refusée grâce à la version de cette fiche. Les montants saisis en euros restent stockés en centimes entiers.</p>
        <button className="admin-button" type="submit">Enregistrer la fiche</button>
      </form> : <p className="admin-alert">Ce produit est archivé et conservé en lecture seule pour l’audit.</p>}
    </section>

    <section className="admin-panel">
      <div className="admin-panel__heading"><h2>Visuel du produit</h2></div>
      <p className="admin-work-note">Une image principale suffit. Elle est stockée via le même MediaStorage que le catalogue et devient visible dans la Boutique QA uniquement après publication.</p>
      <AdminProductImageForm
        productId={product.id}
        lockVersion={product.lockVersion}
        productTitle={product.title}
        status={product.status}
        initialState={etat}
        currentImage={primaryImageRelation ? {
          id: primaryImageRelation.asset.id,
          filename: primaryImageRelation.asset.filename,
          mimeType: primaryImageRelation.asset.mimeType,
          sizeBytes: primaryImageRelation.asset.sizeBytes.toString(),
          width: primaryImageRelation.asset.width,
          height: primaryImageRelation.asset.height,
          alt: primaryImageRelation.asset.alt ?? "",
          updatedAt: primaryImageRelation.asset.updatedAt.toISOString(),
        } : null}
      />
    </section>

    <section className="admin-panel">
      <div className="admin-panel__heading"><h2>Publication</h2></div>
      <p className="admin-work-note">La publication rend le produit visible uniquement lorsque la Boutique QA est explicitement armée. Le paiement produit reste désactivé ; une fiche cohérente, un prix positif et un visuel principal public admissible restent obligatoires.</p>
      {publicationBlockers.length ? <p className="admin-alert" role="status">Publication fermée : {publicationBlockers.map((blocker) => PUBLICATION_BLOCKER_LABELS[blocker] ?? "fiche incomplète").join(" · ")}</p> : null}
      {editable ? <div className="admin-action-row">
        {product.status === "DRAFT" ? <form action={publishProductAction}>
          <input type="hidden" name="productId" value={product.id} /><input type="hidden" name="lockVersion" value={product.lockVersion} />
          <label className="admin-check">
            <input type="checkbox" name="confirmation" value={PRODUCT_ACTION_CONFIRMATIONS.publish} required />
            <span>Je confirme la publication de ce produit.</span>
          </label>
          <button className="admin-button" type="submit" disabled={publicationBlockers.length > 0}>Publier</button>
        </form> : <form action={unpublishProductAction}>
          <input type="hidden" name="productId" value={product.id} /><input type="hidden" name="lockVersion" value={product.lockVersion} />
          <label className="admin-check">
            <input type="checkbox" name="confirmation" value={PRODUCT_ACTION_CONFIRMATIONS.unpublish} required />
            <span>Je confirme le retrait de ce produit de la Boutique.</span>
          </label>
          <button className="admin-button admin-button--quiet" type="submit">Dépublier</button>
        </form>}
        <form action={archiveProductAction}>
          <input type="hidden" name="productId" value={product.id} /><input type="hidden" name="lockVersion" value={product.lockVersion} />
          <label className="admin-check">
            <input type="checkbox" name="confirmation" value={PRODUCT_ACTION_CONFIRMATIONS.archive} required />
            <span>Je confirme l’archivage définitif de cette fiche.</span>
          </label>
          <button className="admin-button admin-button--danger" type="submit">Archiver</button>
        </form>
      </div> : null}
    </section>

    {product.trackInventory && editable ? <section className="admin-panel">
      <div className="admin-panel__heading"><h2>Ajuster le stock</h2></div>
      <p>
        Stock physique : <strong>{product.stock ?? 0}</strong> · Réservé : <strong>{product.activeReservedQuantity}</strong> · Disponible : <strong>{product.availableQuantity ?? 0}</strong>
      </p>
      <form className="admin-inline-form" action={adjustProductStockAction}>
        <input type="hidden" name="productId" value={product.id} /><input type="hidden" name="lockVersion" value={product.lockVersion} />
        <label><span>Ajustement</span><input name="delta" type="text" inputMode="text" pattern="[+\-]?\d+" placeholder="+5 ou -2" required /></label>
        <label><span>Motif</span><input name="reason" minLength={3} maxLength={500} required /></label>
        <label className="admin-check">
          <input type="checkbox" name="confirmation" value={PRODUCT_ACTION_CONFIRMATIONS.stock} required />
          <span>Je confirme cet ajustement de stock.</span>
        </label>
        <button className="admin-button" type="submit">Enregistrer l’ajustement</button>
      </form>
      {product.stockAdjustments.length ? <ol className="admin-rights-timeline">
        {product.stockAdjustments.map((adjustment) => <li key={adjustment.id}>
          <time className="admin-rights-timeline__when" dateTime={adjustment.createdAt.toISOString()}>{DATE_FORMAT.format(adjustment.createdAt)}</time>
          <div className="admin-rights-timeline__content"><p><strong>{adjustment.stockBefore} → {adjustment.stockAfter}</strong> ({adjustment.delta > 0 ? "+" : ""}{adjustment.delta}) · {adjustment.reason}</p></div>
          <small className="admin-rights-timeline__actor">{adjustment.actorAdmin?.displayName || "Administrateur supprimé"}</small>
        </li>)}
      </ol> : null}
    </section> : null}

    <section className="admin-panel">
      <div className="admin-panel__heading"><h2>Journal d’audit</h2></div>
      <ol className="admin-rights-timeline">
        {product.auditEvents.map((event) => <li key={event.id}>
          <time className="admin-rights-timeline__when" dateTime={event.occurredAt.toISOString()}>{DATE_FORMAT.format(event.occurredAt)}</time>
          <div className="admin-rights-timeline__content"><strong>{ACTION_LABELS[event.action]}</strong></div>
          <small className="admin-rights-timeline__actor">{event.actorAdmin?.displayName || "Administrateur supprimé"}</small>
        </li>)}
      </ol>
    </section>
  </div>;
}
