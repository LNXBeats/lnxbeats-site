import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { getCreditNoteForAdmin } from "@/lib/billing/service";
import { formatEuro } from "@/lib/orders/domain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avoir", robots: { index: false, follow: false } };

export default async function AdminCreditNotePage({ params }: { params: Promise<{ creditNoteNumber: string }> }) {
  await requireAdmin();
  const { creditNoteNumber } = await params;
  const creditNote = await getCreditNoteForAdmin(creditNoteNumber);
  if (!creditNote) notFound();
  return <main className="admin-main">
    <AdminBackLink href={`/admin/facturation/${encodeURIComponent(creditNote.invoice.invoiceNumber)}`}>Retour à la facture</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-section-label">Avoir · document QA</p><h1>{creditNote.creditNoteNumber}</h1></div><p>Correction immuable liée à la facture {creditNote.invoice.invoiceNumber}. Aucun montant de la facture source n’est réécrit.</p></header>
    <section className="admin-panel">
      <dl className="admin-definition-grid"><div><dt>Émission</dt><dd>{creditNote.issuedAt.toLocaleString("fr-FR")}</dd></div><div><dt>Facture source</dt><dd>{creditNote.invoice.invoiceNumber}<small>{creditNote.invoice.orderNumberSnapshot}</small></dd></div><div><dt>Montant</dt><dd>{formatEuro(creditNote.amountCents)}</dd></div><div><dt>Avoirs cumulés</dt><dd>{formatEuro(creditNote.cumulativeCreditedCents)}</dd></div><div><dt>Solde documentaire restant</dt><dd>{formatEuro(creditNote.remainingBalanceCents)}</dd></div><div><dt>Motif</dt><dd>{creditNote.reasonCode}</dd></div><div><dt>Empreinte</dt><dd><code>{creditNote.snapshotHashSha256}</code></dd></div></dl>
      <p className="admin-alert">DOCUMENT QA — SANS VALEUR COMPTABLE. Aucun bouton de modification ou suppression n’est exposé.</p>
      <div className="admin-action-row" role="group" aria-label="Actions du document"><a className="admin-button admin-button--primary" href={`/api/billing/credit-notes/${encodeURIComponent(creditNote.creditNoteNumber)}/pdf`}>TÉLÉCHARGER LE PDF</a><Link className="admin-button admin-button--quiet" href={`/admin/facturation/${encodeURIComponent(creditNote.invoice.invoiceNumber)}`}>VOIR LA FACTURE SOURCE</Link></div>
    </section>
  </main>;
}
