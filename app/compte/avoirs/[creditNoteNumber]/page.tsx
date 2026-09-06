import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { requireVerifiedUser } from "@/lib/auth/session";
import { billingAddressLines } from "@/lib/billing/address-presentation";
import { parseBillingCustomerSnapshot, parseBillingSellerSnapshot } from "@/lib/billing/domain";
import { billingDocumentPresentation, creditNoteReasonLabel } from "@/lib/billing/presentation";
import { getCreditNoteForMember } from "@/lib/billing/service";
import { formatEuro } from "@/lib/orders/domain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avoir", robots: { index: false, follow: false } };
const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });

export default async function MemberCreditNotePage({ params }: { params: Promise<{ creditNoteNumber: string }> }) {
  const session = await requireVerifiedUser("/compte");
  const { creditNoteNumber } = await params;
  const creditNote = await getCreditNoteForMember(creditNoteNumber, session.user.id);
  if (!creditNote) notFound();
  const presentation = billingDocumentPresentation("CREDIT_NOTE", creditNote.invoice.payment.mode);
  const customer = parseBillingCustomerSnapshot(creditNote.invoice.customerSnapshot);
  const seller = parseBillingSellerSnapshot(creditNote.invoice.sellerSnapshot);
  return <section className="auth-shell account-shell"><Container className="auth-shell__inner auth-shell__inner--account">
    <div className="auth-intro billing-credit-note-intro"><p className="eyebrow">{presentation.label}</p><h1>{creditNote.creditNoteNumber}</h1><p>Correction de la facture {creditNote.invoice.invoiceNumber}, sans suppression ni réécriture du document d’origine.</p></div>
    <section className="auth-panel"><dl className="auth-profile"><div><dt>Avoir émis le</dt><dd><time dateTime={creditNote.issuedAt.toISOString()}>{DATE_FORMAT.format(creditNote.issuedAt)}</time></dd></div><div><dt>Émetteur</dt><dd>{seller.legalName}<small>{seller.legalForm} · {seller.tradeName}</small></dd></div><div><dt>Adresse émetteur</dt><dd><address className="billing-customer-address">{billingAddressLines(seller.address).map((line, index) => <span key={`${index}:${line}`}>{line}</span>)}</address></dd></div><div><dt>Identification émetteur</dt><dd>SIREN {seller.siren}<small>SIRET {seller.siret} · APE {seller.ape}</small></dd></div><div><dt>Contact émetteur</dt><dd>{seller.email}</dd></div><div><dt>Client</dt><dd>{customer.companyName || customer.name}{customer.companyName ? <small>{customer.name}</small> : null}</dd></div>{customer.billingAddress ? <div><dt>Adresse client</dt><dd><address className="billing-customer-address">{billingAddressLines(customer.billingAddress).map((line, index) => <span key={`${index}:${line}`}>{line}</span>)}</address></dd></div> : null}<div><dt>Montant</dt><dd>{formatEuro(creditNote.amountCents)}</dd></div><div><dt>Avoirs cumulés</dt><dd>{formatEuro(creditNote.cumulativeCreditedCents)}</dd></div><div><dt>Solde documentaire restant</dt><dd>{formatEuro(creditNote.remainingBalanceCents)}</dd></div><div><dt>Nature du motif</dt><dd>{creditNoteReasonLabel(creditNote.reasonCode)}</dd></div>{creditNote.reasonText ? <div><dt>Précision du motif</dt><dd>{creditNote.reasonText}</dd></div> : null}<div><dt>Facture source</dt><dd>{creditNote.invoice.invoiceNumber}</dd></div><div><dt>Facture source émise le</dt><dd><time dateTime={creditNote.invoice.issuedAt.toISOString()}>{DATE_FORMAT.format(creditNote.invoice.issuedAt)}</time></dd></div><div><dt>Empreinte de l’avoir</dt><dd><code>{creditNote.snapshotHashSha256.slice(0, 16)}…</code></dd></div></dl>
      {presentation.warning ? <p className="legal-document__warning">{presentation.warning}</p> : null}
      <div className="billing-document-actions" role="group" aria-label="Actions du document">
        <a className="button button--primary billing-document-download" href={`/api/billing/credit-notes/${encodeURIComponent(creditNote.creditNoteNumber)}/pdf`}><span>Télécharger le PDF</span><span aria-hidden="true">↓</span></a>
        <Link className="button button--quiet" href={`/compte/factures/${encodeURIComponent(creditNote.invoice.invoiceNumber)}`}><span>Retour à la facture</span></Link>
      </div>
    </section>
  </Container></section>;
}
