import test from "node:test";
import assert from "node:assert/strict";
import type { VerifiedResendWebhookEvent } from "@/lib/notifications/resend-webhook";
import type { Prisma } from "@/generated/prisma/client";
import { markReleaseAlertSent, processReleaseWebhook, releaseWebhookUpdate } from "@/lib/release-notifications/webhook";
import { unmatchedResendWebhookEventCode } from "@/lib/notifications/resend-webhook";

const event = { providerEventId: "synthetic-hook", providerMessageId: "synthetic-email", type: "email.delivered", occurredAt: new Date(), recipient: "member@example.test", deploymentEnvironment: "development", bounceType: null, bounceSubType: null, suppressionOrigin: null } satisfies VerifiedResendWebhookEvent;
test("release delivery webhooks do not downgrade terminal rejection or revive canceled mail", () => {
  assert.equal(releaseWebhookUpdate("CANCELED", event), null);
  assert.equal(releaseWebhookUpdate("BOUNCED", event), null);
  assert.equal(releaseWebhookUpdate("COMPLAINED", event), null);
  assert.equal(releaseWebhookUpdate("DELIVERED", { ...event, type: "email.sent" }), null);
  assert.equal(releaseWebhookUpdate("SENT", event)?.status, "DELIVERED");
  assert.equal(releaseWebhookUpdate("SENT", { ...event, type: "email.complained" })?.status, "COMPLAINED");
  assert.equal(releaseWebhookUpdate("SENT", { ...event, type: "email.failed" })?.status, "REQUIRES_REVIEW");
});
test("only an exact marketing message ID, recipient and environment can alter that outbox", async () => {
  const writes: unknown[] = [];
  let found = true;
  const tx = { $queryRaw: async () => [], releaseAlertDelivery: { findUnique: async () => found ? { id: "delivery", status: "SENT", deploymentEnvironment: "development", recipient: event.recipient } : null,
    update: async (value: unknown) => { writes.push(value); } } } as unknown as Prisma.TransactionClient;
  assert.equal((await processReleaseWebhook(tx, event))?.outcome, "PROCESSED"); assert.equal(writes.length, 1);
  assert.equal((await processReleaseWebhook(tx, { ...event, recipient: "another@example.test" }))?.outcome, "REQUIRES_REVIEW");
  assert.equal((await processReleaseWebhook(tx, { ...event, deploymentEnvironment: "production" }))?.outcome, "REQUIRES_REVIEW"); assert.equal(writes.length, 1);
  found = false; assert.equal(await processReleaseWebhook(tx, event), null); assert.equal(writes.length, 1);
});
test("an authenticated early webhook is reconciled on markSent only with exact message, environment and recipient proof", async () => {
  const delivery = { id: "delivery", status: "PROCESSING", leaseToken: "lease", recipient: event.recipient, deploymentEnvironment: "development", deliveredAt: null };
  const candidates = [
    { id: "wrong-recipient", providerEventId: "event-other", providerEventType: event.type, occurredAt: event.occurredAt,
      code: unmatchedResendWebhookEventCode({ ...event, recipient: "other@example.test" }, "other@example.test") },
    { id: "wrong-environment", providerEventId: "event-production", providerEventType: event.type, occurredAt: event.occurredAt,
      code: unmatchedResendWebhookEventCode({ ...event, deploymentEnvironment: "production" }, event.recipient) },
    { id: "early-delivered", providerEventId: event.providerEventId, providerEventType: event.type, occurredAt: event.occurredAt,
      code: unmatchedResendWebhookEventCode(event, event.recipient) },
  ];
  const updates: Array<{ where: { id: string }; data: { outcome: string; code: string } }> = [], locks: string[] = [];
  const tx = { $queryRaw: async (_: unknown, key: string) => { locks.push(key); return []; },
    releaseAlertDelivery: { findUniqueOrThrow: async () => delivery, updateMany: async ({ data }: { data: object }) => { Object.assign(delivery, data); return { count: 1 }; } },
    notificationEvent: { findMany: async ({ where }: { where: { providerMessageId: string } }) => { assert.equal(where.providerMessageId, event.providerMessageId); return candidates; },
      update: async (value: typeof updates[number]) => { updates.push(value); } } } as unknown as Prisma.TransactionClient;
  await markReleaseAlertSent(tx, { id: "delivery", leaseToken: "lease", providerMessageId: event.providerMessageId, now: new Date() });
  assert.equal(delivery.status, "DELIVERED"); assert.equal(delivery.deliveredAt, event.occurredAt);
  assert.equal(updates.length, 1); assert.equal(updates[0].where.id, "early-delivered"); assert.equal(updates[0].data.outcome, "PROCESSED");
  assert.equal(updates[0].data.code, "RELEASE_EMAIL_DELIVERED_RECONCILED");
  assert.deepEqual(locks, [`notifications:webhook:message:${event.providerMessageId}`, "release-alert:delivery"]);
});
test("early bounce is terminal and a stale delivery lease cannot attach provider events", async () => {
  const bounced = { ...event, type: "email.bounced", bounceType: "Permanent" } satisfies VerifiedResendWebhookEvent;
  const delivery = { id: "delivery", status: "PROCESSING", leaseToken: "lease", recipient: event.recipient, deploymentEnvironment: "development", deliveredAt: null };
  const auditUpdates: unknown[] = [];
  const tx = { $queryRaw: async () => [], releaseAlertDelivery: { findUniqueOrThrow: async () => delivery,
    updateMany: async ({ data }: { data: object }) => { Object.assign(delivery, data); return { count: 1 }; } },
    notificationEvent: { findMany: async () => [{ id: "early-bounce", providerEventId: "event-bounce", providerEventType: "email.bounced", occurredAt: bounced.occurredAt,
      code: unmatchedResendWebhookEventCode(bounced, bounced.recipient) }], update: async (value: unknown) => { auditUpdates.push(value); } } } as unknown as Prisma.TransactionClient;
  await assert.rejects(markReleaseAlertSent(tx, { id: "delivery", leaseToken: "stale-lease", providerMessageId: event.providerMessageId, now: new Date() }), /LEASE_CHANGED/);
  assert.equal(auditUpdates.length, 0);
  await markReleaseAlertSent(tx, { id: "delivery", leaseToken: "lease", providerMessageId: event.providerMessageId, now: new Date() });
  assert.equal(delivery.status, "BOUNCED"); assert.equal(auditUpdates.length, 1);
});
