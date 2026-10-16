import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {Prisma} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isFictitiousRecipient,normalizeNotificationRecipient,NOTIFICATION_PROVIDER_IDEMPOTENCY_SAFE_AGE_MS } from "@/lib/notifications/domain";
import { parseNotificationConfiguration } from "@/lib/notifications/config";
import { sendResendEmail,type ResendEmailSender } from "@/lib/email/resend-adapter";
import { withdrawalReceiptText } from "@/lib/legal/withdrawal-policy";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { DigitalError, requireDigitalEnvironment, assertDigitalUuid } from "./domain";
export type DigitalMail = { id: string; recipient: string; businessKey: string; template: unknown };
export type DigitalMailResult = { id: string; evidence: "CAPTURED_QA" | "SENT" };
/** Reuses the existing Resend adapter/configuration, never a synthetic physical
 * order. Queue provenance is checked before this function by the worker. */
export async function sendDigitalLiveEmail(message:DigitalMail,injectedSender?:ResendEmailSender):Promise<DigitalMailResult>{
  if(requireDigitalEnvironment()!=="LIVE")throw new DigitalError("LIVE_MAIL_ONLY",503);
  const c=parseNotificationConfiguration();
  if(c.deploymentEnvironment!=="production"||c.emailTransport!=="resend"||!c.emailEnabled||!c.clientEmailEnabled
    ||!c.resendApiKey||!c.emailFrom||!c.emailReplyTo||c.canonicalUrl!=="https://www.lnxbeats.fr")throw new DigitalError("LIVE_MAIL_NOT_CONFIGURED",503);
  const recipient=normalizeNotificationRecipient(message.recipient),t=message.template as {mode?:string;subject?:unknown;text?:unknown;html?:unknown}|null;
  if(!recipient||isFictitiousRecipient(recipient)||recipient.endsWith("@resend.dev")||t?.mode!=="LIVE"
    ||typeof t.subject!=="string"||!t.subject||t.subject.length>240||/[\r\n]/.test(t.subject)
    ||typeof t.text!=="string"||!t.text||t.text.length>131072||typeof t.html!=="string"||!t.html||t.html.length>262144
    ||/TEST|DOCUMENT QA|sans valeur comptable/.test(t.subject))throw new DigitalError("LIVE_MAIL_REQUIRES_REVIEW",409);
  const id=await sendResendEmail({apiKey:c.resendApiKey,idempotencyKey:`dcn-mail:${billingSnapshotHash({id:message.id,businessKey:message.businessKey})}`,
    message:{from:c.emailFrom,to:[recipient],replyTo:c.emailReplyTo,subject:t.subject,text:t.text,html:t.html}},injectedSender);
  // Provider acceptance is SENT, not DELIVERED or a durable-contract receipt.
  return{id,evidence:"SENT"};
}
/** Local capture is an idempotent file, not delivery, reading or a legal confirmation. */
export async function captureDigitalEmail(message: DigitalMail): Promise<DigitalMailResult> {
  if(requireDigitalEnvironment()!=="TEST")throw new DigitalError("QA_MAIL_ONLY",503);
  if (process.env.EMAIL_PROVIDER !== "capture" || !isFictitiousRecipient(message.recipient)) throw new DigitalError("QA_MAIL_ONLY", 503);
  const root = path.resolve(process.env.DCN_EMAIL_CAPTURE_ROOT ?? ".private/dcn-mail-outbox");
  if (!root.startsWith(`${path.resolve(".private")}${path.sep}`) && !root.startsWith("/private/tmp/lnx-dcn-")) throw new DigitalError("INVALID_CAPTURE_ROOT");
  const id = `dcn_capture_${billingSnapshotHash(message)}`;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const record = JSON.stringify({ ...message, transportId: id, evidence: "CAPTURED_QA_NOT_DELIVERED" });
  try { await writeFile(path.join(root, `${id}.json`), record, { flag: "wx", mode: 0o600 }); }
  catch (e) { if (!(e instanceof Error) || !("code" in e) || e.code !== "EEXIST") throw e;
    if (await readFile(path.join(root, `${id}.json`), "utf8") !== record) throw new DigitalError("MAIL_IDEMPOTENCY_CONFLICT"); }
  return { id, evidence: "CAPTURED_QA" };
}
export async function processDigitalNotifications(limit = 10, sender?: (message:DigitalMail)=>Promise<DigitalMailResult>, orderId?:string, withdrawalRequestId?:string) {
  const mode=requireDigitalEnvironment(); const result = { captured: 0, sent: 0, failed: 0 };
  if(mode==="LIVE"){
    const c=parseNotificationConfiguration();
    if(!c.emailEnabled||!c.clientEmailEnabled)return result; // Paused, not failed/sent.
  }
  if(orderId)assertDigitalUuid(orderId);
  if(withdrawalRequestId)assertDigitalUuid(withdrawalRequestId);
  if(orderId && withdrawalRequestId)throw new DigitalError("INVALID_NOTIFICATION_SCOPE");
  const rows = await prisma.digitalNotification.findMany({ where: { AND:[{OR:[{order:{mode}}, {withdrawalRequest:{contractType:"DIGITAL_ORDER",
    ...(mode==="LIVE"?{acknowledgementSnapshot:{path:["digitalMode"],equals:"LIVE"}}:{OR:[{digitalOrder:{mode:"TEST"}},{digitalOrderId:null,OR:[{acknowledgementSnapshot:{path:["digitalMode"],equals:"TEST"}},{acknowledgementSnapshot:{path:["digitalMode"],equals:Prisma.AnyNull}}]}]})}}]}],
    ...(orderId?{orderId}:{}), ...(withdrawalRequestId?{withdrawalRequestId}:{}), availableAt: { lte: new Date() }, OR: [
    { status: { in: ["PENDING", "RETRY"] } }, { status: "PROCESSING", leaseUntil: { lte: new Date() } },
  ] },include:{order:{select:{mode:true,contractSnapshot:true}},withdrawalRequest:{select:{contractType:true,claimantEmail:true,acknowledgementSnapshot:true,acknowledgementHashSha256:true}}}, orderBy: { createdAt: "asc" }, take: Math.min(limit, 25) });
  for (const row of rows) {
    if (row.attempts >= 5 || row.firstAttemptAt && Date.now() - row.firstAttemptAt.getTime() > NOTIFICATION_PROVIDER_IDEMPOTENCY_SAFE_AGE_MS) {
      await prisma.digitalNotification.updateMany({ where: { id: row.id, status: { in: ["PENDING", "RETRY", "PROCESSING"] } }, data: { status: "REQUIRES_REVIEW", leaseToken: null, leaseUntil: null } }); continue;
    }
    const leaseToken = randomUUID();
    const claim = await prisma.digitalNotification.updateMany({ where: { id: row.id, attempts: row.attempts, OR: [
      { status: { in: ["PENDING", "RETRY"] } }, { status: "PROCESSING", leaseUntil: { lte: new Date() } },
    ] }, data: { status: "PROCESSING", attempts: { increment: 1 }, firstAttemptAt: row.firstAttemptAt ?? new Date(), leaseToken, leaseUntil: new Date(Date.now() + 120000) } });
    if (!claim.count) continue;
    try {
      if(mode==="LIVE"){
        const template=row.template as {mode?:string;text?:string};
        if(template.mode!=="LIVE")throw new DigitalError("LIVE_MAIL_REQUIRES_REVIEW",409);
        if(row.orderId){const customer=(row.order?.contractSnapshot as {customer?:{email?:string}})?.customer;
          if(row.order?.mode!=="LIVE"||!customer?.email||normalizeNotificationRecipient(customer.email)!==normalizeNotificationRecipient(row.recipient))throw new DigitalError("LIVE_MAIL_REQUIRES_REVIEW",409);
        }else{const w=row.withdrawalRequest,s=w?.acknowledgementSnapshot as {digitalMode?:string}|undefined;
          if(!w||w.contractType!=="DIGITAL_ORDER"||s?.digitalMode!=="LIVE"||normalizeNotificationRecipient(w.claimantEmail)!==normalizeNotificationRecipient(row.recipient)
            ||template.text!==withdrawalReceiptText(w.acknowledgementSnapshot,w.acknowledgementHashSha256))throw new DigitalError("LIVE_MAIL_REQUIRES_REVIEW",409);
        }
      }
      const r = await (sender??(mode==="LIVE"?sendDigitalLiveEmail:captureDigitalEmail))({ id: row.id, recipient: row.recipient, businessKey: row.businessKey, template: row.template });
      if(!r||typeof r.id!=="string"||!r.id||r.id.length>255||!(["SENT","CAPTURED_QA"] as string[]).includes(r.evidence))throw new DigitalError("MAIL_EVIDENCE_MISMATCH",409);
      if(mode==="LIVE"&&r.evidence!=="SENT"||mode==="TEST"&&r.evidence==="SENT"&&!sender)throw new DigitalError("MAIL_EVIDENCE_MISMATCH",409);
      const c = await prisma.digitalNotification.updateMany({ where: { id: row.id, status: "PROCESSING", leaseToken, leaseUntil: { gt: new Date() } }, data: {
        status: r.evidence, transportId: r.id, ...(r.evidence === "CAPTURED_QA" ? { capturedAt: new Date() } : { sentAt: new Date() }), leaseToken: null, leaseUntil: null } });
      // A QA file is never a sent acknowledgement. Notification evidence remains
      // authoritative if a worker stops before this optional status projection.
      if (c.count && row.withdrawalRequestId && r.evidence === "SENT") await prisma.consumerWithdrawalRequest.updateMany({
        where: { id: row.withdrawalRequestId, acknowledgementSentAt: null }, data: { acknowledgementStatus: "SENT", acknowledgementSentAt: new Date() },
      });
      if (c.count) { if (r.evidence === "CAPTURED_QA") result.captured++; else result.sent++; }
    } catch { await prisma.digitalNotification.updateMany({ where: { id: row.id, status: "PROCESSING", leaseToken }, data: { status: row.attempts + 1 >= 5 ? "REQUIRES_REVIEW" : "RETRY", availableAt: new Date(Date.now() + 60000), leaseToken: null, leaseUntil: null } }); result.failed++; }
  }
  return result;
}
