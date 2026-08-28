import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { parseBillingCustomerSnapshot } from "@/lib/billing/domain";
import { getInvoiceForAdmin } from "@/lib/billing/service";
import { formatEuro } from "@/lib/orders/domain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Facture" };

export default async function AdminInvoicePage({ params }: { params: Promise<{ invoiceNumber: string }> }) {
  await requireAdmin();
  const { invoiceNumber } = await params;
  const invoice = await getInvoiceForAdmin(invoiceNumber);
  if (!invoice) notFound();
  const customer = parseBillingCustomerSnapshot(invoice.customerSnapshot);
  return <main className="admin-main">
    <AdminBackLink href="/admin/facturation">Retour à la facturation</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-section-label">Facture · document QA</p><h1>{invoice.invoiceNumber}</h1></div><p>Snapshot immuable lié à {invoice.orderNumberSnapshot}. Les données carte, secrets fournisseur et payloads bruts ne sont jamais exposés.</p></header>
    <section className="admin-panel"><dl className="admin-definition-grid"><div><dt>Émission</dt><dd>{invoice.issuedAt.toLocaleString("fr-FR")}</dd></div><div><dt>Client</dt><dd>{customer.companyName || customer.name}<small>{customer.type === "PROFESSIONAL" ? `Professionnel · ${customer.name}` : "Particulier"}</small></dd></div>{customer.billingAddress ? <div><dt>Facturation</dt><dd>{customer.billingAddress.line1}<small>{customer.billingAddress.postalCode} {customer.billingAddress.city} · France</small></dd></div> : null}{customer.businessIdentifier ? <div><dt>SIREN / SIRET client</dt><dd>{customer.businessIdentifier}</dd></div> : null}{customer.vatId ? <div><dt>TVA client</dt><dd>{customer.vatId}</dd></div> : null}<div><dt>Total</dt><dd>{formatEuro(invoice.totalCents)}</dd></div><div><dt>Paiement</dt><dd>{invoice.paymentMethodLabel}<small>{invoice.paidAt.toLocaleString("fr-FR")}</small></dd></div><div><dt>TVA vendeur</dt><dd>{invoice.vatLegalNotice}</dd></div><div><dt>Empreinte</dt><dd><code>{invoice.snapshotHashSha256}</code></dd></div></dl>
      <p className="admin-alert">DOCUMENT QA — SANS VALEUR COMPTABLE. Activation juridique et comptable non autorisée.</p>
      <p className="admin-action-row"><a className="admin-button" href={`/api/billing/invoices/${encodeURIComponent(invoice.invoiceNumber)}/pdf`}>TÉLÉCHARGER LE PDF</a>{invoice.documentType === "SHOP" ? <Link className="admin-button admin-button--quiet" href={`/admin/boutique/commandes/${encodeURIComponent(invoice.orderNumberSnapshot)}`}>VOIR LA COMMANDE</Link> : <Link className="admin-button admin-button--quiet" href={`/admin/commandes/${encodeURIComponent(invoice.orderNumberSnapshot)}`}>VOIR LA COMMANDE</Link>}</p>
    </section>
    <section className="admin-panel"><div className="admin-panel__heading"><p className="admin-section-label">Corrections</p><h2>Avoirs</h2></div>{invoice.creditNotes.length ? <ul className="admin-card-list">{invoice.creditNotes.map((note) => <li key={note.id}><strong>{note.creditNoteNumber} · {formatEuro(note.amountCents)}</strong><small>{note.issuedAt.toLocaleString("fr-FR")} · {note.reasonCode}</small><Link href={`/admin/facturation/avoirs/${encodeURIComponent(note.creditNoteNumber)}`}>Consulter l’avoir</Link></li>)}</ul> : <p>Aucun avoir lié.</p>}</section>
    <section className="admin-panel"><div className="admin-panel__heading"><p className="admin-section-label">Audit</p><h2>Journal append-only</h2></div><ul className="admin-timeline">{invoice.auditEvents.map((event) => <li key={event.id}><time>{event.createdAt.toLocaleString("fr-FR")}</time><p>{event.action}</p><small>{event.actorUserId ? "Action authentifiée" : "Émission transactionnelle système"}</small></li>)}</ul></section>
  </main>;
}
