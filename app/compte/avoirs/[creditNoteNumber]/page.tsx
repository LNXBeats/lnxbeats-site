import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { requireVerifiedUser } from "@/lib/auth/session";
import { getCreditNoteForMember } from "@/lib/billing/service";
import { formatEuro } from "@/lib/orders/domain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avoir", robots: { index: false, follow: false } };

export default async function MemberCreditNotePage({ params }: { params: Promise<{ creditNoteNumber: string }> }) {
  const session = await requireVerifiedUser("/compte");
  const { creditNoteNumber } = await params;
  const creditNote = await getCreditNoteForMember(creditNoteNumber, session.user.id);
  if (!creditNote) notFound();
  return <section className="auth-shell account-shell"><Container className="auth-shell__inner auth-shell__inner--account">
    <div className="auth-intro"><p className="eyebrow">Avoir · document QA</p><h1>{creditNote.creditNoteNumber}</h1><p>Correction de la facture {creditNote.invoice.invoiceNumber}, sans suppression ni réécriture du document d’origine.</p></div>
    <section className="auth-panel"><dl className="auth-profile"><div><dt>Émis le</dt><dd>{creditNote.issuedAt.toLocaleString("fr-FR")}</dd></div><div><dt>Montant</dt><dd>{formatEuro(creditNote.amountCents)}</dd></div><div><dt>Avoirs cumulés</dt><dd>{formatEuro(creditNote.cumulativeCreditedCents)}</dd></div><div><dt>Solde documentaire restant</dt><dd>{formatEuro(creditNote.remainingBalanceCents)}</dd></div><div><dt>Motif</dt><dd>{creditNote.reasonCode}</dd></div><div><dt>Facture</dt><dd>{creditNote.invoice.invoiceNumber}</dd></div></dl>
      <p className="legal-document__warning">DOCUMENT QA — SANS VALEUR COMPTABLE.</p>
      <p><a className="button" href={`/api/billing/credit-notes/${encodeURIComponent(creditNote.creditNoteNumber)}/pdf`}>Télécharger le PDF</a> <Link className="button button--quiet" href={`/compte/factures/${encodeURIComponent(creditNote.invoice.invoiceNumber)}`}>Retour à la facture</Link></p>
    </section>
  </Container></section>;
}
