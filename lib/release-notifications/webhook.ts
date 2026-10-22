import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { RESEND_WEBHOOK_EVENT_TYPES, resendWebhookEventCode, unmatchedResendWebhookEventCode, type VerifiedResendWebhookEvent } from "@/lib/notifications/resend-webhook";

export function releaseWebhookUpdate(status: string, event: VerifiedResendWebhookEvent) {
  if (["BOUNCED", "COMPLAINED", "SUPPRESSED", "CANCELED", "REQUIRES_REVIEW"].includes(status)) return null;
  if (event.type === "email.complained") return { status: "COMPLAINED", lastErrorCode: "RECIPIENT_COMPLAINT" };
  if (event.type === "email.bounced") return { status: "BOUNCED", lastErrorCode: "RECIPIENT_BOUNCED" };
  if (event.type === "email.suppressed") return { status: "SUPPRESSED", lastErrorCode: "RECIPIENT_SUPPRESSED" };
  if (event.type === "email.failed") return { status: "REQUIRES_REVIEW", lastErrorCode: "PROVIDER_DELIVERY_FAILED" };
  if (event.type === "email.delivered") return { status: "DELIVERED", deliveredAt: event.occurredAt, lastErrorCode: null };
  return null;
}

/** Called only after the existing Resend signature/environment/suppression logic. */
export async function processReleaseWebhook(tx: Prisma.TransactionClient, event: VerifiedResendWebhookEvent) {
  if (!event.providerMessageId) return null;
  const delivery = await tx.releaseAlertDelivery.findUnique({ where: { providerMessageId: event.providerMessageId } });
  if (!delivery) return null;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`release-alert:${delivery.id}`})) IS NULL AS locked`;
  if (delivery.deploymentEnvironment !== event.deploymentEnvironment || !event.recipient || delivery.recipient !== event.recipient.toLowerCase()) {
    return { outcome: "REQUIRES_REVIEW" as const, code: "RELEASE_DESTINATION_OR_ENVIRONMENT_MISMATCH" };
  }
  const update = releaseWebhookUpdate(delivery.status, event);
  if (update) await tx.releaseAlertDelivery.update({ where: { id: delivery.id }, data: { ...update, leaseToken: null, leaseUntil: null } });
  return { outcome: update ? "PROCESSED" as const : "IGNORED" as const, code: `RELEASE_${event.type.replaceAll(".", "_").toUpperCase()}` };
}

/** Same early-event proof and lock order as the existing order outbox markSent.
 * Reconciles only already signature-verified audit rows for this exact provider
 * message, environment and hashed recipient. No synthetic receipt is invented. */
export async function markReleaseAlertSent(tx: Prisma.TransactionClient,
  input: { id: string; leaseToken: string; providerMessageId: string; now: Date }) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:webhook:message:${input.providerMessageId}`})) IS NULL AS locked`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`release-alert:${input.id}`})) IS NULL AS locked`;
  const delivery = await tx.releaseAlertDelivery.findUniqueOrThrow({ where: { id: input.id } });
  if (delivery.status !== "PROCESSING" || delivery.leaseToken !== input.leaseToken) throw new Error("RELEASE_ALERT_LEASE_CHANGED");
  const allowedTypes = RESEND_WEBHOOK_EVENT_TYPES.filter(type => type.startsWith("email."));
  const candidates = await tx.notificationEvent.findMany({ where: { providerMessageId: input.providerMessageId,
    providerEventType: { in: [...allowedTypes] }, notificationId: null, outcome: "REQUIRES_REVIEW",
    code: { startsWith: `UNMATCHED_${delivery.deploymentEnvironment.toUpperCase()}_` } },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 50,
    select: { id: true, providerEventId: true, providerEventType: true, occurredAt: true, code: true } });
  let state: { status: string; deliveredAt: Date | null; lastErrorCode: string | null } = { status: "SENT", deliveredAt: delivery.deliveredAt, lastErrorCode: null };
  const reconciled: Array<{ id: string; outcome: "PROCESSED" | "IGNORED"; code: string }> = [];
  for (const candidate of candidates) {
    if (!candidate.providerEventId || !allowedTypes.includes(candidate.providerEventType as typeof allowedTypes[number])) continue;
    const bounceType = candidate.code?.includes("EMAIL_BOUNCED_PERMANENT") ? "Permanent"
      : candidate.code?.includes("EMAIL_BOUNCED_TRANSIENT") ? "Transient"
        : candidate.code?.includes("EMAIL_BOUNCED_UNDETERMINED") ? "Undetermined" : null;
    const event: VerifiedResendWebhookEvent = { providerEventId: candidate.providerEventId,
      type: candidate.providerEventType!, occurredAt: candidate.occurredAt, providerMessageId: input.providerMessageId,
      recipient: delivery.recipient, deploymentEnvironment: delivery.deploymentEnvironment as VerifiedResendWebhookEvent["deploymentEnvironment"],
      bounceType, bounceSubType: null, suppressionOrigin: null };
    if (candidate.code !== unmatchedResendWebhookEventCode(event, delivery.recipient)) continue;
    const update = releaseWebhookUpdate(state.status, event);
    if (update) state = { ...state, ...update };
    reconciled.push({ id: candidate.id, outcome: update ? "PROCESSED" : "IGNORED",
      code: `RELEASE_${resendWebhookEventCode(event)}_${update ? "RECONCILED" : "IGNORED"}`.slice(0, 80) });
  }
  const updated = await tx.releaseAlertDelivery.updateMany({ where: { id: input.id, leaseToken: input.leaseToken, status: "PROCESSING" },
    data: { ...state, providerMessageId: input.providerMessageId, sentAt: input.now, leaseToken: null, leaseUntil: null } });
  if (updated.count !== 1) throw new Error("RELEASE_ALERT_LEASE_CHANGED");
  for (const event of reconciled) await tx.notificationEvent.update({ where: { id: event.id }, data: { outcome: event.outcome, code: event.code } });
}
