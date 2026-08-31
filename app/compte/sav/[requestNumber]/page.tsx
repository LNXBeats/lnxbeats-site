import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { addShopReturnEvidenceAction, cancelShopReturnAction } from "@/app/compte/sav/actions";
import { Container } from "@/components/container";
import { requireVerifiedUser } from "@/lib/auth/session";
import { shopAfterSalesQaEnabled } from "@/lib/shop/after-sales-config";
import { SHOP_RETURN_CANCEL_CONFIRMATION } from "@/lib/shop/after-sales-domain";
import { getMemberShopReturn } from "@/lib/shop/after-sales-service";
import { shopReturnRefundStatusLabel, shopReturnStatusLabel } from "@/lib/shop/after-sales-presentation";
import { formatShopMoney } from "@/lib/shop/order-presentation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dossier SAV Boutique", robots: { index: false, follow: false } };

export default async function MemberShopReturnPage({ params, searchParams }: { params: Promise<{ requestNumber: string }>; searchParams: Promise<{ etat?: string }> }) {
  if (!shopAfterSalesQaEnabled()) notFound();
  const session = await requireVerifiedUser("/compte");
  const requestNumber = decodeURIComponent((await params).requestNumber);
  const request = await getMemberShopReturn(session.user.id, requestNumber);
  if (!request) notFound();
  const state = (await searchParams).etat;
  return <div className="auth-shell account-shell"><Container className="auth-shell__inner auth-shell__inner--account">
    <Link className="text-link" href={`/compte/achats/${encodeURIComponent(request.shopOrder.orderNumber)}`}><span aria-hidden="true">←</span> Retour à l’achat</Link>
    <header className="auth-intro"><p className="eyebrow">Boutique · SAV</p><h1>{request.requestNumber}</h1><div className="account-intro__summary"><p>{shopReturnStatusLabel(request.status)}. Les décisions de remboursement et de remise en stock restent séparées et auditées.</p></div></header>
    {state === "demande-enregistree" ? <p className="auth-form__success" role="status">Votre demande a été enregistrée.</p> : null}
    {state === "demande-annulee" ? <p className="auth-form__success" role="status">Votre demande a été annulée.</p> : null}
    {state === "operation-refusee" ? <p className="auth-form__error" role="alert">L’opération a été refusée sans modifier le dossier.</p> : null}
    {state === "preuves-ajoutees" ? <p className="auth-form__success" role="status">Vos preuves privées ont été ajoutées au dossier.</p> : null}
    {state === "preuve-refusee" ? <p className="auth-form__error" role="alert">La pièce n’a pas été acceptée. Utilisez au maximum cinq images JPEG, PNG ou WebP de 5 Mo chacune.</p> : null}
    <div className="auth-account-stack">
      <section className="member-orders"><div className="member-orders__heading"><div><p className="auth-panel__label">État</p><h2>{shopReturnStatusLabel(request.status)}</h2></div></div><dl className="auth-profile shop-return-summary">
        <div><dt>Commande</dt><dd><Link className="text-link" href={`/compte/achats/${encodeURIComponent(request.shopOrder.orderNumber)}`}>{request.shopOrder.orderNumber}</Link></dd></div>
        <div><dt>Demande reçue</dt><dd>{request.requestedAt.toLocaleString("fr-FR")}</dd></div>
        <div><dt>Retour physique</dt><dd>{request.physicalReturnRequired === null ? "Décision en attente" : request.physicalReturnRequired ? "Requis" : "Non requis"}</dd></div>
        <div><dt>Remboursement</dt><dd>{shopReturnRefundStatusLabel(request.refundStatus)}</dd></div>
        {request.totalRefundCents > 0 ? <div><dt>Montant</dt><dd>{formatShopMoney(request.totalRefundCents)}</dd></div> : null}
        {request.creditNote ? <div><dt>Avoir</dt><dd><Link className="text-link" href={`/compte/avoirs/${encodeURIComponent(request.creditNote.creditNoteNumber)}`}>{request.creditNote.creditNoteNumber}</Link></dd></div> : null}
      </dl>{request.returnInstructions ? <div className="auth-form__notice"><strong>Instructions de retour</strong><p>{request.returnInstructions}</p></div> : null}</section>
      <section className="member-orders"><div className="member-orders__heading"><div><p className="auth-panel__label">Quantités</p><h2>Décisions par article.</h2></div></div><ul className="member-order-list">{request.items.map((item) => <li key={item.id}><strong>{item.productTitle}</strong><p>Demandée : {item.requestedQuantity} · autorisée : {item.authorizedQuantity} · reçue : {item.receivedQuantity} · remboursable : {item.refundableQuantity} · remboursée : {item.refundQuantity} · réintégrée : {item.restockedQuantity}</p></li>)}</ul></section>
      <section className="member-orders"><div className="member-orders__heading"><div><p className="auth-panel__label">Preuves privées</p><h2>Photos facultatives.</h2></div></div><p>Votre message reste obligatoire. Vous pouvez joindre jusqu’à cinq images privées ; elles seront purgées 90 jours après la clôture du dossier.</p>{request.evidence.filter((item) => item.status === "ACTIVE").length ? <ul className="member-order-list">{request.evidence.filter((item) => item.status === "ACTIVE").map((item) => <li key={item.id}><a className="text-link" href={`/api/shop/sav/evidence/${item.id}`}>{item.originalName}</a><small>{Math.ceil(item.byteSize / 1024)} Ko</small></li>)}</ul> : <p>Aucune photo jointe.</p>}<form className="auth-form" action={addShopReturnEvidenceAction} encType="multipart/form-data"><input type="hidden" name="requestNumber" value={request.requestNumber} /><label><span>Ajouter des images</span><input type="file" name="evidence" accept="image/jpeg,image/png,image/webp" multiple required /></label><button className="button button--quiet" type="submit">AJOUTER AU DOSSIER</button></form></section>
      {request.status === "REQUESTED" ? <details className="auth-panel account-disclosure"><summary>Annuler cette demande <span aria-hidden="true">＋</span></summary><div><form className="shop-return-form" action={cancelShopReturnAction}><input type="hidden" name="requestNumber" value={request.requestNumber} /><label className="auth-check"><input type="checkbox" name="confirmation" value={SHOP_RETURN_CANCEL_CONFIRMATION} required /><span>Je confirme l’annulation de ce dossier.</span></label><button className="button button--quiet" type="submit">ANNULER LA DEMANDE</button></form></div></details> : null}
    </div>
  </Container></div>;
}
