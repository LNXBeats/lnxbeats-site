import "server-only";
import { prisma } from "@/lib/prisma";
import { revenuePeriod, revenueSummary, type RevenueEntry, type RevenueMode } from "./revenue-policy";

const LIMIT = 20000;
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v : "";

/** Cash movements, NOT invoice totals, PSP payouts or an automatic tax return.
 * Read-only consistent snapshot. Never excludes a LIVE sale on an operational
 * hide flag or the customer's name; no external DistroKid receipt is imported. */
export async function loadRevenue({ from, to, mode = "LIVE" }: { from?: string; to?: string; mode?: RevenueMode } = {}) {
  const period = revenuePeriod(from, to);
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const [payments, digital, unmatchedReceipts] = await Promise.all([
      tx.payment.findMany({ where: { mode, paidAt: { not: null }, OR: [{ orderId: { not: null } }, { shopOrderId: { not: null } }] }, take: LIMIT + 1,
        select: { id: true, status: true, orderId: true, shopOrderId: true, paidAt: true, amountCents: true, currency: true, provider: true, providerPaymentId: true, refundedAmountCents: true,
          order: { select: { orderNumber: true, title: true } }, shopOrder: { select: { orderNumber: true } },
          invoice: { select: { invoiceNumber: true, customerNameSearch: true } },
          refundAttempts: { where: { status: "SUCCEEDED" }, select: { id: true, amountCents: true, currency: true, confirmedAt: true, providerRefundId: true, creditNotes: { select: { creditNoteNumber: true } } } } } }),
      tx.digitalOrder.findMany({ where: { mode, attempts: { some: { status: "PAID" } } }, take: LIMIT + 1,
        select: { id: true, totalCents: true, currency: true, status: true, lines: { select: { title: true } },
          attempts: { where: { status: "PAID" }, select: { id: true, provider: true, paymentReference: true } },
          documents: { where: { kind: { in: ["INVOICE", "CREDIT_NOTE"] } }, select: { id: true, number: true, kind: true, snapshot: true, status: true } },
          refunds: { where: { status: "SUCCEEDED" }, select: { id: true, amountCents: true, currency: true, confirmedAt: true, providerReference: true } },
          disputes: { where: { status: { in: ["OPEN", "LOST", "REQUIRES_REVIEW"] } }, select: { id: true } } } }),
      tx.providerEvent.count({ where: { livemode: mode === "LIVE", outcome: "REQUIRES_REVIEW", paymentId: null, technicalReview: { is: null },
        type: { in: ["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.REFUNDED", "payment_intent.succeeded", "checkout.session.completed", "charge.succeeded", "charge.refunded"] } } }),
    ]);
    if (payments.length > LIMIT || digital.length > LIMIT) throw new Error("Volume trop important : aucun total partiel n’est présenté. Export comptable dédié nécessaire.");
    const entries: RevenueEntry[] = [], issues: string[] = [], paymentKeys = new Set<string>();
    const add = (entry: RevenueEntry) => {
      if (entry.kind === "RECEIPT") {
        if (paymentKeys.has(entry.paymentKey)) throw new Error("Référence de paiement dupliquée : rapprochement nécessaire.");
        paymentKeys.add(entry.paymentKey);
      }
      entries.push(entry);
    };
    for (const p of payments) {
      if (!p.paidAt || !!p.orderId === !!p.shopOrderId || !p.providerPaymentId) { issues.push(`Paiement ${p.id} : origine ou référence à rapprocher.`); continue; }
      const order = p.order?.orderNumber ?? p.shopOrder!.orderNumber;
      const common = { paymentKey: `${mode}:${p.provider}:${p.providerPaymentId}`, mode, category: p.order ? "COMMANDER" as const : "SHOP" as const, currency: p.currency, order,
        title: p.order?.title || (p.order ? "Création musicale" : "Commande Boutique LNX"), customer: p.invoice?.customerNameSearch || "Client non documenté par une facture",
        provider: p.provider, reference: p.providerPaymentId, invoice: p.invoice?.invoiceNumber ?? "À vérifier : facture absente",
        documentHref: p.invoice ? `/admin/facturation/${encodeURIComponent(p.invoice.invoiceNumber)}` : null,
        orderHref: p.order ? `/admin/commandes/${encodeURIComponent(order)}` : `/admin/boutique/commandes/${encodeURIComponent(order)}` };
      add({ ...common, id: `payment:${p.id}`, kind: "RECEIPT", at: p.paidAt.toISOString(), amountCents: p.amountCents });
      if (!p.invoice) issues.push(`Paiement ${p.id} : facture absente du registre historique.`);
      if (p.status === "REQUIRES_REVIEW") issues.push(`Paiement ${p.id} : encaissement conservé, situation à examiner.`);
      if (p.refundAttempts.reduce((n, r) => n + r.amountCents, 0) > p.amountCents) throw new Error("Remboursements supérieurs à l’encaissement : rapprochement nécessaire.");
      if (p.refundedAmountCents !== p.refundAttempts.reduce((n, r) => n + r.amountCents, 0)) issues.push(`Paiement ${p.id} : remboursements cumulés à rapprocher, total net provisoire.`);
      for (const r of p.refundAttempts) {
        if (!r.confirmedAt || !r.providerRefundId) { issues.push(`Remboursement ${r.id} : date ou référence manquante, non déduit.`); continue; }
        if (r.creditNotes.length !== 1) issues.push(`Remboursement ${r.id} : avoir absent ou multiple à examiner.`);
        add({ ...common, id: `refund:${r.id}`, kind: "REFUND", at: r.confirmedAt.toISOString(), amountCents: r.amountCents, currency: r.currency, reference: r.providerRefundId,
          invoice: r.creditNotes.map(c => c.creditNoteNumber).join(" · ") || "À vérifier : avoir absent", documentHref: r.creditNotes.length === 1 ? `/admin/facturation/avoirs/${encodeURIComponent(r.creditNotes[0].creditNoteNumber)}` : null });
      }
    }
    for (const o of digital) {
      const invoice = o.documents.find(d => d.kind === "INVOICE"), snapshot = object(invoice?.snapshot), attempt = o.attempts[0];
      const at = text(snapshot.paidAt);
      if (o.attempts.length !== 1 || !attempt?.paymentReference || !Number.isFinite(Date.parse(at)) || snapshot.totalCents !== o.totalCents || snapshot.mode !== mode) {
        issues.push(`Achat numérique ${o.id} : preuve d’encaissement incomplète ou contradictoire, exclu du total.`); continue;
      }
      const common = { paymentKey: `${mode}:${attempt.provider}:${attempt.paymentReference}`, category: "DIGITAL" as const, mode, currency: o.currency, order: o.id,
        title: o.lines.map(l => l.title).join(" · "), customer: text(object(snapshot.customerSnapshot).name) || "Client non documenté",
        provider: attempt.provider, reference: attempt.paymentReference, invoice: invoice!.number,
        documentHref: invoice?.status === "READY" ? `/api/digital/documents/${invoice.id}` : null, orderHref: `/admin/musique/achats/${o.id}` };
      add({ ...common, id: `digital:${attempt.id}`, kind: "RECEIPT", at, amountCents: o.totalCents });
      if (invoice?.status !== "READY") issues.push(`Facture ${invoice?.number} : PDF pas encore prêt.`);
      if (o.status === "REQUIRES_REVIEW") issues.push(`Achat numérique ${o.id} : encaissement conservé, situation à examiner.`);
      if (o.refunds.reduce((n, r) => n + r.amountCents, 0) > o.totalCents) throw new Error("Remboursements supérieurs à l’encaissement : rapprochement nécessaire.");
      if (o.disputes.length) issues.push(`Achat numérique ${o.id} : litige ouvert/perdu, ajustement à examiner séparément.`);
      for (const r of o.refunds) {
        if (!r.confirmedAt || !r.providerReference) { issues.push(`Remboursement ${r.id} : preuve incomplète, non déduit.`); continue; }
        const note = o.documents.find(d => d.kind === "CREDIT_NOTE" && object(object(d.snapshot).refund).id === r.id);
        if (!note || note.status !== "READY") issues.push(`Remboursement ${r.id} : avoir absent ou PDF non prêt.`);
        add({ ...common, id: `digital-refund:${r.id}`, kind: "REFUND", at: r.confirmedAt.toISOString(), amountCents: r.amountCents, currency: r.currency, reference: r.providerReference,
          invoice: note?.number ?? "À vérifier : avoir absent", documentHref: note?.status === "READY" ? `/api/digital/documents/${note.id}` : null });
      }
    }
    const summary = revenueSummary(entries, period, mode);
    const allTime = entries.reduce((sum, r) => sum + (r.kind === "RECEIPT" ? r.amountCents : -r.amountCents), 0);
    if (!Number.isSafeInteger(allTime)) throw new Error("Total hors limites.");
    return { ...summary, allTimeBalanceCents: allTime, unmatchedReceipts, period: { from: period.from, to: period.to }, mode, issues, generatedAt: new Date().toISOString() };
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}
