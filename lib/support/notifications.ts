import "server-only";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { parseNotificationConfiguration, type NotificationConfiguration } from "@/lib/notifications/config";
import { automaticNotificationRetryIsSafe, isFictitiousRecipient, isOfficialResendTestRecipient } from "@/lib/notifications/domain";
import { sendResendEmail } from "@/lib/email/resend-adapter";
import { supportEmailTemplate } from "@/lib/support/notification-template";

export async function enqueueSupportNotifications(tx: Prisma.TransactionClient, input: { id: string }) {
  const value = await tx.supportContribution.findUniqueOrThrow({ where: { id: input.id } });
  if (value.status !== "SUCCEEDED" || !value.paymentReference) return;
  await tx.supportNotification.createMany({ data: [
    ...(value.supporterEmail ? [{ contributionId: value.id, mode: value.mode, audience: "SUPPORTER", recipient: value.supporterEmail,
      idempotencyKey: `support-email:${value.id}:SUPPORTER:v1` }] : []),
    { contributionId: value.id, mode: value.mode, audience: "ADMIN", idempotencyKey: `support-email:${value.id}:ADMIN:v1` },
  ], skipDuplicates: true });
}

type Message = { id: string; audience: string; recipient: string; idempotencyKey: string; template: ReturnType<typeof supportEmailTemplate> };
export type SupportEmailSender = (message: Message) => Promise<string>;
function sender(configuration: NotificationConfiguration): SupportEmailSender {
  return async message => {
    if (configuration.emailTransport === "capture") {
      // Capture is forbidden in Production by the shared configuration parser.
      await mkdir(dirname(configuration.capturePath), { recursive: true, mode: 0o700 });
      const id = `capture_support_${message.id}`;
      await appendFile(configuration.capturePath, JSON.stringify({ id, source: "support", audience: message.audience,
        recipient: message.recipient, ...message.template }) + "\n", { mode: 0o600 });
      return id;
    }
    if (configuration.emailTransport !== "resend") throw new Error("Email disabled");
    if (isFictitiousRecipient(message.recipient)) throw new Error("QA destination");
    if (configuration.deploymentEnvironment === "staging" && !isOfficialResendTestRecipient(message.recipient)
      && !configuration.stagingRecipientAllowlist.includes(message.recipient)) throw new Error("Staging destination");
    if (configuration.deploymentEnvironment === "production" && isOfficialResendTestRecipient(message.recipient)) throw new Error("Test destination");
    return sendResendEmail({ apiKey: configuration.resendApiKey!, idempotencyKey: message.idempotencyKey,
      message: { from: configuration.emailFrom!, to: message.recipient, replyTo: configuration.emailReplyTo!,
        ...message.template, tags: [{ name: "lnx_source", value: "support_outbox" }], headers: { "X-Entity-Ref-ID": message.id } } });
  };
}

export async function dispatchSupportNotifications(limit = 25, injected?: SupportEmailSender,
  configuration = parseNotificationConfiguration()) {
  const result = { claimed: 0, delivered: 0, failed: 0, skipped: 0 };
  if (!configuration.emailEnabled || !configuration.workerEnabled) return result;
  const mode = configuration.deploymentEnvironment === "production" ? "LIVE" : "TEST";
  const now = new Date();
  const candidates = await prisma.supportNotification.findMany({ where: { mode, availableAt: { lte: now }, OR: [
    { status: { in: ["PENDING", "FAILED_RETRYABLE"] } }, { status: "PROCESSING", leaseUntil: { lte: now } },
  ] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: Math.min(Math.max(limit,1),25), select: { id: true } });
  for (const candidate of candidates) {
    const claim = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`support-mail:${candidate.id}`})) IS NULL AS locked`;
      const row = await tx.supportNotification.findUniqueOrThrow({ where: { id: candidate.id }, include: { contribution: true } });
      if (row.mode !== mode || ["SENT", "REQUIRES_REVIEW", "SUPPRESSED"].includes(row.status)
        || (row.leaseUntil && row.leaseUntil > now) || row.availableAt > now) return null;
      const recipient = row.recipient ?? (row.audience === "ADMIN" ? configuration.ownerRecipient : row.contribution.supporterEmail);
      const enabled = row.audience === "ADMIN" ? configuration.ownerEmailEnabled : configuration.clientEmailEnabled;
      if (!enabled || !recipient) return null;
      if (row.audience === "ADMIN" && recipient !== configuration.ownerRecipient) return null;
      if (row.audience === "SUPPORTER" && recipient !== row.contribution.supporterEmail) return null;
      if ((row.attempts > 0 && !row.firstAttemptAt)
        || (row.firstAttemptAt && !automaticNotificationRetryIsSafe(row.firstAttemptAt, now)) || row.attempts >= 5
        || row.contribution.status !== "SUCCEEDED" || !row.contribution.paymentReference) {
        await tx.supportNotification.update({ where: { id: row.id }, data: { status: "REQUIRES_REVIEW", leaseToken: null, leaseUntil: null } });
        return null;
      }
      const suppression = await tx.notificationSuppression.findUnique({ where: { channel_recipient: { channel: "EMAIL", recipient } }, select: { active: true } });
      if (suppression?.active) {
        await tx.supportNotification.update({ where: { id: row.id }, data: { status: "SUPPRESSED" } }); return null;
      }
      const leaseToken = randomUUID();
      await tx.supportNotification.update({ where: { id: row.id }, data: { status: "PROCESSING", recipient, leaseToken,
        leaseUntil: new Date(now.getTime()+120000), attempts: { increment: 1 }, firstAttemptAt: row.firstAttemptAt ?? now } });
      return { ...row, recipient, leaseToken };
    });
    if (!claim) { result.skipped++; continue; }
    result.claimed++;
    try {
      const providerMessageId = await (injected ?? sender(configuration))({ id: claim.id, audience: claim.audience, recipient: claim.recipient,
        idempotencyKey: claim.idempotencyKey, template: supportEmailTemplate(claim.contribution, claim.audience) });
      await prisma.supportNotification.updateMany({ where: { id: claim.id, leaseToken: claim.leaseToken },
        data: { status: "SENT", providerMessageId, sentAt: new Date(), leaseToken: null, leaseUntil: null } });
      result.delivered++;
    } catch {
      await prisma.supportNotification.updateMany({ where: { id: claim.id, leaseToken: claim.leaseToken }, data: {
        status: "FAILED_RETRYABLE", availableAt: new Date(Date.now()+60000), leaseToken: null, leaseUntil: null } });
      result.failed++;
    }
  }
  return result;
}
