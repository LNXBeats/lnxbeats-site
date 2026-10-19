import type { Metadata } from "next";
import Link from "next/link";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { listAdminInvoices } from "@/lib/billing/service";
import { formatEuro } from "@/lib/orders/domain";
import { listAdminDigitalInvoices } from "@/lib/admin/digital-invoices";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Facturation" };

export default async function AdminBillingPage({ searchParams }: { searchParams: Promise<{ recherche?: string }> }) {
  await requireAdmin();
  const { recherche } = await searchParams;
  const [invoices, digital] = await Promise.all([listAdminInvoices(recherche), listAdminDigitalInvoices(recherche)]);
  return <main className="admin-main">
    <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-section-label">Facturation</p><h1>Factures et avoirs.</h1></div><p>Documents immuables émis après confirmation serveur du paiement. Les paiements TEST restent identifiés comme tels dans leurs rendus.</p></header>
    <form className="admin-search-form" action="/admin/facturation">
      <label htmlFor="admin-billing-search">Recherche</label>
      <input id="admin-billing-search" type="search" name="recherche" defaultValue={recherche} maxLength={120} placeholder="Facture, commande, client…" />
      <button className="admin-button" type="submit">RECHERCHER</button>
    </form>
    <section className="admin-panel"><div className="admin-panel__heading"><p className="admin-section-label">Musique numérique</p><h2>{digital.rows.length} document{digital.rows.length === 1 ? "" : "s"}{digital.limited ? " les plus récents (vue limitée)" : ""}</h2></div>
      <p>Factures et avoirs déjà émis pour les titres et albums. Les PDF et numéros d’origine sont conservés. <Link href="/admin/recettes">Voir toutes les recettes →</Link></p>
      {digital.rows.length ? <ul className="admin-billing-digital-list">{digital.rows.map(d => <li key={d.id} style={{ paddingBlock: "1rem", borderBottom: "1px solid #ffffff20", overflowWrap: "anywhere" }}>
        <strong>{d.number}</strong> · {d.kind === "INVOICE" ? "Facture" : "Avoir"} · {d.mode} · {d.status === "READY" ? "PDF prêt" : "PDF en préparation / à examiner"}
        <p>{d.title} · {d.customer} · {Number.isSafeInteger(d.amountCents) ? formatEuro(d.amountCents!) : "Montant à vérifier"}</p>
        <p>{d.createdAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} · <Link href={`/admin/musique/achats/${d.orderId}`}>Ouvrir l’achat</Link>{d.status === "READY" ? <> · <a href={`/api/digital/documents/${d.id}`}>Télécharger le PDF privé</a></> : null}</p>
      </li>)}</ul> : <p>Aucun document numérique dans cette recherche.</p>}
    </section>
    <section className="admin-panel"><div className="admin-panel__heading"><p className="admin-section-label">Registre</p><h2>{invoices.length} facture{invoices.length === 1 ? "" : "s"}</h2></div>
      {invoices.length ? <>
        <div className="admin-table-wrap admin-desktop-records" tabIndex={0} role="region" aria-label="Registre des factures, défilement horizontal disponible">
          <table><thead><tr><th>Facture</th><th>Commande</th><th>Client</th><th>Montant</th><th>Avoirs</th></tr></thead><tbody>{invoices.map((invoice) => {
            const creditNoteTotal = invoice.creditNotes.reduce((sum, note) => sum + note.amountCents, 0);
            return <tr key={invoice.id}><td><Link href={`/admin/facturation/${encodeURIComponent(invoice.invoiceNumber)}`}>{invoice.invoiceNumber}</Link><small>{invoice.issuedAt.toLocaleString("fr-FR")} · {invoice.documentType}</small></td><td>{invoice.orderNumberSnapshot}</td><td>{invoice.customerNameSearch}<small>{invoice.customerEmailSearch}</small></td><td>{formatEuro(invoice.totalCents)}<small>{invoice.paymentMethodLabel}</small></td><td>{invoice.creditNotes.length}<small>{creditNoteTotal ? formatEuro(creditNoteTotal) : "—"}</small></td></tr>;
          })}</tbody></table>
        </div>
        <ul className="admin-mobile-records admin-billing-records" aria-label="Registre des factures">{invoices.map((invoice) => {
          const creditNoteTotal = invoice.creditNotes.reduce((sum, note) => sum + note.amountCents, 0);
          return <li key={invoice.id}>
            <div className="admin-record-card__heading">
              <div><span>Facture</span><Link href={`/admin/facturation/${encodeURIComponent(invoice.invoiceNumber)}`}>{invoice.invoiceNumber}</Link></div>
              <strong>{formatEuro(invoice.totalCents)}</strong>
            </div>
            <p>{invoice.customerNameSearch}<small>{invoice.customerEmailSearch}</small></p>
            <dl className="admin-record-card__facts">
              <div><dt>Commande</dt><dd>{invoice.orderNumberSnapshot}</dd></div>
              <div><dt>Émission</dt><dd>{invoice.issuedAt.toLocaleString("fr-FR")}</dd></div>
              <div><dt>Document</dt><dd>{invoice.documentType}</dd></div>
              <div><dt>Paiement</dt><dd>{invoice.paymentMethodLabel}</dd></div>
              <div><dt>Avoirs</dt><dd>{invoice.creditNotes.length} · {creditNoteTotal ? formatEuro(creditNoteTotal) : "—"}</dd></div>
            </dl>
          </li>;
        })}</ul>
      </> : <p className="admin-empty-state">Aucune facture dans cette vue.</p>}
    </section>
  </main>;
}
