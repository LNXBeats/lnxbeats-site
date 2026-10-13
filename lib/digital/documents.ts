import "server-only";
import { createHash, randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sellerSnapshot } from "@/lib/billing/service";
import { billingSnapshotHash, invoiceNumber, creditNoteNumber } from "@/lib/billing/domain";
import { generateInvoicePdf, generateCreditNotePdf, type InvoicePdfRecord, type CreditNotePdfRecord } from "@/lib/billing/pdf";
import { DigitalError, requireDigitalEnvironment } from "./domain";
import { DIGITAL_FISCAL_REVIEW_NOTICE, digitalEmailTemplate, verifyContractSnapshot } from "./fulfillment-policy";
type Tx = Prisma.TransactionClient;
const json = (v: unknown) => v as Prisma.InputJsonValue;

async function sequence(tx: Tx, kind: "INVOICE" | "CREDIT_NOTE", date: Date) {
  const rows = kind === "INVOICE" ? await tx.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('digital_test_invoice_sequence') AS n`
    : await tx.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('digital_test_credit_note_sequence') AS n`;
  return `DCN-QA-${kind === "INVOICE" ? invoiceNumber(date, rows[0].n) : creditNoteNumber(date, rows[0].n)}`;
}
export async function enqueueDigitalEmail(tx: Tx, orderId: string, kind: string, businessKey: string, documentNumber?: string, amountCents?:number) {
  const o = await tx.digitalOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true, user: true } });
  const identity = o.contractSnapshot as { customer?: { email?: string } } | null;
  const recipient = identity?.customer?.email ?? o.user.email;
  await tx.digitalNotification.upsert({ where: { businessKey }, update: {}, create: { orderId, kind, businessKey, recipient,
    template: json(digitalEmailTemplate({ kind, orderId, totalCents: amountCents??o.totalCents, titles: o.lines.map(l => l.title),
      base: process.env.AUTH_URL ?? "http://127.0.0.1:3140", documentNumber })) } });
}
/** Called in the payment transaction. No PDF, filesystem or transport work here. */
export async function prepareDigitalDocuments(tx: Tx, orderId: string) {
  const o = await tx.digitalOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true, attempts: { where: { status: "PAID" } } } });
  if (o.mode !== "TEST" || o.attempts.length !== 1) throw new DigitalError("DOCUMENT_REQUIRES_REVIEW", 409);
  const existing = await tx.digitalDocument.findUnique({ where: { businessKey: `invoice:${orderId}` } });
  if (existing) return existing;
  // Legacy DCN-1.0 acquisitions retain access. Their missing historic contract is not invented.
  if (!o.contractSnapshot) return null;
  const s = verifyContractSnapshot(o.contractSnapshot, o.termsVersion, o.termsHash).snapshot;
  if (createHash("sha256").update(s.terms.text).digest("hex") !== o.termsHash) throw new DigitalError("CONTRACT_REQUIRES_REVIEW");
  const date = new Date(), number = await sequence(tx, "INVOICE", date);
  const masters=await tx.digitalMaster.findMany({where:{id:{in:o.lines.flatMap(l=>(l.trackSnapshot as Array<{masterId:string}>).map(t=>t.masterId))}},select:{id:true,version:true,codec:true,masterAsset:{select:{durationMs:true,checksumSha256:true}}}});
  const invoice = { invoiceNumber: number, issuedAt: date.toISOString(), paidAt: date.toISOString(), orderNumberSnapshot: o.id,
    sellerSnapshot, customerSnapshot: s.customer, lineItemsSnapshot: o.lines.map(l => ({ description: `${l.scope === "ALBUM" ? "Album numérique" : "Titre numérique"} — ${l.title}`, quantity: 1, unitPriceCents: l.priceCents, lineTotalCents: l.priceCents })),
    currency: "EUR", subtotalCents: o.totalCents, shippingCents: 0, totalCents: o.totalCents, vatLegalNotice: DIGITAL_FISCAL_REVIEW_NOTICE,
    paymentMethodLabel: `${o.attempts[0].provider} TEST`, termsVersion: o.termsVersion,
    acquired: o.lines.map(l => ({ id: l.id, offerId: l.offerId, version: l.offerVersion, content: l.trackSnapshot, tax: l.taxSnapshot })),
    versions:masters.map(m=>({masterId:m.id,version:m.version,format:m.codec,durationMs:m.masterAsset.durationMs,checksum:m.masterAsset.checksumSha256})),
    contract: s, payment: { provider: o.attempts[0].provider, reference: o.attempts[0].paymentReference }, mode: "TEST" };
  const doc = await tx.digitalDocument.create({ data: { orderId, kind: "INVOICE", businessKey: `invoice:${orderId}`, number, snapshot: json(invoice), snapshotHash: billingSnapshotHash(invoice) } });
  const contract = { ...invoice, invoiceNumber: undefined, termsText: s.terms.text, invoice: number };
  // JSON must not contain undefined values (canonical hash must describe persisted JSON exactly).
  delete contract.invoiceNumber;
  await tx.digitalDocument.create({ data: { orderId, kind: "CONTRACT", businessKey: `contract:${orderId}`, number: `DCN-QA-CONTRACT-${orderId}`, snapshot: json(contract), snapshotHash: billingSnapshotHash(contract) } });
  await tx.digitalFulfillment.upsert({ where: { orderId }, update: {}, create: { orderId } });
  await enqueueDigitalEmail(tx, orderId, "CONTRACT_AVAILABLE", `contract-mail:${orderId}`, number);
  return doc;
}
export async function prepareDigitalCreditNote(tx: Tx, refundId: string) {
  const r = await tx.digitalRefund.findUniqueOrThrow({ where: { id: refundId } });
  if (r.status !== "SUCCEEDED" || !r.confirmedAt || !r.providerReference) throw new DigitalError("REFUND_NOT_CONFIRMED");
  const key = `credit:${refundId}`;
  if (await tx.digitalDocument.findUnique({ where: { businessKey: key } })) return;
  const invoice = await tx.digitalDocument.findUnique({ where: { businessKey: `invoice:${r.orderId}` } });
  if (!invoice) return; // Legacy acquisition: recorded financial adjustment, no invented original invoice.
  const sum = await tx.digitalRefund.aggregate({ where: { orderId: r.orderId, status: "SUCCEEDED" }, _sum: { amountCents: true } });
  const source = invoice.snapshot as { totalCents: number };
  if ((sum._sum.amountCents ?? 0) > source.totalCents) throw new DigitalError("REFUND_AMOUNT_EXCEEDED");
  const number = await sequence(tx, "CREDIT_NOTE", r.confirmedAt);
  const snapshot = { creditNoteNumber: number, issuedAt: r.confirmedAt.toISOString(), amountCents: r.amountCents,
    cumulativeCreditedCents: sum._sum.amountCents!, remainingBalanceCents: source.totalCents - sum._sum.amountCents!, currency: "EUR",
    reasonCode: "OTHER_REVIEWED", reasonText: r.purpose === "PRICE_REDUCTION" ? "Réduction de prix confirmée ; droits conservés." : "Restitution prestataire confirmée ; attribution des lignes conservée dans l’audit.",
    invoice: invoice.snapshot, sourceDocumentId: invoice.id, refund: { id: r.id, provider: r.provider, reference: r.providerReference, targets: r.targets } };
  await tx.digitalDocument.create({ data: { orderId: r.orderId, kind: "CREDIT_NOTE", businessKey: key, number, snapshot: json(snapshot), snapshotHash: billingSnapshotHash(snapshot) } });
  await enqueueDigitalEmail(tx, r.orderId, "REFUND_CONFIRMED", `refund-mail:${refundId}`, number,r.amountCents);
}
function invoiceRecord(s: Record<string, unknown>, hash: string): InvoicePdfRecord {
  return { ...s, issuedAt: new Date(s.issuedAt as string), paidAt: new Date(s.paidAt as string), snapshotHashSha256: hash } as unknown as InvoicePdfRecord;
}
async function contractPdf(snapshot: Record<string, unknown>, number: string) {
  const p = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Confirmation ${number}` } });
  const chunks: Buffer[] = []; let size = 0;
  const result = new Promise<Buffer>((resolve, reject) => { p.on("data", b => { size += b.length; if (size > 2097152) (p as unknown as import("node:stream").Readable).destroy(new DigitalError("PDF_TOO_LARGE")); else chunks.push(b); }); p.on("error", reject); p.on("end", () => resolve(Buffer.concat(chunks))); });
  p.fontSize(20).text("LNX Beats — Confirmation numérique");
  p.moveDown().fontSize(10).text("DOCUMENT QA / TEST — CONDITIONS PROPOSÉES, NON APPROUVÉES POUR LIVE");
  p.moveDown().text(`Référence : ${number}\nCommande : ${snapshot.orderNumberSnapshot}\nFacture QA : ${snapshot.invoice}`);
  const s = snapshot.contract as { customer: { name: string; email: string }; acceptedAt: string; earlyDelivery: { text: string }; withdrawal: { text: string } };
  p.moveDown().text(`${s.customer.name}\n${s.customer.email}\nConsentements recueillis le ${s.acceptedAt}`);
  for (const line of snapshot.lineItemsSnapshot as Array<{ description: string; lineTotalCents: number }>) p.moveDown(.5).text(`${line.description} : ${Math.floor(line.lineTotalCents / 100)},${String(line.lineTotalCents % 100).padStart(2, "0")} EUR`);
  p.moveDown().font("Helvetica-Bold").text("Contenu exact acquis, conservé indépendamment du catalogue courant").font("Helvetica");
  const versions=snapshot.versions as Array<{masterId:string;version:number;format:string}>;
  for(const line of snapshot.acquired as Array<{content:Array<{title:string;masterId:string}>}>){for(const t of line.content){const v=versions.find(v=>v.masterId===t.masterId);p.text(`${t.title} — version ${v?.version??"figée"} · ${v?.format??"format acquis"}`);}}
  p.moveDown().text(String(snapshot.termsText));
  p.moveDown().text(s.earlyDelivery.text).moveDown(.5).text(s.withdrawal.text);
  p.moveDown().text("Le paiement ou cet email d’information ne suffisent pas à prouver la perte du droit. La fourniture QA commence seulement après réception reconnue du document. Aucun droit de publication/distribution/monétisation n’est cédé.");
  p.moveDown().text(DIGITAL_FISCAL_REVIEW_NOTICE); p.end(); return result;
}
export async function processDigitalDocuments(limit = 10, renderer?: (kind: string, snapshot: Record<string, unknown>, hash: string, number: string) => Promise<Buffer>) {
  requireDigitalEnvironment(); let ready = 0;
  const rows = await prisma.digitalDocument.findMany({ where: { availableAt: { lte: new Date() }, OR: [{ status: { in: ["PENDING", "RETRY"] } }, { status: "PROCESSING", leaseUntil: { lte: new Date() } }] }, take: Math.min(limit, 10), orderBy: { createdAt: "asc" } });
  for (const row of rows) {
    if (row.attempts >= 5) { await prisma.digitalDocument.updateMany({ where: { id: row.id, status: { not: "READY" } }, data: { status: "REQUIRES_REVIEW" } }); continue; }
    const token = randomUUID();
    const c = await prisma.digitalDocument.updateMany({ where: { id: row.id, attempts: row.attempts, OR: [{ status: { in: ["PENDING", "RETRY"] } }, { status: "PROCESSING", leaseUntil: { lte: new Date() } }] }, data: { status: "PROCESSING", attempts: { increment: 1 }, leaseToken: token, leaseUntil: new Date(Date.now() + 60000) } });
    if (!c.count) continue;
    try {
      if (billingSnapshotHash(row.snapshot) !== row.snapshotHash) throw new DigitalError("DOCUMENT_HASH_MISMATCH");
      const s = row.snapshot as Record<string, unknown>;
      const pdf = renderer ? await renderer(row.kind, s, row.snapshotHash, row.number) : row.kind === "INVOICE"
        ? (await generateInvoicePdf(invoiceRecord(s, row.snapshotHash), "TEST",{digital:true})).bytes : row.kind === "CREDIT_NOTE"
          ? (await generateCreditNotePdf({ ...s, issuedAt: new Date(s.issuedAt as string), snapshotHashSha256: row.snapshotHash,
            invoice: invoiceRecord(s.invoice as Record<string, unknown>, billingSnapshotHash(s.invoice)) } as CreditNotePdfRecord, "TEST",{digital:true})).bytes : await contractPdf(s, row.number);
      if (!pdf.length || pdf.length > 2097152 || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new DigitalError("INVALID_PDF");
      const changed = await prisma.digitalDocument.updateMany({ where: { id: row.id, leaseToken: token, status: "PROCESSING", leaseUntil: { gt: new Date() } }, data: { status: "READY", pdf: new Uint8Array(pdf), pdfHash: createHash("sha256").update(pdf).digest("hex"), leaseUntil: null, leaseToken: null, errorCode: null } });
      ready += changed.count;
    } catch (e) { await prisma.digitalDocument.updateMany({ where: { id: row.id, leaseToken: token, status: "PROCESSING" }, data: { status: row.attempts + 1 >= 5 ? "REQUIRES_REVIEW" : "RETRY", availableAt: new Date(Date.now() + 60000), leaseToken: null, leaseUntil: null, errorCode: e instanceof DigitalError ? e.code : "PDF_GENERATION_FAILED" } }); }
  }
  return { ready };
}
export async function acknowledgeDigitalContract(userId: string, orderId: string, documentId: string, hash: string) {
  requireDigitalEnvironment();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-user:${userId}`})) IS NULL AS locked`;
    const o = await tx.digitalOrder.findFirst({ where: { id: orderId, userId, status: { in: ["PAID", "PARTIALLY_REFUNDED"] }, user: { status: "ACTIVE", emailVerified: true } } });
    const d = await tx.digitalDocument.findFirst({ where: { id: documentId, orderId, kind: "CONTRACT", status: "READY", snapshotHash: hash } });
    if (!o || !d || !o.contractSnapshot || !await tx.digitalEvent.findFirst({ where: { orderId, actorId: userId, kind: "DOCUMENT_TRANSFER_FINISHED", details: { path: ["documentId"], equals: documentId } } })) throw new DigitalError("CONTRACT_RECEIPT_REQUIRED", 409);
    const current = await tx.digitalFulfillment.findUniqueOrThrow({ where: { orderId } });
    if (current.confirmationAt) return { acknowledged: true };
    const at = new Date();
    await tx.digitalFulfillment.update({ where: { orderId }, data: { confirmationStatus: "ACKNOWLEDGED", confirmationAt: at, accessReadyAt: at,
      confirmationEvidence: { type: "OWNER_EXPLICIT_QA_RECEIPT_AFTER_TRANSFER", documentId, snapshotHash: hash, at: at.toISOString(), policy: "PROPOSED_NOT_LEGAL_VALIDATION" } } });
    await tx.digitalEvent.create({ data: { orderId, actorId: userId, kind: "CONTRACT_RECEIPT_ACKNOWLEDGED", details: { documentId, snapshotHash: hash, policy: "QA_EXPLICIT_RECEIPT" } } });
    await enqueueDigitalEmail(tx, orderId, "ACCESS_READY", `access-mail:${orderId}`);
    return { acknowledged: true };
  });
}
export async function digitalDocumentResponse(actor: { id: string; role: string }, id: string, method = "GET") {
  requireDigitalEnvironment();
  const d = await prisma.digitalDocument.findFirst({ where: { id, order: actor.role === "ADMIN" ? {} : { userId: actor.id } }, include: { order: true } });
  if (!d || d.status !== "READY" || !d.pdf || !await prisma.user.findFirst({ where: { id: actor.id, status: "ACTIVE", emailVerified: true } })) throw new DigitalError("NOT_FOUND", 404);
  const bytes = Buffer.from(d.pdf);
  if (billingSnapshotHash(d.snapshot) !== d.snapshotHash || createHash("sha256").update(bytes).digest("hex") !== d.pdfHash) throw new DigitalError("DOCUMENT_HASH_MISMATCH", 503);
  const headers = { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${d.number}.pdf"`, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" };
  if (method === "HEAD") return new Response(null, { headers });
  let dispatched=false,cancelled=false;
  return new Response(new ReadableStream({ async pull(controller) {
    if(!dispatched){dispatched=true;controller.enqueue(bytes);return;}
    // Evidence: server completed dispatch, NOT proof of device storage or reading.
    if(!cancelled)await prisma.digitalEvent.create({ data: { orderId: d.orderId, actorId: actor.id, kind: "DOCUMENT_TRANSFER_FINISHED", details: { documentId: d.id, byteCount: bytes.length, evidence: "SERVER_STREAM_DISPATCHED_NOT_CLIENT_STORAGE" } } });
    controller.close();
  },cancel(){cancelled=true;} }), { headers });
}
