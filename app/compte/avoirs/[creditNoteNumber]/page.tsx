import { getSiteLocale, serverMoney, serverT } from "@/lib/i18n/server";
import { T, ContractLanguageNotice } from "@/components/site-language";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { requireVerifiedUser } from "@/lib/auth/session";
import { billingAddressLines } from "@/lib/billing/address-presentation";
import { parseBillingCustomerSnapshot, parseBillingSellerSnapshot } from "@/lib/billing/domain";
import { billingDocumentPresentation, creditNoteReasonLabel } from "@/lib/billing/presentation";
import { getCreditNoteForMember } from "@/lib/billing/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avoir", robots: { index: false, follow: false } };
const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });

export default async function MemberCreditNotePage({ params }: { params: Promise<{ creditNoteNumber: string }> }) {
  const locale = await getSiteLocale();
  const session = await requireVerifiedUser("/compte");
  const { creditNoteNumber } = await params;
  const creditNote = await getCreditNoteForMember(creditNoteNumber, session.user.id);
  if (!creditNote) notFound();
  const presentation = billingDocumentPresentation("CREDIT_NOTE", creditNote.invoice.payment.mode);
  const customer = parseBillingCustomerSnapshot(creditNote.invoice.customerSnapshot);
  const seller = parseBillingSellerSnapshot(creditNote.invoice.sellerSnapshot);
  return <section className="auth-shell account-shell billing-document-page"><Container className="auth-shell__inner auth-shell__inner--account">
    <div className="auth-intro billing-credit-note-intro"><p className="eyebrow">{<T text={presentation.label} />}</p><h1 className="technical-reference technical-reference--hero">{creditNote.creditNoteNumber}</h1><p><T text="Correction de la facture" />{" "}<span className="technical-reference technical-reference--inline">{creditNote.invoice.invoiceNumber}</span><T text=", sans suppression ni réécriture du document d’origine." /></p></div>
    <ContractLanguageNotice /><section className="auth-panel"><dl className="auth-profile"><div><dt><T text="Avoir émis le" /></dt><dd><time dateTime={creditNote.issuedAt.toISOString()}>{DATE_FORMAT.format(creditNote.issuedAt)}</time></dd></div><div><dt><T text="Émetteur" /></dt><dd>{seller.legalName}<small>{seller.legalForm} · {seller.tradeName}</small></dd></div><div><dt><T text="Adresse émetteur" /></dt><dd><address className="billing-customer-address">{billingAddressLines(seller.address).map((line, index) => <span key={`${index}:${line}`}>{line}</span>)}</address></dd></div><div><dt><T text="Identification émetteur" /></dt><dd>SIREN {seller.siren}<small>SIRET {seller.siret} · APE {seller.ape}</small></dd></div><div><dt><T text="Contact émetteur" /></dt><dd>{seller.email}</dd></div><div><dt><T text="Client" /></dt><dd>{customer.companyName || customer.name}{customer.companyName ? <small>{customer.name}</small> : null}</dd></div>{customer.billingAddress ? <div><dt><T text="Adresse client" /></dt><dd><address className="billing-customer-address">{billingAddressLines(customer.billingAddress).map((line, index) => <span key={`${index}:${line}`}>{line}</span>)}</address></dd></div> : null}<div><dt><T text="Montant" /></dt><dd>{serverMoney(locale,creditNote.amountCents)}</dd></div><div><dt><T text="Avoirs cumulés" /></dt><dd>{serverMoney(locale,creditNote.cumulativeCreditedCents)}</dd></div><div><dt><T text="Solde documentaire restant" /></dt><dd>{serverMoney(locale,creditNote.remainingBalanceCents)}</dd></div><div><dt><T text="Nature du motif" /></dt><dd>{<T text={creditNoteReasonLabel(creditNote.reasonCode)} />}</dd></div>{creditNote.reasonText ? <div><dt><T text="Précision du motif" /></dt><dd>{creditNote.reasonText}</dd></div> : null}<div><dt><T text="Facture source" /></dt><dd>{creditNote.invoice.invoiceNumber}</dd></div><div><dt><T text="Facture source émise le" /></dt><dd><time dateTime={creditNote.invoice.issuedAt.toISOString()}>{DATE_FORMAT.format(creditNote.invoice.issuedAt)}</time></dd></div><div><dt><T text="Empreinte de l’avoir" /></dt><dd><code>{creditNote.snapshotHashSha256.slice(0, 16)}…</code></dd></div></dl>
      {presentation.warning ? <p className="legal-document__warning">{<T text={presentation.warning} />}</p> : null}
      <div className="billing-document-actions" role="group" aria-label={serverT(locale, "Actions du document")}>
        <a className="button button--primary billing-document-download" href={`/api/billing/credit-notes/${encodeURIComponent(creditNote.creditNoteNumber)}/pdf`}><span><T text="Télécharger le PDF" /></span><span aria-hidden="true">↓</span></a>
        <Link className="button button--quiet" href={`/compte/factures/${encodeURIComponent(creditNote.invoice.invoiceNumber)}`}><span><T text="Retour à la facture" /></span></Link>
      </div>
    </section>
  </Container></section>;
}
