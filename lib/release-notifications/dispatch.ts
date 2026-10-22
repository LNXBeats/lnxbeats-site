import "server-only";
import { randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { parseNotificationConfiguration, type NotificationConfiguration } from "@/lib/notifications/config";
import { automaticNotificationRetryIsSafe, isFictitiousRecipient, isOfficialResendTestRecipient } from "@/lib/notifications/domain";
import { ResendAdapterError, sendResendEmail } from "@/lib/email/resend-adapter";
import { releaseAlertEligible } from "@/lib/release-notifications/domain";
import { releasePublicationSource } from "@/lib/release-notifications/publications";
import { releaseAlertTemplate } from "@/lib/release-notifications/template";
import { releaseAlertUnsubscribeToken } from "@/lib/release-notifications/token";
import { markReleaseAlertSent } from "@/lib/release-notifications/webhook";

export const RELEASE_ALERT_MAX_AGE_MS = 24 * 60 * 60_000;
export type ReleaseAlertMessage = { id: string; recipient: string; idempotencyKey: string; unsubscribeUrl: string;
  oneClickUrl: string; template: ReturnType<typeof releaseAlertTemplate> };
export type ReleaseAlertSender = (message: ReleaseAlertMessage) => Promise<string>;
function samePublicationAudience(path: string, sourcePath: string) {
  // A pending member-premiere alert cannot turn into a different public release.
  return !path.startsWith("/avant-premieres#") || sourcePath.startsWith("/avant-premieres#");
}

function marketingSender(configuration: NotificationConfiguration): ReleaseAlertSender {
  return async message => {
    if (configuration.emailTransport === "capture") {
      await mkdir(dirname(configuration.capturePath), { recursive: true, mode: 0o700 });
      await appendFile(configuration.capturePath, JSON.stringify({ source: "release_alerts", id: message.id, recipient: message.recipient,
        idempotencyKey: message.idempotencyKey, ...message.template }) + "\n", { mode: 0o600 });
      await chmod(configuration.capturePath, 0o600);
      return `capture_release_${message.id}`;
    }
    if (configuration.emailTransport !== "resend" || !configuration.resendApiKey || !configuration.emailFrom || !configuration.emailReplyTo) throw new Error("EMAIL_DISABLED");
    if (isFictitiousRecipient(message.recipient)) throw new Error("FICTITIOUS_RECIPIENT");
    if (configuration.deploymentEnvironment === "staging" && !isOfficialResendTestRecipient(message.recipient)
      && !configuration.stagingRecipientAllowlist.includes(message.recipient)) throw new Error("STAGING_RECIPIENT_NOT_ALLOWED");
    if (configuration.deploymentEnvironment === "production" && isOfficialResendTestRecipient(message.recipient)) throw new Error("TEST_RECIPIENT_NOT_ALLOWED");
    return sendResendEmail({ apiKey: configuration.resendApiKey, idempotencyKey: message.idempotencyKey,
      message: { from: configuration.emailFrom, to: message.recipient, replyTo: configuration.emailReplyTo, ...message.template,
        headers: { "List-Unsubscribe": `<${message.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "X-Entity-Ref-ID": message.id },
        tags: [{ name: "lnx_source", value: "release_alerts" }, { name: "lnx_environment", value: configuration.deploymentEnvironment }] } });
  };
}

/** Bounded fan-out. No historical-catalogue scan and no send on the publication HTTP request. */
async function expandPublications(database: PrismaClient, configuration: NotificationConfiguration, now: Date) {
  const pending = await database.releasePublication.findMany({ where: { baseline: false, expanded: false }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 5, select: { id: true } });
  for (const item of pending) await database.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`release-publication:${item.id}`})) IS NULL AS locked`;
    const publication = await tx.releasePublication.findUniqueOrThrow({ where: { id: item.id } });
    if (publication.expanded || publication.baseline) return;
    const source = await releasePublicationSource(tx, publication.kind, publication.resourceId);
    if (now.getTime() - publication.createdAt.getTime() > RELEASE_ALERT_MAX_AGE_MS || !source || !samePublicationAudience(publication.path, source.path)) {
      await tx.releasePublication.update({ where: { id: item.id }, data: { expanded: true } }); return;
    }
    const category = publication.kind === "MUSIC" ? "music" : publication.kind === "SHOP" ? "shop" : "editorial";
    const preferences = await tx.releaseAlertPreference.findMany({ where: {
      ...(publication.recipientCursor ? { userId: { gt: publication.recipientCursor } } : {}),
      [category]: true, [`${category}ConsentedAt`]: { lte: publication.createdAt },
      user: { status: "ACTIVE", emailVerified: true },
    }, include: { user: { select: { email: true } } }, orderBy: { userId: "asc" }, take: 100 });
    if (preferences.length) await tx.releaseAlertDelivery.createMany({ data: preferences.map(preference => ({ publicationId: publication.id,
      userId: preference.userId, recipient: preference.user.email.toLowerCase(), deploymentEnvironment: configuration.deploymentEnvironment })), skipDuplicates: true });
    await tx.releasePublication.update({ where: { id: publication.id }, data: { expanded: preferences.length < 100, recipientCursor: preferences.at(-1)?.userId ?? publication.recipientCursor } });
  });
}

export async function dispatchReleaseAlerts(limit = 25, injectedSender?: ReleaseAlertSender,
  configuration = parseNotificationConfiguration(), database: PrismaClient = prisma,
  environment: Readonly<Record<string, string | undefined>> = process.env) {
  const result = { claimed: 0, delivered: 0, failed: 0, skipped: 0 };
  // A separate operator switch: transactional email flags never subscribe members.
  if (environment.RELEASE_ALERT_EMAIL_ENABLED !== "true" || !configuration.emailEnabled || !configuration.workerEnabled
    || !configuration.canonicalUrl || (environment.AUTH_SECRET?.length ?? 0) < 32) return result;
  const now = new Date();
  await expandPublications(database, configuration, now);
  const candidates = await database.releaseAlertDelivery.findMany({ where: { deploymentEnvironment: configuration.deploymentEnvironment,
    availableAt: { lte: now }, OR: [{ status: { in: ["PENDING", "FAILED_RETRYABLE"] } }, { status: "PROCESSING", leaseUntil: { lte: now } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: Math.max(1, Math.min(limit, 25)), select: { id: true } });
  for (const candidate of candidates) {
    const claim = await database.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`release-alert:${candidate.id}`})) IS NULL AS locked`;
      const row = await tx.releaseAlertDelivery.findUniqueOrThrow({ where: { id: candidate.id }, include: { publication: true, user: { include: { releaseAlertPreference: true } } } });
      if (!["PENDING", "FAILED_RETRYABLE", "PROCESSING"].includes(row.status) || row.leaseUntil && row.leaseUntil > now || row.availableAt > now
        || row.deploymentEnvironment !== configuration.deploymentEnvironment) return null;
      const preference = row.user.releaseAlertPreference;
      const source = await releasePublicationSource(tx, row.publication.kind, row.publication.resourceId);
      const recipient = row.user.email.toLowerCase();
      const suppression = await tx.notificationSuppression.findUnique({ where: { channel_recipient: { channel: "EMAIL", recipient } }, select: { active: true } });
      if (row.user.status !== "ACTIVE" || !row.user.emailVerified || recipient !== row.recipient || !source || !samePublicationAudience(row.publication.path, source.path) || suppression?.active
        || !releaseAlertEligible(preference, row.publication.kind, row.publication.createdAt)
        || now.getTime() - row.publication.createdAt.getTime() > RELEASE_ALERT_MAX_AGE_MS) {
        await tx.releaseAlertDelivery.update({ where: { id: row.id }, data: { status: "CANCELED", lastErrorCode: "PUBLICATION_OR_CONSENT_UNAVAILABLE", leaseUntil: null, leaseToken: null } }); return null;
      }
      if (row.attempts >= 5 || row.attempts > 0 && !row.firstAttemptAt || row.firstAttemptAt && !automaticNotificationRetryIsSafe(row.firstAttemptAt, now)) {
        await tx.releaseAlertDelivery.update({ where: { id: row.id }, data: { status: "REQUIRES_REVIEW", lastErrorCode: "RETRY_WINDOW_EXPIRED", leaseUntil: null, leaseToken: null } }); return null;
      }
      const leaseToken = randomUUID();
      await tx.releaseAlertDelivery.update({ where: { id: row.id }, data: { status: "PROCESSING", attempts: { increment: 1 }, firstAttemptAt: row.firstAttemptAt ?? now, leaseToken, leaseUntil: new Date(now.getTime() + 120_000) } });
      return { ...row, source, leaseToken };
    });
    if (!claim) { result.skipped++; continue; }
    result.claimed++;
    try {
      // Recheck after claiming: withdrawal/depublication during queueing prevents delivery.
      const current = await database.user.findUnique({ where: { id: claim.userId }, include: { releaseAlertPreference: true } });
      const source = await database.$transaction(tx => releasePublicationSource(tx, claim.publication.kind, claim.publication.resourceId));
      const suppression = await database.notificationSuppression.findUnique({ where: { channel_recipient: { channel: "EMAIL", recipient: claim.recipient } }, select: { active: true } });
      const preference = current?.releaseAlertPreference;
      if (!current?.emailVerified || current.status !== "ACTIVE" || current.email.toLowerCase() !== claim.recipient || !source || !samePublicationAudience(claim.publication.path, source.path) || suppression?.active
        || !releaseAlertEligible(preference, claim.publication.kind, claim.publication.createdAt)) {
        await database.releaseAlertDelivery.updateMany({ where: { id: claim.id, leaseToken: claim.leaseToken }, data: { status: "CANCELED", lastErrorCode: "CONSENT_WITHDRAWN", leaseToken: null, leaseUntil: null } }); result.skipped++; continue;
      }
      const token = releaseAlertUnsubscribeToken(claim.userId, environment.AUTH_SECRET);
      const unsubscribeUrl = `${configuration.canonicalUrl}/desinscription?token=${encodeURIComponent(token)}`;
      const oneClickUrl = `${configuration.canonicalUrl}/api/release-alerts/unsubscribe?token=${encodeURIComponent(token)}`;
      const providerMessageId = await (injectedSender ?? marketingSender(configuration))({ id: claim.id, recipient: claim.recipient,
        idempotencyKey: `release-alert:${claim.id}:v1`, unsubscribeUrl, oneClickUrl,
        template: releaseAlertTemplate({ locale: preference?.locale, title: source.title, url: `${configuration.canonicalUrl}${source.path}`, unsubscribeUrl }) });
      await database.$transaction(tx => markReleaseAlertSent(tx, { id: claim.id, leaseToken: claim.leaseToken, providerMessageId, now: new Date() }));
      result.delivered++;
    } catch (error) {
      const permanent = error instanceof ResendAdapterError && error.statusCode !== null && error.statusCode >= 400 && error.statusCode < 500 && ![408, 429].includes(error.statusCode)
        || error instanceof Error && ["FICTITIOUS_RECIPIENT", "STAGING_RECIPIENT_NOT_ALLOWED", "TEST_RECIPIENT_NOT_ALLOWED", "EMAIL_DISABLED"].includes(error.message);
      await database.releaseAlertDelivery.updateMany({ where: { id: claim.id, leaseToken: claim.leaseToken }, data: { status: permanent ? "REQUIRES_REVIEW" : "FAILED_RETRYABLE",
        availableAt: new Date(Date.now() + 60_000), leaseToken: null, leaseUntil: null, lastErrorCode: permanent ? "PROVIDER_REJECTED" : "DELIVERY_RETRY_REQUIRED" } }); result.failed++;
    }
  }
  return result;
}
