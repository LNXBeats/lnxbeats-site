import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseNotificationConfiguration } from "@/lib/notifications/config";
import {
  classifyNotificationFailure,
  isFictitiousRecipient,
  manualRetryAllowed,
  notificationBackoffMs,
  notificationDefinition,
  NotificationTransportError,
} from "@/lib/notifications/domain";
import {
  customerDeliveryNotificationKey,
  customerPaymentNotificationKey,
  dispatchOrderNotification,
  ownerNewOrderNotificationKey,
  type NotificationDispatchRepository,
} from "@/lib/notifications/service";
import { orderNotificationTemplate } from "@/lib/notifications/templates";
import { createNotificationTransport } from "@/lib/notifications/transport";
import type { NotificationTransportResult, OrderNotificationMessage } from "@/lib/notifications/types";
import { notificationWorkerAuthorized } from "@/lib/notifications/worker-auth";

const message: OrderNotificationMessage = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "OWNER_NEW_ORDER",
  channel: "EMAIL",
  priority: "CRITICAL",
  recipient: "owner@example.invalid",
  idempotencyKey: "order:00000000-0000-4000-8000-000000000010:owner-new:email",
  templateKey: "owner-new-order",
  templateVersion: 1,
  payloadVersion: 1,
  payload: {
    orderNumber: "LNX-2026-000002",
    customerName: "Client <QA>",
    customerEmail: "client@example.invalid",
    totalCents: 9_000,
    currency: "EUR",
    coverIncluded: true,
    priorityProcessing: true,
    createdAt: "2026-08-14T10:00:00.000Z",
  },
  resourceType: "ORDER",
  resourceId: "00000000-0000-4000-8000-000000000010",
  resourceReference: "LNX-2026-000002",
  deploymentEnvironment: "development",
  order: {
    orderNumber: "LNX-2026-000002",
    customerName: "Client <QA>",
    customerEmail: "client@example.invalid",
    totalCents: 9_000,
    currency: "EUR",
    coverIncluded: true,
    priorityProcessing: true,
    createdAt: new Date("2026-08-14T10:00:00Z"),
  },
};

const captureConfiguration = parseNotificationConfiguration({
  NODE_ENV: "development",
  NOTIFICATION_DEPLOYMENT_ENV: "development",
  NOTIFICATION_EMAIL_TRANSPORT: "capture",
  EMAIL_NOTIFICATIONS_ENABLED: "true",
  OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
  CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
  APP_CANONICAL_URL: "http://localhost:31730",
});

function repository() {
  let claimable: OrderNotificationMessage | null = message;
  let sent = 0;
  let failed = 0;
  const value: NotificationDispatchRepository = {
    claim: async () => { const claimed = claimable; claimable = null; return claimed; },
    markSent: async () => { sent += 1; },
    markFailed: async () => { failed += 1; },
  };
  return { value, counts: () => ({ sent, failed }) };
}

test("les clés persistantes séparent paiement, propriétaire et livraison", () => {
  const id = message.resourceId!;
  assert.notEqual(ownerNewOrderNotificationKey(id), customerPaymentNotificationKey(id));
  assert.notEqual(customerPaymentNotificationKey(id), customerDeliveryNotificationKey(id));
});

test("le mapping métier définit audience, priorité et template", () => {
  assert.deepEqual(notificationDefinition("OWNER_NEW_ORDER"), { audience: "OWNER", priority: "CRITICAL", templateKey: "owner-new-order" });
  assert.equal(notificationDefinition("CUSTOMER_DELIVERY_READY").priority, "CRITICAL");
  assert.equal(notificationDefinition("CUSTOMER_RIGHTS_CONTRACT_READY").audience, "CLIENT");
});

test("un second dispatch de la même ligne ne renvoie rien", async () => {
  const repo = repository();
  let sends = 0;
  const accepted: NotificationTransportResult = { provider: "CAPTURE", providerMessageId: "capture_qa", deliveredImmediately: true };
  const dependencies = { repository: repo.value, sendEmail: async () => { sends += 1; return accepted; } };
  assert.deepEqual(await dispatchOrderNotification(message.id, dependencies), { delivered: true, skipped: false });
  assert.deepEqual(await dispatchOrderNotification(message.id, dependencies), { delivered: false, skipped: true });
  assert.equal(sends, 1);
  assert.deepEqual(repo.counts(), { sent: 1, failed: 0 });
});

test("une panne fournisseur reste isolée de la commande", async () => {
  const repo = repository();
  assert.deepEqual(await dispatchOrderNotification(message.id, {
    repository: repo.value,
    sendEmail: async () => { throw Object.assign(new Error("temporary"), { statusCode: 503 }); },
  }), { delivered: false, skipped: false });
  assert.deepEqual(repo.counts(), { sent: 0, failed: 1 });
  assert.equal(classifyNotificationFailure(Object.assign(new Error(), { statusCode: 429 })).retryable, true);
  assert.equal(classifyNotificationFailure(Object.assign(new Error(), { statusCode: 422, name: "validation_error" })).retryable, false);
});

