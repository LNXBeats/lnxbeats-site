import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { formatEuro } from "@/lib/orders/domain";
import { supportMode } from "@/lib/support/config";
import { getAdminSupportContribution } from "@/lib/support/service";
import { refundSupportAction, reconcileSupportAction } from "@/app/admin/soutiens/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Détail du soutien", robots: { index: false, follow: false } };
export default async function AdminSupportDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ etat?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const entry = await getAdminSupportContribution(id);
  if (!entry) notFound();
  const sameMode = supportMode() === entry.mode;
  const refundAllowed = sameMode && (entry.mode === "TEST" || process.env.SUPPORT_LIVE_REFUNDS_ENABLED === "true" || entry.status === "REFUND_PENDING");
  const { etat } = await searchParams;
  return <main className="admin-main">
    <AdminBackLink href="/admin/soutiens">Retour aux soutiens</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-section-label">Soutien libre · {entry.mode}</p><h1>{formatEuro(entry.amountCents)}</h1></div><p>{entry.provider} · {entry.status}</p></header>
    {etat ? <p role="status">{etat === "traitement" ? "Demande traitée. Consultez le statut et l’audit ci-dessous." : "Remboursement non confirmé. Aucune réussite n’est présumée : vérifiez le statut avant toute nouvelle demande."}</p> : null}
    <section className="admin-panel"><h2>Trace du versement</h2><dl>
      <dt>Identifiant du soutien</dt><dd>{entry.id}</dd>
      <dt>Date</dt><dd>{entry.createdAt.toLocaleString("fr-FR")}</dd>
      <dt>Référence du prestataire</dt><dd>{entry.providerReference ?? "—"}</dd>
      <dt>Référence du paiement</dt><dd>{entry.paymentReference ?? "—"}</dd>
      <dt>Référence du remboursement</dt><dd>{entry.refundReference ?? "—"}</dd>
    </dl><p>Soutien sans contrepartie. Aucune facture de vente, aucun reçu fiscal, aucune commande ni droit créés.</p></section>
    <section className="admin-panel"><h2>Message et confirmations</h2><dl><dt>E-mail facultatif</dt><dd>{entry.supporterEmail ?? "Non renseigné"}</dd><dt>Un petit mot pour LNX Beats</dt><dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.supporterMessage ?? "Aucun message"}</dd></dl><ul>{["SUPPORTER", "ADMIN"].map(audience => { const notification = entry.notifications.find(value => value.audience === audience); return <li key={audience}>{audience === "ADMIN" ? "Notification LNX Beats" : "Confirmation au soutien"} : {notification?.status ?? "Non programmée"}{notification?.sentAt ? ` · ${notification.sentAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}` : ""}</li>; })}</ul></section>
    <section className="admin-panel"><h2>Tentatives</h2><ul>{entry.attempts.map(a => <li key={a.id}>{a.id} · {a.operation} · {a.status} · {a.lastCheckedAt?.toLocaleString("fr-FR") ?? "À vérifier"}</li>)}</ul><h2>Piste d’audit</h2><ol>{entry.events.map((event) => <li key={event.id}>{event.createdAt.toLocaleString("fr-FR")} · {event.type}{event.actorId ? " · Action Admin" : ""}{event.type === "EVIDENCE_MISMATCH" ? <pre>{JSON.stringify(event.evidence, null, 2)}</pre> : null}</li>)}</ol></section>
    {entry.attempts.some(a => a.status === "REQUESTED") && sameMode ? <section className="admin-panel"><h2>Retrouver un résultat inconnu</h2><p>Référence copiée depuis le Dashboard {entry.mode} du prestataire. Une lecture serveur valide le montant et le rattachement ; elle ne déclenche aucun paiement.</p><form action={reconcileSupportAction}><input type="hidden" name="contributionId" value={entry.id} /><label>Opération<select name="operation"><option value="CHECKOUT">Préparation du paiement</option><option value="REFUND">Remboursement déjà demandé</option></select></label><label>Référence prestataire<input name="reference" required maxLength={255} /></label><button className="admin-button admin-button--secondary">Vérifier la référence</button></form></section> : null}
    {["SUCCEEDED", "REFUND_PENDING"].includes(entry.status) && refundAllowed ? <section className="admin-panel"><h2>Remboursement volontaire</h2><p>Remboursement intégral {entry.mode} de {formatEuro(entry.amountCents)} via {entry.provider}. Action explicite, journalisée et idempotente. Ne la déclenchez pas pour vérifier un paiement réel.</p>
      <form action={refundSupportAction} className="admin-form"><input type="hidden" name="contributionId" value={entry.id} /><label htmlFor="support-refund-confirm">Saisissez exactement : REMBOURSER {entry.id}</label><input id="support-refund-confirm" name="confirmation" required maxLength={80} autoComplete="off" /><button className="admin-button admin-button--secondary" type="submit">Demander le remboursement {entry.mode}</button></form>
    </section> : null}
  </main>;
}
