import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { requireVerifiedUser } from "@/lib/auth/session";
import { parseBillingCustomerSnapshot } from "@/lib/billing/domain";
import { billingDocumentPresentation } from "@/lib/billing/presentation";
import { getInvoiceForMember } from "@/lib/billing/service";
import { formatEuro } from "@/lib/orders/domain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Facture", robots: { index: false, follow: false } };

export default async function MemberInvoicePage({ params }: { params: Promise<{ invoiceNumber: string }> }) {
  const session = await requireVerifiedUser("/compte");
  const { invoiceNumber } = await params;
  const invoice = await getInvoiceForMember(invoiceNumber, session.user.id);
  if (!invoice) notFound();
  const customer = parseBillingCustomerSnapshot(invoice.customerSnapshot);
  const presentation = billingDocumentPresentation("INVOICE", invoice.payment.mode);
  return <section className="auth-shell account-shell"><Container className="auth-shell__inner auth-shell__inner--account">
    <div className="auth-intro"><p className="eyebrow">{presentation.label}</p><h1>{invoice.invoiceNumber}</h1><p>Facture liée à la commande {invoice.orderNumberSnapshot}. Le PDF est généré depuis le snapshot immuable enregistré au paiement.</p></div>
    <section className="auth-panel"><dl className="auth-profile"><div><dt>Émise le</dt><dd>{invoice.issuedAt.toLocaleString("fr-FR")}</dd></div><div><dt>Montant</dt><dd>{formatEuro(invoice.totalCents)}</dd></div><div><dt>Paiement</dt><dd>{invoice.paymentMethodLabel}</dd></div><div><dt>TVA</dt><dd>{invoice.vatLegalNotice}</dd></div><div><dt>Commande</dt><dd>{invoice.orderNumberSnapshot}</dd></div><div><dt>Profil de facturation</dt><dd>{customer.type === "PROFESSIONAL" ? "Professionnel" : "Particulier"}</dd></div><div><dt>Destinataire</dt><dd>{customer.companyName || customer.name}{customer.companyName ? <small>{customer.name}</small> : null}</dd></div>{customer.billingAddress ? <div><dt>Adresse de facturation</dt><dd>{customer.billingAddress.line1}{customer.billingAddress.line2 ? <small>{customer.billingAddress.line2}</small> : null}<small>{customer.billingAddress.postalCode} {customer.billingAddress.city} · France</small></dd></div> : null}{customer.businessIdentifier ? <div><dt>SIREN / SIRET</dt><dd>{customer.businessIdentifier}</dd></div> : null}{customer.vatId ? <div><dt>Identifiant TVA client</dt><dd>{customer.vatId}</dd></div> : null}<div><dt>Empreinte</dt><dd><code>{invoice.snapshotHashSha256.slice(0, 16)}…</code></dd></div></dl>
      {presentation.warning ? <p className="legal-document__warning">{presentation.warning}</p> : null}
      <div className="billing-document-actions" role="group" aria-label="Actions du document">
        <a className="button button--primary billing-document-download" href={`/api/billing/invoices/${encodeURIComponent(invoice.invoiceNumber)}/pdf`}><span>Télécharger le PDF</span><span aria-hidden="true">↓</span></a>
        <Link className="button button--quiet" href="/compte"><span>Retour au compte</span></Link>
      </div>
    </section>
    {invoice.creditNotes.length ? <section className="member-orders"><h2>Avoirs liés</h2><ul className="member-order-list">{invoice.creditNotes.map((creditNote) => <li key={creditNote.id}><Link href={`/compte/avoirs/${encodeURIComponent(creditNote.creditNoteNumber)}`}><span><strong>{creditNote.creditNoteNumber}</strong><small>{creditNote.issuedAt.toLocaleDateString("fr-FR")}</small></span><strong>{formatEuro(creditNote.amountCents)}</strong></Link></li>)}</ul></section> : null}
  </Container></section>;
}
