import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { notificationChannelAvailability } from "@/lib/notifications/config";
import {
  customerDeliveryNotificationKey,
  dispatchOrderNotification,
  ownerNewOrderNotificationKey,
  type NotificationDispatchRepository,
} from "@/lib/notifications/service";
import { orderNotificationTemplate } from "@/lib/notifications/templates";
import type { OrderNotificationMessage } from "@/lib/notifications/types";

const message: OrderNotificationMessage = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "OWNER_NEW_ORDER",
  channel: "EMAIL",
  recipient: "owner@example.invalid",
  idempotencyKey: "order:00000000-0000-4000-8000-000000000010:owner-new:email",
  order: {
    orderNumber: "LNX-2026-000002",
    customerName: "Client QA",
    customerEmail: "client@example.invalid",
    totalCents: 9_000,
    currency: "EUR",
    coverIncluded: true,
    priorityProcessing: true,
    createdAt: new Date("2026-08-14T10:00:00Z"),
  },
};

function repository() {
  let claimable: OrderNotificationMessage | null = message;
  let sent = 0;
  let failed = 0;
  const value: NotificationDispatchRepository = {
    claim: async () => {
      const claimed = claimable;
      claimable = null;
      return claimed;
    },
    markSent: async () => { sent += 1; },
    markFailed: async () => { failed += 1; },
  };
  return { value, counts: () => ({ sent, failed }) };
}

test("les clés persistantes séparent nouvelle commande et livraison", () => {
  const orderId = "00000000-0000-4000-8000-000000000010";
  assert.equal(ownerNewOrderNotificationKey(orderId), `order:${orderId}:owner-new:email`);
  assert.equal(customerDeliveryNotificationKey(orderId), `order:${orderId}:delivery-ready:email`);
  assert.notEqual(ownerNewOrderNotificationKey(orderId), customerDeliveryNotificationKey(orderId));
});

test("la notification propriétaire est envoyée une seule fois malgré un second dispatch", async () => {
  const repo = repository();
  let emails = 0;
  const dependencies = { repository: repo.value, sendEmail: async () => { emails += 1; } };
  assert.deepEqual(await dispatchOrderNotification(message.id, dependencies), { delivered: true, skipped: false });
  assert.deepEqual(await dispatchOrderNotification(message.id, dependencies), { delivered: false, skipped: true });
  assert.equal(emails, 1);
  assert.deepEqual(repo.counts(), { sent: 1, failed: 0 });
});

test("échec email reste dans l’outbox sans remonter dans le flux paiement/livraison", async () => {
  const repo = repository();
  const result = await dispatchOrderNotification(message.id, {
    repository: repo.value,
    sendEmail: async () => { throw new Error("provider unavailable"); },
  });
  assert.deepEqual(result, { delivered: false, skipped: false });
  assert.deepEqual(repo.counts(), { sent: 0, failed: 1 });
});

test("l’email client annonce la livraison sans joindre ni exposer le master", () => {
  const delivery = orderNotificationTemplate({
    ...message,
    kind: "CUSTOMER_DELIVERY_READY",
    recipient: "client@example.invalid",
  });
  assert.match(delivery.subject, /création LNX Beats est disponible/i);
  assert.match(delivery.text, /\/compte\/commandes\/LNX-2026-000002/);
  assert.match(delivery.text, /jamais joint/i);
  assert.doesNotMatch(`${delivery.text}\n${delivery.html}`, /storageKey|r2\.cloudflarestorage|\.wav|\.mp3/i);
});

test("EMAIL est configurable et SMS reste prêt sans faux fournisseur", () => {
  assert.deepEqual(notificationChannelAvailability({ ORDER_NOTIFICATION_EMAIL_ENABLED: "true" }), {
    email: "ENABLED",
    sms: "READY_FOR_PROVIDER",
  });
  assert.deepEqual(notificationChannelAvailability({ ORDER_NOTIFICATION_EMAIL_ENABLED: "false" }), {
    email: "DISABLED",
    sms: "READY_FOR_PROVIDER",
  });
  assert.throws(() => notificationChannelAvailability({ ORDER_NOTIFICATION_EMAIL_ENABLED: "yes" }));
});

test("webhook et publication créent l’outbox avant un dispatch post-transaction tolérant aux erreurs", async () => {
  const webhook = await readFile("lib/payments/webhook.ts", "utf8");
  const webhookRoute = await readFile("app/api/payments/stripe/webhook/route.ts", "utf8");
  const admin = await readFile("lib/admin/service.ts", "utf8");
  assert.match(webhook, /confirmOrder[\s\S]*enqueueOwnerNewOrderNotification\(transaction, payment\.orderId\)/);
  assert.match(admin, /transition\.to === "DELIVERED"[\s\S]*enqueueCustomerDeliveryNotification\(transaction, order\)/);
  assert.match(webhookRoute, /after\([\s\S]*dispatchPendingOrderNotifications\(\)\.catch\(\(\) => undefined\)/);
});

test("la migration rend l’idempotence persistante et ne réécrit aucune commande", async () => {
  const sql = await readFile("prisma/migrations/20260814190000_order_delivery_notifications/migration.sql", "utf8");
  assert.match(sql, /CREATE UNIQUE INDEX "order_notifications_idempotencyKey_key"/);
  assert.match(sql, /FOREIGN KEY \("orderId"\)[\s\S]*ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+"orders")\b/i);
});
