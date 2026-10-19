import { getSiteLocale, serverMoney, serverT } from "@/lib/i18n/server";
import { OriginalName } from "@/components/original-name";
import { T, ContractLanguageNotice } from "@/components/site-language";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createShopReturnAction } from "@/app/compte/sav/actions";
import { Container } from "@/components/container";
import { requireVerifiedUser } from "@/lib/auth/session";
import { SHOP_RETURN_REQUEST_CONFIRMATION } from "@/lib/shop/after-sales-domain";
import { shopAfterSalesQaEnabled } from "@/lib/shop/after-sales-config";
import { listShopReturnsForOrder } from "@/lib/shop/after-sales-service";
import { shopReturnStatusLabel } from "@/lib/shop/after-sales-presentation";
import { parseShopOrderNumber } from "@/lib/shop/order-domain";
import { getMemberShopOrder } from "@/lib/shop/order-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Demande SAV Boutique", robots: { index: false, follow: false } };

export default async function MemberShopReturnCreatePage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ etat?: string }>;
}) {
  const locale = await getSiteLocale();
  if (!shopAfterSalesQaEnabled()) notFound();
  const session = await requireVerifiedUser("/compte");
  let orderNumber: string;
  try { orderNumber = parseShopOrderNumber(decodeURIComponent((await params).orderNumber)); } catch { notFound(); }
  const order = await getMemberShopOrder(session.user.id, orderNumber);
  if (!order || order.status !== "OPEN" || order.paymentStatus !== "PAID" || order.paymentReviewAt) notFound();
  const requests = await listShopReturnsForOrder(session.user.id, order.id);
  const state = (await searchParams).etat;

  return <div className="auth-shell account-shell"><Container className="auth-shell__inner auth-shell__inner--account">
    <Link className="text-link" href={`/compte/achats/${encodeURIComponent(order.orderNumber)}`}><span aria-hidden="true">←</span> <T text="Retour à l’achat" /></Link>
    <header className="auth-intro"><p className="eyebrow"><T text="Boutique · SAV" /></p><h1><T text="Signaler un retour." /></h1><div className="account-intro__summary"><p><T text="Votre demande est enregistrée pour revue humaine. Elle ne déclenche automatiquement ni remboursement, ni retour physique, ni remise en stock." /></p></div></header>
    {state === "demande-refusee" ? <p className="auth-form__error" role="alert"><T text="La demande n’a pas été enregistrée. Vérifiez les quantités et la confirmation." /></p> : null}
    <ContractLanguageNotice /><div className="auth-account-stack">
      <section className="member-orders">
        <div className="member-orders__heading"><div><p className="auth-panel__label"><T text="Commande" /></p><h2 className="technical-reference technical-reference--section">{order.orderNumber}</h2></div><strong>{serverMoney(locale,order.totalCents)}</strong></div>
        <form className="auth-form shop-return-form" action={createShopReturnAction}>
          <input type="hidden" name="orderNumber" value={order.orderNumber} />
          <label><span><T text="Motif principal" /></span><select name="type" required defaultValue="">
            <option value="" disabled>{serverT(locale,"Choisir un motif")}</option>
            <option value="WITHDRAWAL">{serverT(locale,"Rétractation")}</option>
            <option value="DEFECTIVE">{serverT(locale,"Produit défectueux")}</option>
            <option value="NON_CONFORMING">{serverT(locale,"Produit non conforme")}</option>
            <option value="DAMAGED">{serverT(locale,"Produit endommagé")}</option>
            <option value="LOGISTICS_INCIDENT">{serverT(locale,"Incident logistique")}</option>
            <option value="OTHER">{serverT(locale,"Autre motif")}</option>
          </select></label>
          <fieldset className="shop-return-lines"><legend><T text="Articles concernés" /></legend>
            {order.items.map((item) => <label key={item.productId} className="shop-return-line">
              <span><strong>{<OriginalName>{item.productTitle}</OriginalName>}</strong><small>{serverMoney(locale,item.unitPriceCents)} <T text="· commandé :" />{" "}{item.quantity}</small></span>
              <span><T text="Quantité" /><input name={`quantity:${item.productId}`} type="number" inputMode="numeric" min="0" max={item.quantity} defaultValue="0" required /></span>
            </label>)}
          </fieldset>
          <label><span><T text="Message détaillé" /></span><textarea name="comment" maxLength={1000} minLength={10} rows={5} required /></label>
          <p className="auth-form__notice"><T text="Après l’enregistrement de votre demande, vous pourrez ajouter jusqu’à 5 photos pour illustrer le problème. Les photos restent facultatives." /></p>
          <label className="auth-check"><input type="checkbox" name="confirmation" value={SHOP_RETURN_REQUEST_CONFIRMATION} required /><span lang="fr" translate="no" className="notranslate">Je confirme l’exactitude de cette demande et comprends qu’elle sera examinée avant toute décision.</span></label>
          <button className="button button--primary" type="submit"><T text="ENREGISTRER LA DEMANDE" /></button>
        </form>
      </section>
      {requests.length ? <section className="member-orders"><div className="member-orders__heading"><div><p className="auth-panel__label"><T text="Historique" /></p><h2><T text="Dossiers liés." /></h2></div></div><ul className="member-order-list">{requests.map((request) => <li key={request.id}><Link className="text-link" href={`/compte/sav/${encodeURIComponent(request.requestNumber)}`}>{request.requestNumber} · {<T text={shopReturnStatusLabel(request.status)} />}</Link></li>)}</ul></section> : null}
    </div>
  </Container></div>;
}