test("la livraison reste en outbox sans appel provider lorsque les e-mails client sont désactivés", async () => {
  const disabled = parseNotificationConfiguration({
    NODE_ENV: "development",
    NOTIFICATION_DEPLOYMENT_ENV: "development",
    NOTIFICATION_EMAIL_TRANSPORT: "capture",
    EMAIL_NOTIFICATIONS_ENABLED: "true",
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
    CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
    APP_CANONICAL_URL: "http://localhost:31730",
  });
  const deliveryMessage: OrderNotificationMessage = {
    ...message,
    kind: "CUSTOMER_DELIVERY_READY",
    recipient: "client@example.invalid",
    idempotencyKey: customerDeliveryNotificationKey(message.resourceId!),
    templateKey: "customer-delivery-ready",
  };
  await assert.rejects(
    () => createNotificationTransport(disabled).send(deliveryMessage, orderNotificationTemplate(deliveryMessage, disabled)),
    (error: unknown) => error instanceof NotificationTransportError && error.failure.code === "CLIENT_EMAIL_DISABLED",
  );
});

test("les templates ont HTML, texte, deep link et garde DRAFT", () => {
  const owner = orderNotificationTemplate(message, captureConfiguration);
  assert.match(owner.subject, /^\[TEST\]/);
  assert.match(owner.text, /\/admin\/commandes\/LNX-2026-000002/);
  assert.match(owner.html, /Client &lt;QA&gt;/);
  assert.doesNotMatch(owner.text, /<[^>]+>/);
  const rights = orderNotificationTemplate({
    ...message,
    kind: "CUSTOMER_RIGHTS_CONTRACT_READY",
    recipient: "client@example.invalid",
    payload: { ...message.payload, rightsRequestNumber: "LNX-LIC-2026-000001", rightsRequestType: "PUBLICATION_LICENSE", requestedPriceCents: 15_000 },
  }, captureConfiguration);
  assert.match(rights.text, /DRAFT|Aucun droit/i);
  assert.match(rights.text, /\/compte\/droits\/LNX-LIC-2026-000001/);
});

test("capture écrit une enveloppe privée et déterministe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lnx-v073-capture-"));
  try {
    const configuration = { ...captureConfiguration, capturePath: join(directory, "mailbox.jsonl") };
    const template = orderNotificationTemplate(message, configuration);
    const first = await createNotificationTransport(configuration).send(message, template);
    const second = await createNotificationTransport(configuration).send(message, template);
    assert.equal(first.providerMessageId, second.providerMessageId);
    assert.equal(first.deliveredImmediately, true);
    const lines = (await readFile(configuration.capturePath, "utf8")).trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]!).idempotencyKey, message.idempotencyKey);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Resend refuse les fixtures locales avant tout appel réseau", async () => {
  const resend = parseNotificationConfiguration({
    NODE_ENV: "development", NOTIFICATION_DEPLOYMENT_ENV: "staging", NOTIFICATION_EMAIL_TRANSPORT: "resend",
    NOTIFICATION_STAGING_CONFIRM: "resend-staging-approved", EMAIL_NOTIFICATIONS_ENABLED: "true",
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true", CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
    RESEND_API_KEY: "re_" + "fixture".repeat(6), RESEND_WEBHOOK_SECRET: "whsec_" + "fixture".repeat(6),
    EMAIL_FROM: "LNX Beats <notifications@mail.example.com>", EMAIL_REPLY_TO: "reply@example.com",
    EMAIL_OWNER_RECIPIENT: "owner@example.com", APP_CANONICAL_URL: "https://staging.example.com",
  });
  await assert.rejects(() => createNotificationTransport(resend).send(message, orderNotificationTemplate(message, resend)), /test locale/i);
  assert.equal(isFictitiousRecipient("member@example.invalid"), true);
});

test("configuration et contrôles du worker échouent fermés", () => {
  assert.equal(parseNotificationConfiguration({ NODE_ENV: "development" }).emailTransport, "capture");
  assert.equal(parseNotificationConfiguration({ NODE_ENV: "production" }).emailTransport, "disabled");
  assert.throws(() => parseNotificationConfiguration({ NODE_ENV: "production", NOTIFICATION_EMAIL_TRANSPORT: "resend" }));
  assert.equal(notificationWorkerAuthorized("Bearer " + "a".repeat(32), "a".repeat(32)), true);
  assert.equal(notificationWorkerAuthorized("Bearer wrong", "a".repeat(32)), false);
});

test("backoff et retry Admin restent bornés", () => {
  assert.equal(notificationBackoffMs(1), 5 * 60_000);
  assert.equal(notificationBackoffMs(99), 24 * 60 * 60_000);
  assert.equal(manualRetryAllowed({ status: "FAILED_FINAL", suppressionActive: false }), true);
  assert.equal(manualRetryAllowed({ status: "FAILED_FINAL", suppressionActive: false, attempts: 5 }), false);
  assert.equal(manualRetryAllowed({ status: "FAILED_FINAL", suppressionActive: true }), false);
  assert.equal(manualRetryAllowed({ status: "DELIVERED", suppressionActive: false }), false);
});
