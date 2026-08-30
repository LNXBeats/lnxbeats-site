import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseNotificationConfiguration } from "@/lib/notifications/config";
import {
  automaticNotificationRetryIsSafe,
  classifyNotificationFailure,
  isFictitiousRecipient,
  isShopNotificationKind,
  manualRetryAllowed,
  notificationBackoffMs,
  notificationDefinition,
  NOTIFICATION_PROVIDER_IDEMPOTENCY_SAFE_AGE_MS,
  NotificationTransportError,
  parseNotificationPayload,
} from "@/lib/notifications/domain";
import {
  clientNotificationEnqueueEnabled,
  customerDeliveryNotificationKey,
  customerPaymentNotificationKey,
  customerShopPaymentConfirmedNotificationKey,
  customerShopPreparingNotificationKey,
  customerShopShippedNotificationKey,
  dispatchOrderNotification,
  enqueueShopPreparingNotification,
  enqueueShopOrderNotification,
  enqueueShopShippedNotification,
  ownerNewOrderNotificationKey,
  ownerShopOrderPaidNotificationKey,
  type NotificationDispatchRepository,
} from "@/lib/notifications/service";
import { orderNotificationTemplate } from "@/lib/notifications/templates";
import { createNotificationTransport } from "@/lib/notifications/transport";
import type { NotificationTransportResult, OrderNotificationMessage, ShopNotificationPayload } from "@/lib/notifications/types";
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
    workTitle: "Élégie <d’été>",
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

