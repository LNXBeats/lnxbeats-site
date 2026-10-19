import "server-only";
import { createHash, randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sellerSnapshot } from "@/lib/billing/service";
import { billingSnapshotHash, invoiceNumber, creditNoteNumber } from "@/lib/billing/domain";
import { generateInvoicePdf, generateCreditNotePdf, type InvoicePdfRecord, type CreditNotePdfRecord } from "@/lib/billing/pdf";
import { DigitalError, requireDigitalEnvironment, assertDigitalUuid, type DigitalMode } from "./domain";
import { DIGITAL_FISCAL_REVIEW_NOTICE, DIGITAL_FRANCE_CONTRACT_POLICY, DIGITAL_FRANCE_LIVE_CONTRACT_POLICY, digitalEmailTemplate, verifyContractSnapshot } from "./fulfillment-policy";
import { digitalCommercialFiscalNotice } from "./document-policy";
import { checkDigitalAcquiredJurisdiction } from "./checkout-jurisdiction";
import {checkDigitalAcquiredRightsReview} from "./rights-review-checkout";
import { verifyDigitalPinnedMedia } from "./pinned-media";
import { verifyDigitalCompletions } from "./completion";
import { assertDigitalOrderFormatSupplement, type DigitalFormatSupplementSnapshot } from "./format-supplement";
type Tx = Prisma.TransactionClient;
const json = (v: unknown) => v as Prisma.InputJsonValue;

