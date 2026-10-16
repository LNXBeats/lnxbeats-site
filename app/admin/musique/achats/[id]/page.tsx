import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { listDigitalFinance } from "@/lib/digital/finance";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { DigitalRefundForm,DigitalRefundOperations } from "@/components/digital-refund";
import styles from "@/components/digital.module.css";
import { digitalUiIsLive } from "@/components/digital-mode-copy";
import { digitalFinanceGateway } from "@/lib/digital/finance-providers";
import { assertDigitalRefundOperation, digitalPaypalClient, digitalStripeClient } from "@/lib/digital/providers";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Achat numérique Admin", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  try { requireDigitalEnvironment(); } catch { notFound(); }
  const session = await requireAdmin(), { id } = await params, o = await listDigitalFinance(session.user.id, id, true); if (!o) notFound();
  const mode=digitalUiIsLive(o.mode)?"LIVE":"TEST",provider=o.attempts.find(a=>a.status==="PAID")?.provider;let authorized=false,reconciliationAuthorized=false;
  if(provider){try{digitalFinanceGateway(provider,mode);reconciliationAuthorized=true;const configuration=provider==="STRIPE"?digitalStripeClient(mode).configuration:provider==="PAYPAL"?digitalPaypalClient(mode).configuration:null;if(configuration){assertDigitalRefundOperation(mode,configuration);authorized=true;}}catch{/* The server rechecks every operation; no provider request is performed while rendering. */}}
  return <div className="admin-main"><header className="admin-page-heading"><div><p className="admin-kicker">DCN · {mode==="LIVE"?"LIVE":"local TEST"}</p><h1>Achat numérique.</h1></div><Link href="/admin/musique">Registre numérique</Link></header>
    <div className={styles.grid}><section className={styles.panel}><h2>{o.lines.map(l => l.title).join(" · ")}</h2><p>{o.status} · {o.totalCents} centimes EUR · {mode}</p><p className={styles.muted}>Référence {o.id}</p><h3>Versions figées</h3>{o.lines.map(l => <article key={l.id}><strong>{l.scope === "ALBUM" ? "Album numérique" : "Titre numérique"} — {l.title}</strong><p>Prix acquis : {l.priceCents} centimes. Offre v{l.offerVersion}.</p><ul>{(l.trackSnapshot as Array<{ title: string; masterId: string }>).map(t => <li key={t.masterId}>{t.title} · version privée identifiée dans le snapshot</li>)}</ul></article>)}
      <h3>Confirmation et fourniture</h3><p>{o.fulfillment?.confirmationStatus ?? (o.contractSnapshot ? "Paiement/confirmation à vérifier" : "Acquisition historique conservée")} · {o.fulfillment?.accessReadyAt ? mode==="LIVE"?"fourniture prête":"fourniture QA prête" : "aucune nouvelle preuve de remise inventée"}</p>
      <h3>Justificatifs immuables</h3><ul>{o.documents.map(d => <li key={d.id}>{d.kind} · {d.number} · {d.status} {d.status === "READY" ? <a href={`/api/digital/documents/${d.id}`}>{mode==="LIVE"?"PDF privé":"PDF privé QA"}</a> : null}</li>)}</ul>
      <h3>Notifications</h3>{o.notifications.map((n, i) => <p key={i}>{n.kind} · {n.status} · {n.attempts} tentative(s). Délivrance : {n.deliveredAt ? "confirmée" : "non démontrée"}.</p>)}</section>
      <section className={styles.panel}><h2>Finance et incidents</h2>{o.attempts.map(a => <p key={a.id}>{a.provider} · {a.status}<br />{a.paymentReference ?? "Pas de capture confirmée"}</p>)}
        <h3>Remboursements</h3>{o.refunds.length ? o.refunds.map(r => <p key={r.id}>{r.amountCents} centimes · {r.purpose} · {r.status} · allocation {r.allocationStatus}<br />{r.providerReference ?? "Résultat prestataire non confirmé"}</p>) : <p>Aucune restitution.</p>}
        <DigitalRefundOperations mode={mode} orderId={o.id} refunds={o.refunds.map(r=>({id:r.id,status:r.status,amountCents:r.amountCents}))} authorized={authorized} reconciliationAuthorized={reconciliationAuthorized}/>
        <h3>Litiges</h3>{o.disputes.length ? o.disputes.map(d => <p key={d.id}>{d.provider} · {d.status} · {d.amountCents} centimes. La suspension{mode==="TEST"?" QA":""} est ciblée sur cet achat, sans accusation de fraude.</p>) : <p>Aucun litige.</p>}
        <h3>Audit append-only</h3><ul>{o.events.map(e => <li key={e.id}>{e.createdAt.toLocaleString("fr-FR")} · {e.kind}</li>)}</ul></section></div>
    {["PAID", "PARTIALLY_REFUNDED"].includes(o.status) ? <DigitalRefundForm mode={mode} orderId={o.id} lines={o.lines.map(l => ({ id: l.id, title: l.title, priceCents: l.priceCents }))} /> : <p className={styles.note}>Nouvelle restitution fermée tant que l’état financier n’est pas compatible.</p>}</div>;
}