const shopMessage: OrderNotificationMessage = {
  id: "00000000-0000-4000-8000-000000000101",
  kind: "CUSTOMER_SHOP_PAYMENT_CONFIRMED",
  channel: "EMAIL",
  priority: "CRITICAL",
  recipient: "shop-client@example.invalid",
  idempotencyKey: "shop-order:00000000-0000-4000-8000-000000000110:payment-confirmed:email",
  templateKey: "customer-shop-payment-confirmed",
  templateVersion: 1,
  payloadVersion: 1,
  payload: {
    orderNumber: "LNX-SHOP-2026-000001",
    customerName: "Client <Boutique>",
    customerEmail: "shop-client@example.invalid",
    subtotalCents: 2_800,
    shippingCents: 200,
    totalCents: 3_000,
    currency: "EUR",
    createdAt: "2026-08-27T10:00:00.000Z",
    items: [
      { productTitle: "Vinyle <édition>", quantity: 2, unitPriceCents: 1_000, lineTotalCents: 2_000 },
      { productTitle: "Carte", quantity: 1, unitPriceCents: 800, lineTotalCents: 800 },
    ],
    paymentProvider: "STRIPE",
    termsVersion: "shop-cgv-2026-08-v1",
    shippingAddress: {
      recipientName: "Client Boutique",
      addressLine1: "1 rue du Test <privé>",
      addressLine2: null,
      postalCode: "75001",
      city: "Paris",
      countryCode: "FR",
    },
  },
  resourceType: "SHOP_ORDER",
  resourceId: "00000000-0000-4000-8000-000000000110",
  resourceReference: "LNX-SHOP-2026-000001",
  deploymentEnvironment: "development",
  order: null,
  shopOrder: {
    orderNumber: "LNX-SHOP-2026-000001",
    customerName: "Client <Boutique>",
    customerEmail: "shop-client@example.invalid",
    totalCents: 3_000,
    currency: "EUR",
    createdAt: new Date("2026-08-27T10:00:00.000Z"),
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

test("les clés Boutique sont stables et séparent chaque événement logique", () => {
  const id = shopMessage.resourceId!;
  const keys = [
    ownerShopOrderPaidNotificationKey(id),
    customerShopPaymentConfirmedNotificationKey(id),
    customerShopPreparingNotificationKey(id),
    customerShopShippedNotificationKey(id),
  ];
  assert.equal(new Set(keys).size, 4);
  assert.equal(keys[0], `shop-order:${id}:owner-paid:email`);
  assert.equal(customerShopShippedNotificationKey(id), customerShopShippedNotificationKey(id));
});

test("la création de l’outbox client échoue fermée hors développement", () => {
  assert.equal(clientNotificationEnqueueEnabled({ NODE_ENV: "production", NOTIFICATION_DEPLOYMENT_ENV: "production" }), false);
  assert.equal(clientNotificationEnqueueEnabled({ NODE_ENV: "production", NOTIFICATION_DEPLOYMENT_ENV: "staging" }), false);
  assert.equal(clientNotificationEnqueueEnabled({ NODE_ENV: "test", NOTIFICATION_DEPLOYMENT_ENV: "development" }), true);
  assert.equal(clientNotificationEnqueueEnabled({ NODE_ENV: "production", CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true" }), true);
  assert.equal(clientNotificationEnqueueEnabled({ NODE_ENV: "test", CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false" }), false);
  assert.equal(clientNotificationEnqueueEnabled({ NODE_ENV: "production", CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "invalid" }), false);
});

test("le mapping métier définit audience, priorité et template", () => {
  assert.deepEqual(notificationDefinition("OWNER_NEW_ORDER"), { audience: "OWNER", priority: "CRITICAL", templateKey: "owner-new-order" });
  assert.equal(notificationDefinition("CUSTOMER_DELIVERY_READY").priority, "CRITICAL");
  assert.equal(notificationDefinition("CUSTOMER_RIGHTS_CONTRACT_READY").audience, "CLIENT");
  assert.deepEqual(notificationDefinition("OWNER_SHOP_ORDER_PAID"), { audience: "OWNER", priority: "CRITICAL", templateKey: "owner-shop-order-paid" });
  assert.deepEqual(notificationDefinition("CUSTOMER_SHOP_PREPARING"), { audience: "CLIENT", priority: "INFORMATIONAL", templateKey: "customer-shop-preparing" });
  assert.equal(isShopNotificationKind("CUSTOMER_SHOP_SHIPPED"), true);
  assert.equal(isShopNotificationKind("OWNER_NEW_ORDER"), false);
});

test("le payload Boutique est fermé, cohérent et conserve les snapshots financiers", () => {
  const payload = shopMessage.payload as ShopNotificationPayload;
  assert.deepEqual(parseNotificationPayload(payload, shopMessage.kind), payload);
  assert.throws(() => parseNotificationPayload({ ...payload, unexpected: true }, shopMessage.kind), /unknown field/i);
  assert.throws(() => parseNotificationPayload({ ...payload, totalCents: 3_001 }, shopMessage.kind), /invalid/i);
  assert.throws(() => parseNotificationPayload({
    ...payload,
    items: [{ productTitle: "Produit", quantity: 2, unitPriceCents: 1_000, lineTotalCents: 1_000 }],
    subtotalCents: 1_000,
    shippingCents: 0,
    totalCents: 1_000,
  }, shopMessage.kind), /invalid/i);
  assert.throws(() => parseNotificationPayload({
    ...payload,
    shippingAddress: { ...payload.shippingAddress!, countryCode: "France" },
  }, shopMessage.kind), /invalid/i);
});

test("l’enqueue Boutique utilise le parent Shop, le snapshot et la clé persistante", async () => {
  let observed: Record<string, unknown> | null = null;
  const shopOrderId = shopMessage.resourceId!;
  const transaction = {
    shopOrder: {
      findUniqueOrThrow: async () => ({
        id: shopOrderId,
        userId: "00000000-0000-4000-8000-000000000222",
        orderNumber: "LNX-SHOP-2026-000001",
        subtotalCents: 2_800,
        shippingCents: 200,
        totalCents: 3_000,
        currency: "EUR",
        shippingRequired: true,
        shippingFirstName: "Client",
        shippingLastName: "Boutique",
        shippingAddressLine1: "1 rue du Test",
        shippingAddressLine2: null,
        shippingPostalCode: "75001",
        shippingCity: "Paris",
        shippingCountryCode: "FR",
        termsVersion: "shop-cgv-2026-08-v1",
        createdAt: new Date("2026-08-27T10:00:00.000Z"),
      }),
    },
    user: {
      findUniqueOrThrow: async () => ({
          email: "shop-client@example.invalid",
          emailVerified: true,
          displayName: "Client Boutique",
          firstName: "Client",
          lastName: "Boutique",
      }),
    },
    shopOrderItem: {
      findMany: async () => [
          { productTitle: "Vinyle", quantity: 2, unitPriceCents: 1_000, lineTotalCents: 2_000 },
          { productTitle: "Carte", quantity: 1, unitPriceCents: 800, lineTotalCents: 800 },
      ],
    },
    payment: { findMany: async () => [{ provider: "STRIPE" }] },
    invoice: { findMany: async () => [] },
    orderNotification: {
      upsert: async (input: { create: Record<string, unknown> }) => {
        observed = input.create;
        return {
          id: "00000000-0000-4000-8000-000000000111",
          orderId: null,
          shopOrderId,
          kind: "CUSTOMER_SHOP_PAYMENT_CONFIRMED",
          channel: "EMAIL",
          resourceType: "SHOP_ORDER",
          resourceId: shopOrderId,
        };
      },
    },
  };
  await enqueueShopOrderNotification(transaction as never, {
    shopOrderId,
    kind: "CUSTOMER_SHOP_PAYMENT_CONFIRMED",
    recipient: "shop-client@example.invalid",
    idempotencyKey: customerShopPaymentConfirmedNotificationKey(shopOrderId),
    paymentProvider: "STRIPE",
    termsVersion: "shop-cgv-2026-08-v1",
  });
  assert.notEqual(observed, null);
  const created = observed as unknown as Record<string, unknown>;
  assert.equal(created.orderId, null);
  assert.equal(created.shopOrderId, shopOrderId);
  assert.equal(created.resourceType, "SHOP_ORDER");
  assert.equal(created.resourceId, shopOrderId);
  assert.equal(created.idempotencyKey, customerShopPaymentConfirmedNotificationKey(shopOrderId));
  assert.equal((created.payload as Record<string, unknown>).customerEmail, "shop-client@example.invalid");
  assert.equal(Array.isArray((created.payload as Record<string, unknown>).items), true);
});

test("les notifications fulfillment Boutique respectent le flag client avant toute écriture", async () => {
  const previous = process.env.CLIENT_EMAIL_NOTIFICATIONS_ENABLED;
  let reads = 0;
  let writes = 0;
  const payloads: Array<Record<string, unknown>> = [];
  const shopOrderId = shopMessage.resourceId!;
  const transaction = {
    shopOrder: {
      findUniqueOrThrow: async () => {
        reads += 1;
        return {
          id: shopOrderId,
          userId: "00000000-0000-4000-8000-000000000222",
          orderNumber: "LNX-SHOP-2026-000001",
          subtotalCents: 2_800,
          shippingCents: 200,
          totalCents: 3_000,
          currency: "EUR",
          shippingRequired: true,
          shippingFirstName: "Client",
          shippingLastName: "Boutique",
          shippingAddressLine1: "1 rue du Test",
          shippingAddressLine2: null,
          shippingPostalCode: "75001",
          shippingCity: "Paris",
          shippingCountryCode: "FR",
          termsVersion: "shop-cgv-2026-08-v1",
          createdAt: new Date("2026-08-27T10:00:00.000Z"),
        };
      },
    },
    user: {
      findUniqueOrThrow: async () => ({
            email: "shop-client@example.invalid",
            emailVerified: true,
            displayName: "Client Boutique",
            firstName: "Client",
            lastName: "Boutique",
      }),
    },
    shopOrderItem: {
      findMany: async () => [
        { productTitle: "Vinyle", quantity: 1, unitPriceCents: 2_800, lineTotalCents: 2_800 },
      ],
    },
    payment: { findMany: async () => [{ provider: "STRIPE" }] },
    invoice: { findMany: async () => [] },
    orderNotification: {
      upsert: async (input: { create: Record<string, unknown> }) => {
        writes += 1;
        payloads.push(input.create.payload as Record<string, unknown>);
        return {
          id: `00000000-0000-4000-8000-00000000011${writes}`,
          orderId: null,
          shopOrderId,
          kind: input.create.kind,
          channel: input.create.channel,
          resourceType: input.create.resourceType,
          resourceId: input.create.resourceId,
        };
      },
    },
  };
  try {
    process.env.CLIENT_EMAIL_NOTIFICATIONS_ENABLED = "false";
    assert.equal(await enqueueShopPreparingNotification(transaction as never, shopOrderId), null);
    assert.equal(await enqueueShopShippedNotification(transaction as never, shopOrderId), null);
    assert.deepEqual({ reads, writes }, { reads: 0, writes: 0 });

    process.env.CLIENT_EMAIL_NOTIFICATIONS_ENABLED = "true";
    await enqueueShopPreparingNotification(transaction as never, shopOrderId);
    await enqueueShopShippedNotification(transaction as never, shopOrderId);
    assert.deepEqual({ reads, writes }, { reads: 2, writes: 2 });
    assert.ok(payloads.every((payload) => payload.shippingAddress === null));
  } finally {
    if (previous === undefined) delete process.env.CLIENT_EMAIL_NOTIFICATIONS_ENABLED;
    else process.env.CLIENT_EMAIL_NOTIFICATIONS_ENABLED = previous;
  }
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

test("une acceptation fournisseur suivie d’un échec DB reste ambiguë sans retry technique immédiat", async () => {
  let claimable: OrderNotificationMessage | null = message;
  let sends = 0;
  let failed = 0;
  const persistenceError = new Error("simulated database persistence failure");
  const repository: NotificationDispatchRepository = {
    claim: async () => {
      const claimed = claimable;
      claimable = null;
      return claimed;
    },
    markSent: async () => { throw persistenceError; },
    markFailed: async () => { failed += 1; },
  };
  await assert.rejects(
    dispatchOrderNotification(message.id, {
      repository,
      sendEmail: async () => {
        sends += 1;
        return { provider: "RESEND", providerMessageId: "email_accepted_before_db_failure", deliveredImmediately: false };
      },
    }),
    persistenceError,
  );
  assert.equal(sends, 1);
  assert.equal(failed, 0, "A post-acceptance DB failure must not be reclassified as a provider retry.");
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
  assert.match(owner.text, /Commande : LNX-2026-000002/);
  assert.match(owner.text, /Montant : 90,00\s?€/u);
  assert.match(owner.text, /Projet : Élégie ‹d’été›/u);
  assert.match(owner.html, /Projet : Élégie &lt;d’été&gt;/u);
  assert.match(owner.html, /Client &lt;QA&gt;/);
  assert.doesNotMatch(owner.text, /<[^>]+>/);
  assert.doesNotMatch(`${owner.text}\n${owner.html}`, /providerMessageId|whsec_|sk_live_|utm_(source|medium|campaign)|tracking pixel/i);
  const ownerLink = owner.html.match(/href="([^"]+)"/)?.[1];
  assert.equal(ownerLink, "http://localhost:31730/admin/commandes/LNX-2026-000002");
  assert.equal(new URL(ownerLink!).search, "");
  const rights = orderNotificationTemplate({
    ...message,
    kind: "CUSTOMER_RIGHTS_CONTRACT_READY",
    recipient: "client@example.invalid",
    templateKey: "customer-rights-contract-ready",
    payload: { ...message.payload, rightsRequestNumber: "LNX-LIC-2026-000001", rightsRequestType: "PUBLICATION_LICENSE", requestedPriceCents: 15_000 },
  }, captureConfiguration);
  assert.match(rights.text, /DRAFT|Aucun droit/i);
  assert.match(rights.text, /\/compte\/droits\/LNX-LIC-2026-000001/);
});

test("les templates Boutique sont humains, minimisés et liés à la bonne ressource", () => {
  const customer = orderNotificationTemplate(shopMessage, captureConfiguration);
  assert.match(customer.subject, /^\[TEST\] Commande Boutique confirmée/);
  assert.match(customer.text, /\/compte\/achats\/LNX-SHOP-2026-000001/);
  assert.match(customer.text, /2 × Vinyle ‹édition› — 20,00\s?€/u);
  assert.match(customer.text, /Frais de livraison : 2,00\s?€/u);
  assert.match(customer.text, /Total : 30,00\s?€/u);
  assert.match(customer.text, /Carte bancaire via Stripe/);
  assert.match(customer.text, /shop-cgv-2026-08-v1/);
  assert.match(customer.text, /\/documents-juridiques\/shop-cgv-2026-08-v1/);
  assert.match(customer.text, /\/retractation/);
  assert.match(customer.text, /CM2C/);
  assert.match(customer.html, /Vinyle &lt;édition&gt;/);
  assert.match(customer.html, /1 rue du Test &lt;privé&gt;/);
  assert.doesNotMatch(`${customer.text}\n${customer.html}`, /sk_live_|providerPaymentId|DATABASE_URL|tracking pixel/i);

  const payload = shopMessage.payload as ShopNotificationPayload;
  const ownerMessage: OrderNotificationMessage = {
    ...shopMessage,
    kind: "OWNER_SHOP_ORDER_PAID",
    recipient: "owner@example.invalid",
    idempotencyKey: ownerShopOrderPaidNotificationKey(shopMessage.resourceId!),
    templateKey: "owner-shop-order-paid",
    payload: { ...payload, shippingAddress: null },
  };
  const owner = orderNotificationTemplate(ownerMessage, captureConfiguration);
  assert.match(owner.text, /\/admin\/boutique\/commandes\/LNX-SHOP-2026-000001/);
  assert.match(owner.text, /Client : Client ‹Boutique›/);
  assert.doesNotMatch(owner.text, /1 rue du Test|shop-client@example.invalid/);
});

test("le transport Resend vérifie le destinataire client contre le parent Shop autoritatif", async () => {
  const resend = parseNotificationConfiguration({
    NODE_ENV: "development", NOTIFICATION_DEPLOYMENT_ENV: "staging", NOTIFICATION_EMAIL_TRANSPORT: "resend",
    NOTIFICATION_STAGING_CONFIRM: "resend-staging-approved", EMAIL_NOTIFICATIONS_ENABLED: "true",
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true", CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
    RESEND_API_KEY: "re_" + "fixture".repeat(6), RESEND_WEBHOOK_SECRET: "whsec_" + "fixture".repeat(6),
    EMAIL_FROM: "LNX Beats <notifications@mail.example.com>", EMAIL_REPLY_TO: "reply@example.com",
    EMAIL_OWNER_RECIPIENT: "owner@example.com", APP_CANONICAL_URL: "https://staging.example.com",
  });
  const mismatched: OrderNotificationMessage = {
    ...shopMessage,
    deploymentEnvironment: "staging",
    recipient: "delivered@resend.dev",
    payload: { ...(shopMessage.payload as ShopNotificationPayload), customerEmail: "delivered@resend.dev" },
    shopOrder: { ...shopMessage.shopOrder!, customerEmail: "different@example.com" },
  };
  await assert.rejects(
    () => createNotificationTransport(resend, { resendSender: async () => ({ data: { id: "must-not-send" }, error: null, headers: null }) }).send(
      mismatched,
      orderNotificationTemplate(mismatched, resend),
    ),
    (error: unknown) => error instanceof NotificationTransportError && error.failure.code === "CLIENT_DESTINATION_MISMATCH",
  );
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
  const stagingMessage = { ...message, deploymentEnvironment: "staging" as const };
  await assert.rejects(() => createNotificationTransport(resend).send(stagingMessage, orderNotificationTemplate(stagingMessage, resend)), /test locale/i);
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
  assert.equal(notificationBackoffMs(99), 6 * 60 * 60_000);
  assert.equal(manualRetryAllowed({ status: "FAILED_RETRYABLE", suppressionActive: false }), true);
  assert.equal(manualRetryAllowed({ status: "FAILED_FINAL", suppressionActive: false }), false);
  assert.equal(manualRetryAllowed({ status: "FAILED_FINAL", suppressionActive: false, attempts: 5 }), false);
  assert.equal(manualRetryAllowed({ status: "FAILED_FINAL", suppressionActive: true }), false);
  assert.equal(manualRetryAllowed({ status: "DELIVERED", suppressionActive: false }), false);
  const now = new Date("2026-08-25T12:00:00.000Z");
  assert.equal(automaticNotificationRetryIsSafe(
    new Date(now.getTime() - NOTIFICATION_PROVIDER_IDEMPOTENCY_SAFE_AGE_MS + 1),
    now,
  ), true);
  assert.equal(automaticNotificationRetryIsSafe(
    new Date(now.getTime() - NOTIFICATION_PROVIDER_IDEMPOTENCY_SAFE_AGE_MS),
    now,
  ), false);
  assert.equal(automaticNotificationRetryIsSafe(null, now), false);
});