async function sequence(tx: Tx, kind: "INVOICE" | "CREDIT_NOTE", date: Date, mode:DigitalMode="TEST") {
  if(mode==="LIVE"){
    const rows=kind==="INVOICE"?await tx.$queryRaw<Array<{n:bigint}>>`SELECT nextval('invoice_sequence') AS n`
      :await tx.$queryRaw<Array<{n:bigint}>>`SELECT nextval('credit_note_sequence') AS n`;
    return kind==="INVOICE"?invoiceNumber(date,rows[0].n):creditNoteNumber(date,rows[0].n);
  }
  const rows = kind === "INVOICE" ? await tx.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('digital_test_invoice_sequence') AS n`
    : await tx.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('digital_test_credit_note_sequence') AS n`;
  return `DCN-QA-${kind === "INVOICE" ? invoiceNumber(date, rows[0].n) : creditNoteNumber(date, rows[0].n)}`;
}
export async function enqueueDigitalEmail(tx: Tx, orderId: string, kind: string, businessKey: string, documentNumber?: string, amountCents?:number) {
  const o = await tx.digitalOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true, user: true } });
  const identity = o.contractSnapshot as { customer?: { email?: string } } | null;
  const recipient = identity?.customer?.email ?? o.user.email;
  await tx.digitalNotification.upsert({ where: { businessKey }, update: {}, create: { orderId, kind, businessKey, recipient,
    template: json({ ...digitalEmailTemplate({ kind, orderId, totalCents: amountCents??o.totalCents, titles: o.lines.map(l => l.title),
      base: process.env.AUTH_URL ?? "http://127.0.0.1:3140", documentNumber,mode:o.mode==="LIVE"?"LIVE":"TEST" }), ...(o.mode==="LIVE"?{mode:"LIVE"}:{}) }) } });
}
/** Called in the payment transaction. No PDF, filesystem or transport work here. */
export async function prepareDigitalDocuments(tx: Tx, orderId: string) {
  const o = await tx.digitalOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true, attempts: { where: { status: "PAID" } } } });
  const mode=requireDigitalEnvironment();
  if (o.mode !== mode || o.attempts.length !== 1) throw new DigitalError("DOCUMENT_REQUIRES_REVIEW", 409);
  const existing = await tx.digitalDocument.findUnique({ where: { businessKey: `invoice:${orderId}` } });
  if (existing) return existing;
  // Legacy DCN-1.0 acquisitions retain access. Their missing historic contract is not invented.
  if (!o.contractSnapshot) return null;
  const s = verifyContractSnapshot(o.contractSnapshot, o.termsVersion, o.termsHash).snapshot;
  assertDigitalOrderFormatSupplement(o.contractSnapshot,o.lines);
  if (createHash("sha256").update(s.terms.text).digest("hex") !== o.termsHash) throw new DigitalError("CONTRACT_REQUIRES_REVIEW");
  if(s.mode!==mode)throw new DigitalError("CONTRACT_REQUIRES_REVIEW",409);
  const date = new Date(), number = await sequence(tx, "INVOICE", date,mode);
  const masters=await tx.digitalMaster.findMany({where:{id:{in:o.lines.flatMap(l=>(l.trackSnapshot as Array<{masterId:string}>).map(t=>t.masterId))}},select:{id:true,version:true,codec:true,masterAsset:{select:{durationMs:true,checksumSha256:true}}}});
  const invoice = { invoiceNumber: number, issuedAt: date.toISOString(), paidAt: date.toISOString(), orderNumberSnapshot: o.id,
    sellerSnapshot, customerSnapshot: s.customer, lineItemsSnapshot: o.lines.map(l => ({ description: `${l.scope === "ALBUM" ? "Album numérique" : "Titre numérique"} — ${l.title}${s.formatSupplement&&(l.trackSnapshot as Array<{trackId:string}>).some(t=>s.formatSupplement!.tracks.some(b=>b.trackId===t.trackId))?" — MP3 uniquement":""}${l.completionSnapshot?" — complément d’album, crédit d’achats antérieurs détaillé dans la confirmation":""}`, quantity: 1, unitPriceCents: l.priceCents, lineTotalCents: l.priceCents })),
    currency: "EUR", subtotalCents: o.totalCents, shippingCents: 0, totalCents: o.totalCents, vatLegalNotice: digitalCommercialFiscalNotice(o.jurisdictionSnapshot,mode),
    paymentMethodLabel: `${o.attempts[0].provider}${mode==="TEST"?" TEST":""}`, termsVersion: o.termsVersion,
    acquired: o.lines.map(l => ({ id: l.id, offerId: l.offerId, version: l.offerVersion, content: l.trackSnapshot, tax: l.taxSnapshot,
      ...(l.completionSnapshot?{completion:l.completionSnapshot}:{}) })),
    versions:masters.map(m=>({masterId:m.id,version:m.version,format:m.codec,durationMs:m.masterAsset.durationMs,checksum:m.masterAsset.checksumSha256})),
    jurisdiction:o.jurisdictionSnapshot,
    contract: s, payment: { provider: o.attempts[0].provider, reference: o.attempts[0].paymentReference }, mode };
  const doc = await tx.digitalDocument.create({ data: { orderId, kind: "INVOICE", businessKey: `invoice:${orderId}`, number, snapshot: json(invoice), snapshotHash: billingSnapshotHash(invoice) } });
  const contract = { ...invoice, invoiceNumber: undefined, termsText: s.terms.text, invoice: number };
  // JSON must not contain undefined values (canonical hash must describe persisted JSON exactly).
  delete contract.invoiceNumber;
  await tx.digitalDocument.create({ data: { orderId, kind: "CONTRACT", businessKey: `contract:${orderId}`, number: `${mode==="TEST"?"DCN-QA":"DCN"}-CONTRACT-${orderId}`, snapshot: json(contract), snapshotHash: billingSnapshotHash(contract) } });
  await tx.digitalFulfillment.upsert({ where: { orderId }, update: {}, create: { orderId } });
  await enqueueDigitalEmail(tx, orderId, "CONTRACT_AVAILABLE", `contract-mail:${orderId}`, number);
  return doc;
}
/** Explicit proof of a free completion, never a zero invoice or invented PSP receipt. */
export async function prepareFreeDigitalCompletionDocuments(tx:Tx,orderId:string){
  const mode=requireDigitalEnvironment();
  const o=await tx.digitalOrder.findUniqueOrThrow({where:{id:orderId},include:{lines:true,attempts:true}});
  const acquisition=(o.contractSnapshot as {acquisition?:{kind?:string}})?.acquisition;
  if(o.mode!==mode||o.status!=="GRANTED"||o.totalCents!==0||o.attempts.length||acquisition?.kind!=="FREE_ALBUM_COMPLETION"
    ||o.lines.length!==1||o.lines[0].priceCents!==0||o.lines[0].scope!=="ALBUM")throw new DigitalError("FREE_COMPLETION_PROOF_REQUIRED",409);
  const completion=o.lines[0].completionSnapshot as unknown as import("./domain").DigitalCompletionSnapshot;
  if(completion?.version!==2||completion.creditCents!==completion.basePriceCents||!Number.isSafeInteger(completion.eligibleCents)
    ||completion.eligibleCents!<completion.creditCents)throw new DigitalError("FREE_COMPLETION_PROOF_REQUIRED",409);
  const key=`contract:${orderId}`,existing=await tx.digitalDocument.findUnique({where:{businessKey:key}});
  if(existing)return existing;
  const contract=verifyContractSnapshot(o.contractSnapshot,o.termsVersion,o.termsHash).snapshot;
  const masters=await tx.digitalMaster.findMany({where:{id:{in:(o.lines[0].trackSnapshot as Array<{masterId:string}>).map(t=>t.masterId)}},
    select:{id:true,version:true,codec:true,masterAsset:{select:{durationMs:true,checksumSha256:true}}}});
  if(contract.mode!==mode)throw new DigitalError("CONTRACT_REQUIRES_REVIEW",409);
  const snapshot={issuedAt:new Date().toISOString(),orderNumberSnapshot:o.id,mode,currency:"EUR",totalCents:0,
    sellerSnapshot,customerSnapshot:contract.customer,termsVersion:o.termsVersion,termsText:contract.terms.text,contract,
    supply:{kind:"FREE_ALBUM_COMPLETION",amountChargedCents:0,eligibleCents:completion.eligibleCents,
      appliedCreditCents:completion.creditCents,surplusCents:completion.eligibleCents!-completion.creditCents,reusableBalanceCents:0,
      paymentAttemptCreated:false,invoiceCreated:false,policy:mode==="TEST"?"LOCAL_QA_FREE_COMPLETION_V1":"LIVE_FREE_COMPLETION_V1"},
    lineItemsSnapshot:[{description:`Complément gratuit d’album — ${o.lines[0].title}`,quantity:1,unitPriceCents:0,lineTotalCents:0}],
    acquired:o.lines.map(l=>({id:l.id,offerId:l.offerId,version:l.offerVersion,content:l.trackSnapshot,tax:l.taxSnapshot,completion:l.completionSnapshot})),
    versions:masters.map(m=>({masterId:m.id,version:m.version,format:m.codec,durationMs:m.masterAsset.durationMs,checksum:m.masterAsset.checksumSha256})),
    jurisdiction:o.jurisdictionSnapshot};
  const number=`${mode==="TEST"?"DCN-QA":"DCN"}-FREE-${orderId}`;
  const document=await tx.digitalDocument.create({data:{orderId,kind:"CONTRACT",businessKey:key,number,snapshot:json(snapshot),snapshotHash:billingSnapshotHash(snapshot)}});
  await tx.digitalFulfillment.upsert({where:{orderId},update:{},create:{orderId}});
  await enqueueDigitalEmail(tx,orderId,"FREE_COMPLETION_AVAILABLE",`contract-mail:${orderId}`,number);
  return document;
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
  const mode=requireDigitalEnvironment();
  if(((invoice.snapshot as {mode?:string}).mode??"TEST")!==mode)throw new DigitalError("DOCUMENT_REQUIRES_REVIEW",409);
  const number = await sequence(tx, "CREDIT_NOTE", r.confirmedAt,mode);
  const snapshot = { creditNoteNumber: number, issuedAt: r.confirmedAt.toISOString(),mode, amountCents: r.amountCents,
    cumulativeCreditedCents: sum._sum.amountCents!, remainingBalanceCents: source.totalCents - sum._sum.amountCents!, currency: "EUR",
    reasonCode: "OTHER_REVIEWED", reasonText: r.purpose === "PRICE_REDUCTION" ? "Réduction de prix confirmée ; droits conservés." : "Restitution prestataire confirmée ; attribution des lignes conservée dans l’audit.",
    invoice: invoice.snapshot, sourceDocumentId: invoice.id, refund: { id: r.id, provider: r.provider, reference: r.providerReference, targets: r.targets } };
  await tx.digitalDocument.create({ data: { orderId: r.orderId, kind: "CREDIT_NOTE", businessKey: key, number, snapshot: json(snapshot), snapshotHash: billingSnapshotHash(snapshot) } });
  await enqueueDigitalEmail(tx, r.orderId, "REFUND_CONFIRMED", `refund-mail:${refundId}`, number,r.amountCents);
}
function invoiceRecord(s: Record<string, unknown>, hash: string): InvoicePdfRecord {
  return { ...s, issuedAt: new Date(s.issuedAt as string), paidAt: new Date(s.paidAt as string), snapshotHashSha256: hash } as unknown as InvoicePdfRecord;
}
export async function generateDigitalContractPdf(snapshot: Record<string, unknown>, number: string) {
  const mode=snapshot.mode==="LIVE"?"LIVE":"TEST";
  if(mode==="LIVE")verifyContractSnapshot(snapshot.contract,snapshot.termsVersion as string,(snapshot.contract as {terms:{hashSha256:string}}).terms.hashSha256);
  const p = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Confirmation ${number}` } });
  const chunks: Buffer[] = []; let size = 0;
  const result = new Promise<Buffer>((resolve, reject) => { p.on("data", b => { size += b.length; if (size > 2097152) (p as unknown as import("node:stream").Readable).destroy(new DigitalError("PDF_TOO_LARGE")); else chunks.push(b); }); p.on("error", reject); p.on("end", () => resolve(Buffer.concat(chunks))); });
  p.fontSize(20).text("LNX Beats — Confirmation numérique");
  p.moveDown().fontSize(10).text(mode==="TEST"?"DOCUMENT QA / TEST — CONDITIONS PROPOSÉES, NON APPROUVÉES POUR LIVE":"Confirmation contractuelle — contenu et conditions acceptés");
  const free=(snapshot.supply as {kind?:string}|undefined)?.kind==="FREE_ALBUM_COMPLETION";
  p.moveDown().text(`Référence : ${number}\nCommande : ${snapshot.orderNumberSnapshot}\n${free?"Complément fourni sans paiement — aucune facture ni transaction prestataire créée.":`Facture${mode==="TEST"?" QA":""} : ${snapshot.invoice}`}`);
  if(free){const supply=snapshot.supply as {eligibleCents:number;appliedCreditCents:number;surplusCents:number};
    p.moveDown().text(`Montants éligibles : ${(supply.eligibleCents/100).toFixed(2)} EUR. Crédit appliqué plafonné : ${(supply.appliedCreditCents/100).toFixed(2)} EUR. Reste à payer : 0,00 EUR. Aucun solde, avoir monétaire ou crédit réutilisable créé, y compris pour l’excédent ${(supply.surplusCents/100).toFixed(2)} EUR.`);}
  const s = snapshot.contract as { customer: { name: string; email: string }; acceptedAt: string; earlyDelivery: { text: string }; withdrawal: { text: string };
    terms?: { version?: string; hashSha256?: string; sections?: Array<{ title: string; paragraphs: string[]; boxed?: boolean }> }; formatSupplement?:DigitalFormatSupplementSnapshot };
  p.moveDown().text(`${s.customer.name}\n${s.customer.email}\nConsentements recueillis le ${s.acceptedAt}`);
  if(s.terms?.version)p.moveDown(.5).text(`Version des conditions acceptée : ${s.terms.version}`);
  if(s.terms?.hashSha256)p.text(`Empreinte SHA-256 du texte accepté : ${s.terms.hashSha256}`);
  if(s.formatSupplement){p.moveDown().font("Helvetica-Bold").text(s.formatSupplement.title).font("Helvetica");p.text(s.formatSupplement.text);p.text(`Version du complément : ${s.formatSupplement.version}\nEmpreinte SHA-256 : ${s.formatSupplement.hashSha256}\nAccepté le ${s.formatSupplement.acceptedAt}`);}
  for (const line of snapshot.lineItemsSnapshot as Array<{ description: string; lineTotalCents: number }>) p.moveDown(.5).text(`${line.description} : ${Math.floor(line.lineTotalCents / 100)},${String(line.lineTotalCents % 100).padStart(2, "0")} EUR`);
  p.moveDown().font("Helvetica-Bold").text("Contenu exact acquis, conservé indépendamment du catalogue courant").font("Helvetica");
  const versions=snapshot.versions as Array<{masterId:string;version:number;format:string}>;
  for(const line of snapshot.acquired as Array<{content:Array<{title:string;masterId:string;trackId?:string;formats?:string[]}>;completion?:{basePriceCents:number;creditCents:number;sources:Array<{trackId:string;paidCents:number;refundedCents:number;creditCents:number}>}}>){
    for(const t of line.content){const v=versions.find(v=>v.masterId===t.masterId);p.text(`${t.title} — version ${v?.version??"figée"} · ${t.formats?.join(" + ")??v?.format??"format acquis"}`);}
    if(line.completion){const money=(v:number)=>`${(v/100).toFixed(2)} EUR`;p.moveDown(.5).text(`Complément : prix album ${money(line.completion.basePriceCents)} ; crédit ${money(line.completion.creditCents)} ; reste ${money(line.completion.basePriceCents-line.completion.creditCents)}.`);
      for(const source of line.completion.sources)p.text(`${line.content.find(t=>t.trackId===source.trackId)?.title??"Titre acquis"} : payé ${money(source.paidCents)}, remboursé ${money(source.refundedCents)}, ${free?"montant éligible pris en compte":"crédit utilisé"} ${money(source.creditCents)}.`);
    }
  }
  if (s.terms?.sections) {
    // Render the acquired structure, not the current legal template. One statutory
    // box per page fragment keeps a long model legible without clipping its border.
    const left = 48, width = p.page.width - 96, bottom = () => p.page.height - 48;
    for (const section of s.terms.sections) {
      p.font("Helvetica-Bold").fontSize(11);
      const headingHeight=p.heightOfString(section.title,{width});
      p.font("Helvetica").fontSize(10);
      const firstParagraphHeight=section.paragraphs[0]?p.heightOfString(section.paragraphs[0],{width:section.boxed?width-20:width}):0;
      // Keep the heading and the first boxed paragraph together. Starting an
      // empty border at the foot of a page is not a meaningful box fragment.
      if(p.y+(section.boxed?headingHeight+firstParagraphHeight+50:70)>bottom())p.addPage();
      p.moveDown().font("Helvetica-Bold").fontSize(11).text(section.title, left, p.y, { width });
      p.font("Helvetica").fontSize(10).moveDown(.5);
      if (!section.boxed) { for (const paragraph of section.paragraphs) p.text(paragraph, left, p.y, { width }).moveDown(.5); continue; }
      let boxTop = p.y;
      const border = () => p.save().lineWidth(.75).strokeColor("#333333").rect(left, boxTop, width, p.y - boxTop + 8).stroke().restore();
      p.y += 10;
      for (const paragraph of section.paragraphs) {
        const height = p.heightOfString(paragraph, { width: width - 20 });
        if (p.y + height + 18 > bottom()) { border(); p.addPage(); boxTop = p.y; p.y += 10; }
        p.text(paragraph, left + 10, p.y, { width: width - 20 }).moveDown(.5);
      }
      border(); p.y += 18;
    }
  } else p.moveDown().text(String(snapshot.termsText));
  p.moveDown().text(s.earlyDelivery.text).moveDown(.5).text(s.withdrawal.text);
  p.moveDown().text(`Le paiement ou cet email d’information ne suffisent pas à prouver la perte du droit. La fourniture${mode==="TEST"?" QA":""} commence seulement après réception reconnue du document. Aucun droit de publication/distribution/monétisation n’est cédé.`);
  if(mode==="TEST")p.moveDown().text(DIGITAL_FISCAL_REVIEW_NOTICE); p.end(); return result;
}
export async function processDigitalDocuments(limit = 10, renderer?: (kind: string, snapshot: Record<string, unknown>, hash: string, number: string) => Promise<Buffer>, orderId?:string) {
  const mode=requireDigitalEnvironment(); let ready = 0;
  if(orderId)assertDigitalUuid(orderId);
  const rows = await prisma.digitalDocument.findMany({ where: { order:{mode},...(orderId?{orderId}:{}),availableAt: { lte: new Date() }, OR: [{ status: { in: ["PENDING", "RETRY"] } }, { status: "PROCESSING", leaseUntil: { lte: new Date() } }] }, take: Math.min(limit, 10), orderBy: { createdAt: "asc" } });
  for (const row of rows) {
    if (row.attempts >= 5) { await prisma.digitalDocument.updateMany({ where: { id: row.id, status: { not: "READY" } }, data: { status: "REQUIRES_REVIEW" } }); continue; }
    const token = randomUUID();
    const c = await prisma.digitalDocument.updateMany({ where: { id: row.id, attempts: row.attempts, OR: [{ status: { in: ["PENDING", "RETRY"] } }, { status: "PROCESSING", leaseUntil: { lte: new Date() } }] }, data: { status: "PROCESSING", attempts: { increment: 1 }, leaseToken: token, leaseUntil: new Date(Date.now() + 60000) } });
    if (!c.count) continue;
    try {
      if (billingSnapshotHash(row.snapshot) !== row.snapshotHash) throw new DigitalError("DOCUMENT_HASH_MISMATCH");
      const s = row.snapshot as Record<string, unknown>;
      if((s.mode??"TEST")!==mode)throw new DigitalError("DOCUMENT_REQUIRES_REVIEW",409);
      const pdf = renderer ? await renderer(row.kind, s, row.snapshotHash, row.number) : row.kind === "INVOICE"
        ? (await generateInvoicePdf(invoiceRecord(s, row.snapshotHash), mode==="LIVE"?"FINAL":"TEST",{digital:true})).bytes : row.kind === "CREDIT_NOTE"
          ? (await generateCreditNotePdf({ ...s, issuedAt: new Date(s.issuedAt as string), snapshotHashSha256: row.snapshotHash,
            invoice: invoiceRecord(s.invoice as Record<string, unknown>, billingSnapshotHash(s.invoice)) } as CreditNotePdfRecord, mode==="LIVE"?"FINAL":"TEST",{digital:true})).bytes : await generateDigitalContractPdf(s, row.number);
      if (!pdf.length || pdf.length > 2097152 || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new DigitalError("INVALID_PDF");
      const changed = await prisma.digitalDocument.updateMany({ where: { id: row.id, leaseToken: token, status: "PROCESSING", leaseUntil: { gt: new Date() } }, data: { status: "READY", pdf: new Uint8Array(pdf), pdfHash: createHash("sha256").update(pdf).digest("hex"), leaseUntil: null, leaseToken: null, errorCode: null } });
      ready += changed.count;
    } catch (e) { await prisma.digitalDocument.updateMany({ where: { id: row.id, leaseToken: token, status: "PROCESSING" }, data: { status: row.attempts + 1 >= 5 ? "REQUIRES_REVIEW" : "RETRY", availableAt: new Date(Date.now() + 60000), leaseToken: null, leaseUntil: null, errorCode: e instanceof DigitalError ? e.code : "PDF_GENERATION_FAILED" } }); }
  }
  return { ready };
}
export async function acknowledgeDigitalContract(userId: string, orderId: string, documentId: string, hash: string) {
  const mode=requireDigitalEnvironment();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-user:${userId}`})) IS NULL AS locked`;
    const o = await tx.digitalOrder.findFirst({ where: { id: orderId, userId, mode,status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "GRANTED"] }, user: { status: "ACTIVE", emailVerified: true } } });
    const d = await tx.digitalDocument.findFirst({ where: { id: documentId, orderId, kind: "CONTRACT", status: "READY", snapshotHash: hash } });
    if (!o || !d || !o.contractSnapshot || !await tx.digitalEvent.findFirst({ where: { orderId, actorId: userId, kind: "DOCUMENT_TRANSFER_FINISHED", details: { path: ["documentId"], equals: documentId } } })) throw new DigitalError("CONTRACT_RECEIPT_REQUIRED", 409);
    if([DIGITAL_FRANCE_CONTRACT_POLICY,DIGITAL_FRANCE_LIVE_CONTRACT_POLICY].includes((o.contractSnapshot as {policy:string}).policy)){
      const contract=verifyContractSnapshot(o.contractSnapshot,o.termsVersion,o.termsHash).snapshot;
      const document=d.snapshot as {contract?:unknown;orderNumberSnapshot?:string;termsText?:string};
      if(billingSnapshotHash(d.snapshot)!==d.snapshotHash||billingSnapshotHash(document.contract)!==billingSnapshotHash(contract)
        ||document.orderNumberSnapshot!==o.id||document.termsText!==contract.terms.text)throw new DigitalError("CONTRACT_REQUIRES_REVIEW",409);
    }
    if(o.status==="GRANTED"&&(billingSnapshotHash(d.snapshot)!==d.snapshotHash
      ||billingSnapshotHash((d.snapshot as {contract?:unknown}).contract)!==billingSnapshotHash(o.contractSnapshot)
      ||(d.snapshot as {supply?:{kind?:string}}).supply?.kind!=="FREE_ALBUM_COMPLETION"))throw new DigitalError("FREE_COMPLETION_PROOF_REQUIRED",409);
    // A full price reduction may retain rights; a resolution must never restore them.
    if(o.status==="REFUNDED"&&!await tx.digitalEntitlement.findFirst({where:{userId,status:"ACTIVE",line:{orderId}}}))throw new DigitalError("CONTRACT_RECEIPT_REQUIRED",409);
    const current = await tx.digitalFulfillment.findUniqueOrThrow({ where: { orderId } });
    if (current.confirmationAt) return { acknowledged: true };
    await checkDigitalAcquiredJurisdiction(o.jurisdictionSnapshot,tx,undefined,userId);
    const acquiredLines=await tx.digitalOrderLine.findMany({where:{orderId},select:{trackSnapshot:true,completionSnapshot:true}});
    await checkDigitalAcquiredRightsReview(o.contractSnapshot,acquiredLines,tx);
    await verifyDigitalPinnedMedia(tx,acquiredLines);
    if(acquiredLines.some(line=>line.completionSnapshot))await verifyDigitalCompletions(tx,orderId,userId);
    const at = new Date();
    await tx.digitalFulfillment.update({ where: { orderId }, data: { confirmationStatus: "ACKNOWLEDGED", confirmationAt: at, accessReadyAt: at,
      confirmationEvidence: { type: mode==="TEST"?"OWNER_EXPLICIT_QA_RECEIPT_AFTER_TRANSFER":"OWNER_EXPLICIT_RECEIPT_AFTER_TRANSFER", documentId, snapshotHash: hash, at: at.toISOString(), policy: mode==="TEST"?"PROPOSED_NOT_LEGAL_VALIDATION":DIGITAL_FRANCE_LIVE_CONTRACT_POLICY } } });
    await tx.digitalEvent.create({ data: { orderId, actorId: userId, kind: "CONTRACT_RECEIPT_ACKNOWLEDGED", details: { documentId, snapshotHash: hash, policy: mode==="TEST"?"QA_EXPLICIT_RECEIPT":DIGITAL_FRANCE_LIVE_CONTRACT_POLICY } } });
    await enqueueDigitalEmail(tx, orderId, "ACCESS_READY", `access-mail:${orderId}`);
    return { acknowledged: true };
  });
}
export async function digitalDocumentResponse(actor: { id: string; role: string }, id: string, method = "GET") {
  const mode=requireDigitalEnvironment();assertDigitalUuid(id);
  const currentUser=await prisma.user.findFirst({where:{id:actor.id,status:"ACTIVE",emailVerified:true},select:{role:true}});if(!currentUser)throw new DigitalError("NOT_FOUND",404);
  const d = await prisma.digitalDocument.findFirst({ where: { id, order: currentUser.role === "ADMIN" ? {mode} : { userId: actor.id,mode } }, include: { order: true } });
  if (!d || d.status !== "READY" || !d.pdf) throw new DigitalError("NOT_FOUND", 404);
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
