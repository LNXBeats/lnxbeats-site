import { getSiteLocale, serverDate, serverMoney } from "@/lib/i18n/server";
import { OriginalName } from "@/components/original-name";
import { T, ContractLanguageNotice } from "@/components/site-language";
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

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dossier SAV Boutique", robots: { index: false, follow: false } };

export default async function MemberShopReturnPage({ params, searchParams }: { params: Promise<{ requestNumber: string }>; searchParams: Promise<{ etat?: string }> }) {
  const locale = await getSiteLocale();
  if (!shopAfterSalesQaEnabled()) notFound();
  const session = await requireVerifiedUser("/compte");
  const requestNumber = decodeURIComponent((await params).requestNumber);
  const request = await getMemberShopReturn(session.user.id, requestNumber);
  if (!request) notFound();
  const state = (await searchParams).etat;
  return <div className="auth-shell account-shell"><Container className="auth-shell__inner auth-shell__inner--account">
    <Link className="text-link" href={`/compte/achats/${encodeURIComponent(request.shopOrder.orderNumber)}`}><span aria-hidden="true">←</span> <T text="Retour à l’achat" /></Link>
    <header className="auth-intro"><p className="eyebrow"><T text="Boutique · SAV" /></p><h1 className="technical-reference technical-reference--hero">{request.requestNumber}</h1><div className="account-intro__summary"><p>{<T text={shopReturnStatusLabel(request.status)} />}<T text=". Les décisions de remboursement et de remise en stock restent séparées et auditées." /></p></div></header>
    {state === "demande-enregistree" ? <p className="auth-form__success" role="status"><T text="Votre demande a été enregistrée." /></p> : null}
    {state === "demande-annulee" ? <p className="auth-form__success" role="status"><T text="Votre demande a été annulée." /></p> : null}
    {state === "operation-refusee" ? <p className="auth-form__error" role="alert"><T text="L’opération a été refusée sans modifier le dossier." /></p> : null}
    {state === "preuves-ajoutees" ? <p className="auth-form__success" role="status"><T text="Vos preuves privées ont été ajoutées au dossier." /></p> : null}
    {state === "preuve-refusee" ? <p className="auth-form__error" role="alert"><T text="La pièce n’a pas été acceptée. Utilisez au maximum cinq images JPEG, PNG ou WebP de 5 Mo chacune." /></p> : null}
    <ContractLanguageNotice /><div className="auth-account-stack">
      <section className="member-orders"><div className="member-orders__heading"><div><p className="auth-panel__label"><T text="État" /></p><h2>{<T text={shopReturnStatusLabel(request.status)} />}</h2></div></div><dl className="auth-profile shop-return-summary">
        <div><dt><T text="Commande" /></dt><dd><Link className="text-link" href={`/compte/achats/${encodeURIComponent(request.shopOrder.orderNumber)}`}>{request.shopOrder.orderNumber}</Link></dd></div>
        <div><dt><T text="Demande reçue" /></dt><dd>{serverDate(locale, request.requestedAt, {dateStyle:"short",timeStyle:"short"})}</dd></div>
        <div><dt><T text="Retour physique" /></dt><dd>{request.physicalReturnRequired === null ? <T text="Décision en attente" /> : request.physicalReturnRequired ? <T text="Requis" /> : <T text="Non requis" />}</dd></div>
        <div><dt><T text="Remboursement" /></dt><dd>{<T text={shopReturnRefundStatusLabel(request.refundStatus)} />}</dd></div>
        {request.totalRefundCents > 0 ? <div><dt><T text="Montant" /></dt><dd>{serverMoney(locale,request.totalRefundCents)}</dd></div> : null}
        {request.creditNote ? <div><dt><T text="Avoir" /></dt><dd><Link className="text-link" href={`/compte/avoirs/${encodeURIComponent(request.creditNote.creditNoteNumber)}`}>{request.creditNote.creditNoteNumber}</Link></dd></div> : null}
      </dl>{request.returnInstructions ? <div className="auth-form__notice"><strong><T text="Instructions de retour" /></strong><p>{request.returnInstructions}</p></div> : null}</section>
      <section className="member-orders"><div className="member-orders__heading"><div><p className="auth-panel__label"><T text="Quantités" /></p><h2><T text="Décisions par article." /></h2></div></div><ul className="member-order-list">{request.items.map((item) => <li key={item.id}><strong>{<OriginalName>{item.productTitle}</OriginalName>}</strong><p><T text="Demandée :" />{" "}{item.requestedQuantity} <T text="· autorisée :" />{" "}{item.authorizedQuantity} <T text="· reçue :" />{" "}{item.receivedQuantity} <T text="· remboursable :" />{" "}{item.refundableQuantity} <T text="· remboursée :" />{" "}{item.refundQuantity} <T text="· réintégrée :" />{" "}{item.restockedQuantity}</p></li>)}</ul></section>
      <section className="member-orders"><div className="member-orders__heading"><div><p className="auth-panel__label"><T text="Preuves privées" /></p><h2><T text="Photos facultatives." /></h2></div></div><p><T text="Votre message reste obligatoire. Vous pouvez joindre jusqu’à cinq images privées ; elles seront purgées 90 jours après la clôture du dossier." /></p>{request.evidence.filter((item) => item.status === "ACTIVE").length ? <ul className="member-order-list">{request.evidence.filter((item) => item.status === "ACTIVE").map((item) => <li key={item.id}><a className="text-link" href={`/api/shop/sav/evidence/${item.id}`}>{<OriginalName>{item.originalName}</OriginalName>}</a><small>{Math.ceil(item.byteSize / 1024)} <T text="Ko" /></small></li>)}</ul> : <p><T text="Aucune photo jointe." /></p>}<form className="auth-form" action={addShopReturnEvidenceAction} encType="multipart/form-data"><input type="hidden" name="requestNumber" value={request.requestNumber} /><label><span><T text="Ajouter des images" /></span><input type="file" name="evidence" accept="image/jpeg,image/png,image/webp" multiple required /></label><button className="button button--quiet" type="submit"><T text="AJOUTER AU DOSSIER" /></button></form></section>
      {request.status === "REQUESTED" ? <details className="auth-panel account-disclosure"><summary><T text="Annuler cette demande" />{" "}<span aria-hidden="true">＋</span></summary><div><form className="shop-return-form" action={cancelShopReturnAction}><input type="hidden" name="requestNumber" value={request.requestNumber} /><label className="auth-check"><input type="checkbox" name="confirmation" value={SHOP_RETURN_CANCEL_CONFIRMATION} required /><span lang="fr" translate="no" className="notranslate">Je confirme l’annulation de ce dossier.</span></label><button className="button button--quiet" type="submit"><T text="ANNULER LA DEMANDE" /></button></form></div></details> : null}
    </div>
  </Container></div>;
}
