import { getSiteLocale, serverDate, serverMoney, serverT } from "@/lib/i18n/server";
import { T, ContractLanguageNotice } from "@/components/site-language";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { requireVerifiedUser } from "@/lib/auth/session";
import { billingAddressLines } from "@/lib/billing/address-presentation";
import { parseBillingCustomerSnapshot } from "@/lib/billing/domain";
import { billingDocumentPresentation } from "@/lib/billing/presentation";
import { getInvoiceForMember } from "@/lib/billing/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Facture", robots: { index: false, follow: false } };

export default async function MemberInvoicePage({ params }: { params: Promise<{ invoiceNumber: string }> }) {
  const locale = await getSiteLocale();
  const session = await requireVerifiedUser("/compte");
  const { invoiceNumber } = await params;
  const invoice = await getInvoiceForMember(invoiceNumber, session.user.id);
  if (!invoice) notFound();
  const customer = parseBillingCustomerSnapshot(invoice.customerSnapshot);
  const presentation = billingDocumentPresentation("INVOICE", invoice.payment.mode);
  return <section className="auth-shell account-shell billing-document-page"><Container className="auth-shell__inner auth-shell__inner--account">
    <div className="auth-intro"><p className="eyebrow">{<T text={presentation.label} />}</p><h1 className="technical-reference technical-reference--hero">{invoice.invoiceNumber}</h1><p><T text="Facture liée à la commande" />{" "}<span className="technical-reference technical-reference--inline">{invoice.orderNumberSnapshot}</span><T text=". Le PDF est généré depuis le snapshot immuable enregistré au paiement." /></p></div>
    <ContractLanguageNotice /><section className="auth-panel"><dl className="auth-profile"><div><dt><T text="Émise le" /></dt><dd>{serverDate(locale, invoice.issuedAt, {dateStyle:"short",timeStyle:"short"})}</dd></div><div><dt><T text="Montant" /></dt><dd>{serverMoney(locale,invoice.totalCents)}</dd></div><div><dt><T text="Paiement" /></dt><dd>{invoice.paymentMethodLabel}</dd></div><div><dt><T text="TVA" /></dt><dd><span lang="fr" translate="no" className="notranslate">{invoice.vatLegalNotice}</span></dd></div><div><dt><T text="Commande" /></dt><dd>{invoice.orderNumberSnapshot}</dd></div><div><dt><T text="Profil de facturation" /></dt><dd>{customer.type === "PROFESSIONAL" ? <T text="Professionnel" /> : <T text="Particulier" />}</dd></div><div><dt><T text="Destinataire" /></dt><dd>{customer.companyName || customer.name}{customer.companyName ? <small>{customer.name}</small> : null}</dd></div>{customer.billingAddress ? <div><dt><T text="Adresse de facturation" /></dt><dd><address className="billing-customer-address">{billingAddressLines(customer.billingAddress).map((line, index) => <span key={`${index}:${line}`}>{line}</span>)}</address></dd></div> : null}{customer.businessIdentifier ? <div><dt>SIREN / SIRET</dt><dd>{customer.businessIdentifier}</dd></div> : null}{customer.vatId ? <div><dt><T text="Identifiant TVA client" /></dt><dd>{customer.vatId}</dd></div> : null}<div><dt><T text="Empreinte" /></dt><dd><code>{invoice.snapshotHashSha256.slice(0, 16)}…</code></dd></div></dl>
      {presentation.warning ? <p className="legal-document__warning">{<T text={presentation.warning} />}</p> : null}
      <div className="billing-document-actions" role="group" aria-label={serverT(locale, "Actions du document")}>
        <a className="button button--primary billing-document-download" href={`/api/billing/invoices/${encodeURIComponent(invoice.invoiceNumber)}/pdf`}><span><T text="Télécharger le PDF" /></span><span aria-hidden="true">↓</span></a>
        <Link className="button button--quiet" href="/compte"><span><T text="Retour au compte" /></span></Link>
      </div>
    </section>
    {invoice.creditNotes.length ? <section className="member-orders"><h2><T text="Avoirs liés" /></h2><ul className="member-order-list">{invoice.creditNotes.map((creditNote) => <li key={creditNote.id}><Link href={`/compte/avoirs/${encodeURIComponent(creditNote.creditNoteNumber)}`}><span><strong className="technical-reference technical-reference--list">{creditNote.creditNoteNumber}</strong><small>{serverDate(locale, creditNote.issuedAt, {dateStyle:"short"})}</small></span><strong>{serverMoney(locale,creditNote.amountCents)}</strong></Link></li>)}</ul></section> : null}
  </Container></section>;
}
