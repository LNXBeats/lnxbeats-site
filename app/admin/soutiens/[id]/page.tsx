import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { formatEuro } from "@/lib/orders/domain";
import { isSupportEnabled } from "@/lib/support/config";
import { getAdminSupportContribution } from "@/lib/support/service";
import { refundSupportAction } from "@/app/admin/soutiens/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Détail du soutien", robots: { index: false, follow: false } };
export default async function AdminSupportDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ etat?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const entry = await getAdminSupportContribution(id);
  if (!entry) notFound();
  const { etat } = await searchParams;
  return <main className="admin-main">
    <AdminBackLink href="/admin/soutiens">Retour aux soutiens</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-section-label">Soutien libre · TEST</p><h1>{formatEuro(entry.amountCents)}</h1></div><p>{entry.provider} · {entry.status}</p></header>
    {etat ? <p role="status">{etat === "traitement" ? "Demande traitée. Consultez le statut et l’audit ci-dessous." : "Remboursement non confirmé. Aucune réussite n’est présumée : vérifiez le statut avant toute nouvelle demande."}</p> : null}
    <section className="admin-panel"><h2>Trace du versement</h2><dl>
      <dt>Identifiant du soutien</dt><dd>{entry.id}</dd>
      <dt>Date</dt><dd>{entry.createdAt.toLocaleString("fr-FR")}</dd>
      <dt>Référence du prestataire</dt><dd>{entry.providerReference ?? "—"}</dd>
      <dt>Référence du paiement</dt><dd>{entry.paymentReference ?? "—"}</dd>
      <dt>Référence du remboursement</dt><dd>{entry.refundReference ?? "—"}</dd>
    </dl><p>Soutien sans contrepartie. Aucune facture de vente, aucun reçu fiscal, aucune commande ni droit créés.</p></section>
    <section className="admin-panel"><h2>Piste d’audit</h2><ol>{entry.events.map((event) => <li key={event.id}>{event.createdAt.toLocaleString("fr-FR")} · {event.type}{event.actorId ? " · Action Admin" : ""}</li>)}</ol></section>
    {["SUCCEEDED", "REFUND_PENDING"].includes(entry.status) && isSupportEnabled() ? <section className="admin-panel"><h2>Remboursement volontaire</h2><p>Remboursement intégral TEST uniquement. Action explicite, journalisée et idempotente. Ne la déclenchez pas pour vérifier un paiement réel.</p>
      <form action={refundSupportAction} className="admin-form"><input type="hidden" name="contributionId" value={entry.id} /><label htmlFor="support-refund-confirm">Saisissez exactement : REMBOURSER {entry.id}</label><input id="support-refund-confirm" name="confirmation" required maxLength={80} autoComplete="off" /><button className="admin-button admin-button--secondary" type="submit">Demander le remboursement TEST</button></form>
    </section> : null}
  </main>;
}
