import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { listDigitalFinance } from "@/lib/digital/finance";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { DigitalRefundForm,DigitalRefundOperations } from "@/components/digital-refund";
import styles from "@/components/digital.module.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Achat numérique Admin", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  try { requireDigitalEnvironment(); } catch { notFound(); }
  const session = await requireAdmin(), { id } = await params, o = await listDigitalFinance(session.user.id, id, true); if (!o) notFound();
  return <div className="admin-main"><header className="admin-page-heading"><div><p className="admin-kicker">DCN‑1.1 · local TEST</p><h1>Achat numérique.</h1></div><Link href="/admin/musique">Registre numérique</Link></header>
    <div className={styles.grid}><section className={styles.panel}><h2>{o.lines.map(l => l.title).join(" · ")}</h2><p>{o.status} · {o.totalCents} centimes EUR · TEST</p><p className={styles.muted}>Référence {o.id}</p><h3>Versions figées</h3>{o.lines.map(l => <article key={l.id}><strong>{l.scope === "ALBUM" ? "Album numérique" : "Titre numérique"} — {l.title}</strong><p>Prix acquis : {l.priceCents} centimes. Offre v{l.offerVersion}.</p><ul>{(l.trackSnapshot as Array<{ title: string; masterId: string }>).map(t => <li key={t.masterId}>{t.title} · version privée identifiée dans le snapshot</li>)}</ul></article>)}
      <h3>Confirmation et fourniture</h3><p>{o.fulfillment?.confirmationStatus ?? (o.contractSnapshot ? "Paiement/confirmation à vérifier" : "Acquisition DCN‑1.0 conservée")} · {o.fulfillment?.accessReadyAt ? "fourniture QA prête" : "aucune nouvelle preuve de remise inventée"}</p>
      <h3>Justificatifs immuables</h3><ul>{o.documents.map(d => <li key={d.id}>{d.kind} · {d.number} · {d.status} {d.status === "READY" ? <a href={`/api/digital/documents/${d.id}`}>PDF privé QA</a> : null}</li>)}</ul>
      <h3>Notifications</h3>{o.notifications.map((n, i) => <p key={i}>{n.kind} · {n.status} · {n.attempts} tentative(s). Délivrance : {n.deliveredAt ? "confirmée" : "non démontrée"}.</p>)}</section>
      <section className={styles.panel}><h2>Finance et incidents</h2>{o.attempts.map(a => <p key={a.id}>{a.provider} · {a.status}<br />{a.paymentReference ?? "Pas de capture confirmée"}</p>)}
        <h3>Remboursements</h3>{o.refunds.length ? o.refunds.map(r => <p key={r.id}>{r.amountCents} centimes · {r.purpose} · {r.status} · allocation {r.allocationStatus}<br />{r.providerReference ?? "Résultat prestataire non confirmé"}</p>) : <p>Aucune restitution.</p>}
        <DigitalRefundOperations orderId={o.id} refunds={o.refunds.map(r=>({id:r.id,status:r.status,amountCents:r.amountCents}))} authorized={process.env.DCN_EXTERNAL_TEST_AUTHORIZED==="true"}/>
        <h3>Litiges</h3>{o.disputes.length ? o.disputes.map(d => <p key={d.id}>{d.provider} · {d.status} · {d.amountCents} centimes. La suspension QA est ciblée sur cet achat, sans accusation de fraude.</p>) : <p>Aucun litige.</p>}
        <h3>Audit append-only</h3><ul>{o.events.map(e => <li key={e.id}>{e.createdAt.toLocaleString("fr-FR")} · {e.kind}</li>)}</ul></section></div>
    {["PAID", "PARTIALLY_REFUNDED"].includes(o.status) ? <DigitalRefundForm orderId={o.id} lines={o.lines.map(l => ({ id: l.id, title: l.title, priceCents: l.priceCents }))} /> : <p className={styles.note}>Nouvelle restitution fermée tant que l’état financier n’est pas compatible.</p>}</div>;
}
