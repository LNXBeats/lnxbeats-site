import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { billingAddressLines } from "@/lib/billing/address-presentation";
import { parseBillingCustomerSnapshot, parseBillingSellerSnapshot } from "@/lib/billing/domain";
import { billingDocumentPresentation, creditNoteReasonLabel } from "@/lib/billing/presentation";
import { getCreditNoteForAdmin } from "@/lib/billing/service";
import { formatEuro } from "@/lib/orders/domain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avoir", robots: { index: false, follow: false } };
const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });

export default async function AdminCreditNotePage({ params }: { params: Promise<{ creditNoteNumber: string }> }) {
  await requireAdmin();
  const { creditNoteNumber } = await params;
  const creditNote = await getCreditNoteForAdmin(creditNoteNumber);
  if (!creditNote) notFound();
  const presentation = billingDocumentPresentation("CREDIT_NOTE", creditNote.invoice.payment.mode);
  const customer = parseBillingCustomerSnapshot(creditNote.invoice.customerSnapshot);
  const seller = parseBillingSellerSnapshot(creditNote.invoice.sellerSnapshot);
  return <main className="admin-main">
    <AdminBackLink href={`/admin/facturation/${encodeURIComponent(creditNote.invoice.invoiceNumber)}`}>Retour à la facture</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-section-label">{presentation.label}</p><h1>{creditNote.creditNoteNumber}</h1></div><p>Correction immuable liée à la facture {creditNote.invoice.invoiceNumber}. Aucun montant de la facture source n’est réécrit. Aucun bouton de modification ou suppression n’est proposé.</p></header>
    <section className="admin-panel">
      <dl className="admin-definition-grid"><div><dt>Avoir émis le</dt><dd><time dateTime={creditNote.issuedAt.toISOString()}>{DATE_FORMAT.format(creditNote.issuedAt)}</time></dd></div><div><dt>Émetteur</dt><dd>{seller.legalName}<small>{seller.legalForm} · {seller.tradeName}</small></dd></div><div><dt>Adresse émetteur</dt><dd><address className="billing-customer-address">{billingAddressLines(seller.address).map((line, index) => <span key={`${index}:${line}`}>{line}</span>)}</address></dd></div><div><dt>Identification émetteur</dt><dd>SIREN {seller.siren}<small>SIRET {seller.siret} · APE {seller.ape}</small></dd></div><div><dt>Contact émetteur</dt><dd>{seller.email}</dd></div><div><dt>Client</dt><dd>{customer.companyName || customer.name}{customer.companyName ? <small>{customer.name}</small> : null}</dd></div>{customer.billingAddress ? <div><dt>Adresse client</dt><dd><address className="billing-customer-address">{billingAddressLines(customer.billingAddress).map((line, index) => <span key={`${index}:${line}`}>{line}</span>)}</address></dd></div> : null}<div><dt>Facture source</dt><dd>{creditNote.invoice.invoiceNumber}<small>{creditNote.invoice.orderNumberSnapshot}</small></dd></div><div><dt>Facture source émise le</dt><dd><time dateTime={creditNote.invoice.issuedAt.toISOString()}>{DATE_FORMAT.format(creditNote.invoice.issuedAt)}</time></dd></div><div><dt>Montant</dt><dd>{formatEuro(creditNote.amountCents)}</dd></div><div><dt>Avoirs cumulés</dt><dd>{formatEuro(creditNote.cumulativeCreditedCents)}</dd></div><div><dt>Solde documentaire restant</dt><dd>{formatEuro(creditNote.remainingBalanceCents)}</dd></div><div><dt>Nature du motif</dt><dd>{creditNoteReasonLabel(creditNote.reasonCode)}</dd></div>{creditNote.reasonText ? <div><dt>Précision du motif</dt><dd>{creditNote.reasonText}</dd></div> : null}<div><dt>Empreinte de l’avoir</dt><dd><code>{creditNote.snapshotHashSha256}</code></dd></div></dl>
      {presentation.warning ? <p className="admin-alert">{presentation.warning}</p> : null}
      <div className="admin-action-row" role="group" aria-label="Actions du document"><a className="admin-button admin-button--primary" href={`/api/billing/credit-notes/${encodeURIComponent(creditNote.creditNoteNumber)}/pdf`}>TÉLÉCHARGER LE PDF</a><Link className="admin-button admin-button--quiet" href={`/admin/facturation/${encodeURIComponent(creditNote.invoice.invoiceNumber)}`}>VOIR LA FACTURE SOURCE</Link></div>
    </section>
  </main>;
}
