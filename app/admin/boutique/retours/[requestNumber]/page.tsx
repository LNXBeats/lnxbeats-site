import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  closeShopReturnAction,
  decideShopReturnAction,
  inspectShopReturnAction,
  receiveShopReturnAction,
  reconcileShopReturnAction,
  refundShopReturnAction,
  restockShopReturnAction,
  startShopReturnReviewAction,
} from "@/app/admin/boutique/retours/actions";
import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { shopAfterSalesQaEnabled } from "@/lib/shop/after-sales-config";
import {
  SHOP_RETURN_APPROVAL_CONFIRMATION,
  SHOP_RETURN_CLOSE_CONFIRMATION,
  SHOP_RETURN_INSPECTION_CONFIRMATION,
  SHOP_RETURN_RECEIPT_CONFIRMATION,
  SHOP_RETURN_REFUND_CONFIRMATION,
  SHOP_RETURN_REJECTION_CONFIRMATION,
  SHOP_RETURN_RESTOCK_CONFIRMATION,
} from "@/lib/shop/after-sales-domain";
import { getAdminShopReturn } from "@/lib/shop/after-sales-service";
import {
  shopReturnAuditActionLabel,
  shopReturnCostDecisionLabel,
  shopReturnRefundStatusLabel,
  shopReturnStatusLabel,
  shopReturnTypeLabel,
} from "@/lib/shop/after-sales-presentation";
import { formatShopMoney } from "@/lib/shop/order-presentation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dossier SAV Boutique" };
const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

function Confirmation({ value, children }: { value: string; children: string }) {
  return <label className="admin-check"><input type="checkbox" name="confirmation" value={value} required /><span>{children}</span></label>;
}

