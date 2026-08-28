import type { Metadata } from "next";
import Link from "next/link";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { listAdminInvoices } from "@/lib/billing/service";
import { formatEuro } from "@/lib/orders/domain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Facturation" };

export default async function AdminBillingPage({ searchParams }: { searchParams: Promise<{ recherche?: string }> }) {
  await requireAdmin();
  const { recherche } = await searchParams;
  const invoices = await listAdminInvoices(recherche);
  return <main className="admin-main">
    <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-section-label">Facturation</p><h1>Factures et avoirs.</h1></div><p>Documents immuables émis après confirmation serveur du paiement. Phase 4B : PDFs marqués QA, activation comptable interdite.</p></header>
    <form className="admin-filters" action="/admin/facturation"><label>Recherche <input type="search" name="recherche" defaultValue={recherche} maxLength={120} placeholder="Facture, commande, client…" /></label><button className="admin-button" type="submit">RECHERCHER</button></form>
    <section className="admin-panel"><div className="admin-panel__heading"><p className="admin-section-label">Registre</p><h2>{invoices.length} facture{invoices.length === 1 ? "" : "s"}</h2></div>
      <div className="admin-table-wrap"><table><thead><tr><th>Facture</th><th>Commande</th><th>Client</th><th>Montant</th><th>Avoirs</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><Link href={`/admin/facturation/${encodeURIComponent(invoice.invoiceNumber)}`}>{invoice.invoiceNumber}</Link><small>{invoice.issuedAt.toLocaleString("fr-FR")} · {invoice.documentType}</small></td><td>{invoice.orderNumberSnapshot}</td><td>{invoice.customerNameSearch}<small>{invoice.customerEmailSearch}</small></td><td>{formatEuro(invoice.totalCents)}<small>{invoice.paymentMethodLabel}</small></td><td>{invoice.creditNotes.length}<small>{invoice.creditNotes.reduce((sum, note) => sum + note.amountCents, 0) ? formatEuro(invoice.creditNotes.reduce((sum, note) => sum + note.amountCents, 0)) : "—"}</small></td></tr>)}</tbody></table>{!invoices.length ? <p>Aucune facture dans cette vue.</p> : null}</div>
    </section>
  </main>;
}
