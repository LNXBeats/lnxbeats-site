import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { isFictitiousRecipient } from "@/lib/notifications/domain";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { DigitalError, requireDigitalEnvironment } from "./domain";
export type DigitalMail = { id: string; recipient: string; businessKey: string; template: unknown };
export type DigitalMailResult = { id: string; evidence: "CAPTURED_QA" | "SENT" };
/** Local capture is an idempotent file, not delivery, reading or a legal confirmation. */
export async function captureDigitalEmail(message: DigitalMail): Promise<DigitalMailResult> {
  requireDigitalEnvironment();
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
export async function processDigitalNotifications(limit = 10, sender = captureDigitalEmail) {
  requireDigitalEnvironment(); const result = { captured: 0, sent: 0, failed: 0 };
  const rows = await prisma.digitalNotification.findMany({ where: { availableAt: { lte: new Date() }, OR: [
    { status: { in: ["PENDING", "RETRY"] } }, { status: "PROCESSING", leaseUntil: { lte: new Date() } },
  ] }, orderBy: { createdAt: "asc" }, take: Math.min(limit, 25) });
  for (const row of rows) {
    if (row.attempts >= 5 || row.firstAttemptAt && Date.now() - row.firstAttemptAt.getTime() > 23 * 3600000) {
      await prisma.digitalNotification.updateMany({ where: { id: row.id, status: { in: ["PENDING", "RETRY", "PROCESSING"] } }, data: { status: "REQUIRES_REVIEW", leaseToken: null, leaseUntil: null } }); continue;
    }
    const leaseToken = randomUUID();
    const claim = await prisma.digitalNotification.updateMany({ where: { id: row.id, attempts: row.attempts, OR: [
      { status: { in: ["PENDING", "RETRY"] } }, { status: "PROCESSING", leaseUntil: { lte: new Date() } },
    ] }, data: { status: "PROCESSING", attempts: { increment: 1 }, firstAttemptAt: row.firstAttemptAt ?? new Date(), leaseToken, leaseUntil: new Date(Date.now() + 120000) } });
    if (!claim.count) continue;
    try {
      const r = await sender({ id: row.id, recipient: row.recipient, businessKey: row.businessKey, template: row.template });
      const c = await prisma.digitalNotification.updateMany({ where: { id: row.id, status: "PROCESSING", leaseToken, leaseUntil: { gt: new Date() } }, data: {
        status: r.evidence, transportId: r.id, ...(r.evidence === "CAPTURED_QA" ? { capturedAt: new Date() } : { sentAt: new Date() }), leaseToken: null, leaseUntil: null } });
      if (c.count) { if (r.evidence === "CAPTURED_QA") result.captured++; else result.sent++; }
    } catch { await prisma.digitalNotification.updateMany({ where: { id: row.id, status: "PROCESSING", leaseToken }, data: { status: row.attempts + 1 >= 5 ? "REQUIRES_REVIEW" : "RETRY", availableAt: new Date(Date.now() + 60000), leaseToken: null, leaseUntil: null } }); result.failed++; }
  }
  return result;
}