export default async function AdminShopReturnPage({ params, searchParams }: { params: Promise<{ requestNumber: string }>; searchParams: Promise<{ etat?: string }> }) {
  await requireAdmin();
  if (!shopAfterSalesQaEnabled()) notFound();
  const request = await getAdminShopReturn(decodeURIComponent((await params).requestNumber));
  if (!request) notFound();
  const state = (await searchParams).etat;
  const mayRefund = (request.status === "APPROVED" && request.physicalReturnRequired === false) || request.status === "INSPECTED";
  const mayRestock = ["INSPECTED", "REFUND_PENDING", "REFUNDED"].includes(request.status)
    && request.items.some((item) => item.restockDecision === "RESTOCKABLE" && item.restockableQuantity > item.restockedQuantity);
  return <div className="admin-main">
    <AdminBackLink href="/admin/boutique/retours">Retour aux dossiers SAV</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-kicker">Boutique · SAV</p><h1>{request.requestNumber}</h1><small>{shopReturnStatusLabel(request.status)} · {shopReturnTypeLabel(request.type)}</small></div><p>Commande <Link className="text-link" href={`/admin/boutique/commandes/${encodeURIComponent(request.shopOrder.orderNumber)}`}>{request.shopOrder.orderNumber}</Link></p></header>
    {state ? <p className={state === "operation-refusee" ? "admin-alert" : "admin-feedback"} role="status">{state === "operation-refusee" ? "Opération refusée sans mutation." : "Opération enregistrée dans le journal SAV."}</p> : null}
    <div className="admin-order-detail__grid"><div className="admin-order-detail__main">
      <section className="admin-list-window"><div className="admin-list-window__heading"><h2>Quantités auditées</h2><span>{request.items.length} article{request.items.length === 1 ? "" : "s"}</span></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Article</th><th>Demandée</th><th>Autorisée</th><th>Reçue</th><th>Remboursable</th><th>Remboursée</th><th>Restockable</th><th>Restockée</th></tr></thead><tbody>{request.items.map((item) => <tr key={item.id}><td>{item.productTitle}<small>{formatShopMoney(item.unitPriceCents)}</small></td><td>{item.requestedQuantity}</td><td>{item.authorizedQuantity}</td><td>{item.receivedQuantity}</td><td>{item.refundableQuantity}</td><td>{item.refundQuantity}</td><td>{item.restockableQuantity}</td><td>{item.restockedQuantity}</td></tr>)}</tbody></table></div></section>
      {request.evidence.length ? <section className="admin-list-window"><div className="admin-list-window__heading"><h2>Photos privées du dossier</h2><span>{request.evidence.length} / 5</span></div><div className="admin-card-grid">{request.evidence.map((evidence) => <Link className="admin-card" href={`/api/shop/sav/evidence/${encodeURIComponent(evidence.id)}`} key={evidence.id} target="_blank" rel="noreferrer"><Image unoptimized src={`/api/shop/sav/evidence/${encodeURIComponent(evidence.id)}`} alt={evidence.originalName} width={160} height={120} /><span>{evidence.originalName}</span><small>Accès authentifié · conservation limitée</small></Link>)}</div></section> : null}
      <section className="admin-list-window"><div className="admin-list-window__heading"><h2>Journal immuable</h2><span>{request.auditEvents.length} événement{request.auditEvents.length === 1 ? "" : "s"}</span></div><ol className="admin-timeline">{request.auditEvents.map((event) => <li key={event.id}><time>{DATE.format(event.occurredAt)}</time><strong>{shopReturnAuditActionLabel(event.action)}</strong></li>)}</ol></section>
    </div><aside className="admin-order-detail__aside">
      <section className="admin-side-window"><p className="admin-section-label">Synthèse</p><dl className="admin-data-list"><div><dt>Client</dt><dd>{request.shopOrder.user.displayName || request.shopOrder.user.email}</dd></div><div><dt>Demandée</dt><dd>{DATE.format(request.requestedAt)}</dd></div><div><dt>Retour physique</dt><dd>{request.physicalReturnRequired === null ? "À décider" : request.physicalReturnRequired ? "Requis" : "Non requis"}</dd></div><div><dt>Frais de retour</dt><dd>{shopReturnCostDecisionLabel(request.returnCostDecision)}</dd></div><div><dt>Remboursement</dt><dd>{shopReturnRefundStatusLabel(request.refundStatus)}{request.totalRefundCents ? ` · ${formatShopMoney(request.totalRefundCents)}` : ""}</dd></div>{request.creditNote ? <div><dt>Avoir</dt><dd><Link className="text-link" href={`/admin/facturation/${encodeURIComponent(request.creditNote.invoice.invoiceNumber)}`}>{request.creditNote.creditNoteNumber}</Link></dd></div> : null}</dl></section>
      {request.status === "REQUESTED" ? <section className="admin-side-window"><p className="admin-section-label">Revue</p><form action={startShopReturnReviewAction}><input type="hidden" name="requestNumber" value={request.requestNumber} /><button className="admin-button" type="submit">DÉMARRER LA REVUE</button></form></section> : null}
      {["REQUESTED", "UNDER_REVIEW"].includes(request.status) ? <section className="admin-side-window"><p className="admin-section-label">Décision humaine</p><form className="admin-form" action={decideShopReturnAction}><input type="hidden" name="requestNumber" value={request.requestNumber} />{request.items.map((item) => <label key={item.id}>{item.productTitle}<input type="number" name={`authorized:${item.productId}`} min="0" max={item.requestedQuantity} defaultValue={item.requestedQuantity} required /></label>)}<label className="admin-check"><input type="checkbox" name="physicalReturnRequired" value="true" /><span>Retour physique requis</span></label><label>Charge du retour<select name="returnCostDecision" defaultValue="MANUAL_REVIEW"><option value="MANUAL_REVIEW">Décision manuelle</option><option value="CUSTOMER">Client</option><option value="MERCHANT">Vendeur</option></select></label><label>Instructions<textarea name="instructions" maxLength={2000} rows={4} /></label><label>Commentaire Admin<textarea name="comment" maxLength={1000} rows={3} /></label><label>Confirmation de décision<select name="confirmation" required defaultValue=""><option value="" disabled>Choisir la confirmation correspondant au bouton</option><option value={SHOP_RETURN_APPROVAL_CONFIRMATION}>Je confirme l’acceptation</option><option value={SHOP_RETURN_REJECTION_CONFIRMATION}>Je confirme le refus</option></select></label><div className="admin-action-row"><button className="admin-button" name="decision" value="APPROVE" type="submit">ACCEPTER</button><button className="admin-button admin-button--quiet" name="decision" value="REJECT" type="submit">REFUSER</button></div></form></section> : null}
      {request.status === "AWAITING_RETURN" ? <section className="admin-side-window"><p className="admin-section-label">Réception physique</p><form className="admin-form" action={receiveShopReturnAction}><input type="hidden" name="requestNumber" value={request.requestNumber} />{request.items.map((item) => <label key={item.id}>{item.productTitle}<input type="number" name={`received:${item.productId}`} min="0" max={item.authorizedQuantity} defaultValue={item.authorizedQuantity} required /></label>)}<Confirmation value={SHOP_RETURN_RECEIPT_CONFIRMATION}>Je confirme les quantités physiquement reçues.</Confirmation><button className="admin-button" type="submit">ENREGISTRER LA RÉCEPTION</button></form></section> : null}
      {request.status === "RETURN_RECEIVED" ? <section className="admin-side-window"><p className="admin-section-label">Inspection</p><form className="admin-form" action={inspectShopReturnAction}><input type="hidden" name="requestNumber" value={request.requestNumber} />{request.items.map((item) => <fieldset key={item.id}><legend>{item.productTitle}</legend><label>État<select name={`condition:${item.productId}`} defaultValue="SEALED"><option value="SEALED">Scellé</option><option value="UNSEALED">Ouvert</option><option value="DAMAGED">Endommagé</option><option value="DEFECTIVE">Défectueux</option><option value="OTHER">Autre</option></select></label><label>Décision stock<select name={`decision:${item.productId}`} defaultValue="NOT_RESTOCKABLE"><option value="NOT_RESTOCKABLE">Non restockable</option><option value="RESTOCKABLE">Restockable</option></select></label><label>Quantité remboursable<input type="number" name={`refundable:${item.productId}`} min="0" max={item.receivedQuantity} defaultValue={item.receivedQuantity} required /></label><label>Quantité restockable<input type="number" name={`restockable:${item.productId}`} min="0" max={item.receivedQuantity} defaultValue="0" required /></label><label>Observation<textarea name={`comment:${item.productId}`} maxLength={1000} rows={2} /></label></fieldset>)}<Confirmation value={SHOP_RETURN_INSPECTION_CONFIRMATION}>Je confirme l’inspection et les décisions ligne par ligne.</Confirmation><button className="admin-button" type="submit">ENREGISTRER L’INSPECTION</button></form></section> : null}
      {mayRefund && !request.refundAttempt ? <section className="admin-side-window"><p className="admin-section-label">Remboursement QA factice</p><form className="admin-form" action={refundShopReturnAction}><input type="hidden" name="requestNumber" value={request.requestNumber} /><label>Expédition remboursée<select name="shippingDecision" defaultValue="NONE"><option value="NONE">Non</option><option value="FULL">Oui, intégralement</option></select></label><label>Scénario provider factice<select name="behavior" defaultValue="SUCCEEDED"><option value="SUCCEEDED">Succès</option><option value="PENDING">Pending</option><option value="FAILED">Échec</option><option value="AMBIGUOUS">Timeout ambigu</option></select></label><Confirmation value={SHOP_RETURN_REFUND_CONFIRMATION}>Je confirme le remboursement QA calculé par le serveur.</Confirmation><button className="admin-button" type="submit">EXÉCUTER LE FAKE REFUND</button></form></section> : null}
      {request.refundAttempt && ["PENDING", "REQUIRES_REVIEW"].includes(request.refundAttempt.status) ? <section className="admin-side-window"><p className="admin-section-label">Réconciliation</p><form action={reconcileShopReturnAction}><input type="hidden" name="requestNumber" value={request.requestNumber} /><button className="admin-button" type="submit">RÉCONCILIER LE FAKE REFUND</button></form></section> : null}
      {mayRestock ? <section className="admin-side-window"><p className="admin-section-label">Stock distinct</p><form action={restockShopReturnAction}><input type="hidden" name="requestNumber" value={request.requestNumber} /><Confirmation value={SHOP_RETURN_RESTOCK_CONFIRMATION}>Je confirme la remise en stock des seules quantités déclarées restockables.</Confirmation><button className="admin-button" type="submit">RÉINTÉGRER LE STOCK</button></form></section> : null}
      {["APPROVED", "INSPECTED", "REFUNDED", "REJECTED"].includes(request.status) ? <section className="admin-side-window"><p className="admin-section-label">Clôture</p><form action={closeShopReturnAction}><input type="hidden" name="requestNumber" value={request.requestNumber} /><Confirmation value={SHOP_RETURN_CLOSE_CONFIRMATION}>Je confirme la clôture du dossier.</Confirmation><button className="admin-button admin-button--quiet" type="submit">CLÔTURER</button></form></section> : null}
    </aside></div>
  </div>;
}
