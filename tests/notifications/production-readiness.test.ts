import assert from "node:assert/strict";
import test from "node:test";

import { sendResendEmail } from "@/lib/email/resend-adapter";
import {
  NOTIFICATION_PRODUCTION_CONFIRMATION,
  notificationHealthSummary,
  parseNotificationConfiguration,
} from "@/lib/notifications/config";
import {
  classifyNotificationFailure,
  manualRetryAllowed,
  notificationDefinition,
} from "@/lib/notifications/domain";
import {
  evaluateProductionNotificationDatabase,
  evaluateProductionNotificationEnvironment,
  evaluateProductionOwnerNotificationDatabase,
} from "@/lib/notifications/production-preflight";
import { globalNotificationDispatchWhere } from "@/lib/notifications/service";
import { orderNotificationTemplate } from "@/lib/notifications/templates";
import { createNotificationTransport } from "@/lib/notifications/transport";
import type { OrderNotificationKind, OrderNotificationMessage } from "@/lib/notifications/types";

const productionEnvironment = {
  NODE_ENV: "production",
  RAILWAY_ENVIRONMENT_NAME: "production",
  NOTIFICATION_DEPLOYMENT_ENV: "production",
  NOTIFICATION_EMAIL_TRANSPORT: "resend",
  EMAIL_NOTIFICATIONS_ENABLED: "true",
  OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
  CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
  NOTIFICATION_WORKER_ENABLED: "true",
  NOTIFICATION_SCHEDULER_MODE: "railway-cron",
  SMS_TRANSPORT: "disabled",
  SMS_NOTIFICATIONS_ENABLED: "false",
  NOTIFICATION_PRODUCTION_CONFIRM: NOTIFICATION_PRODUCTION_CONFIRMATION,
  RESEND_API_KEY: `re_${"a".repeat(32)}`,
  RESEND_WEBHOOK_SECRET: `whsec_${"b".repeat(32)}`,
  NOTIFICATION_WORKER_SECRET: "c".repeat(32),
  EMAIL_FROM: "LNX Beats <notifications@mail.lnxbeats.fr>",
  EMAIL_REPLY_TO: "contact@lnxbeats.fr",
  EMAIL_OWNER_RECIPIENT: "owner@lnxbeats.fr",
  APP_CANONICAL_URL: "https://lnxbeats.fr",
  AUTH_URL: "https://lnxbeats.fr",
  EMAIL_PROVIDER: "resend",
} satisfies Record<string, string>;

const baseMessage: OrderNotificationMessage = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "OWNER_NEW_ORDER",
  channel: "EMAIL",
  priority: "CRITICAL",
  recipient: "owner@lnxbeats.fr",
  idempotencyKey: "order:00000000-0000-4000-8000-000000000010:owner-new:email",
  templateKey: "owner-new-order",
  templateVersion: 1,
  payloadVersion: 1,
  payload: {
    orderNumber: "LNX-2026-000002",
    customerName: "Client QA",
    customerEmail: "client@example.com",
    totalCents: 9_000,
    currency: "EUR",
    coverIncluded: true,
    priorityProcessing: false,
    createdAt: "2026-08-14T10:00:00.000Z",
    rightsRequestNumber: "LNX-LIC-2026-000001",
    rightsRequestType: "PUBLICATION_LICENSE",
    requestedPriceCents: 15_000,
    refundAmountCents: 1_000,
  },
  resourceType: "ORDER",
  resourceId: "00000000-0000-4000-8000-000000000010",
  resourceReference: "LNX-2026-000002",
  deploymentEnvironment: "production",
  order: {
    orderNumber: "LNX-2026-000002",
    customerName: "Client QA",
    customerEmail: "client@example.com",
    totalCents: 9_000,
    currency: "EUR",
    coverIncluded: true,
    priorityProcessing: false,
    createdAt: new Date("2026-08-14T10:00:00Z"),
  },
};

test("la configuration production exige un armement complet et cohérent", () => {
  const configuration = parseNotificationConfiguration(productionEnvironment);
  assert.equal(configuration.deploymentEnvironment, "production");
  assert.equal(configuration.emailTransport, "resend");
  assert.equal(configuration.workerEnabled, true);
  assert.equal(configuration.webhookConfigured, true);

  const requiredMutations: Array<[string, string | undefined]> = [
    ["NOTIFICATION_SCHEDULER_MODE", undefined],
    ["NOTIFICATION_PRODUCTION_CONFIRM", undefined],
    ["EMAIL_NOTIFICATIONS_ENABLED", "false"],
    ["NOTIFICATION_WORKER_SECRET", "short"],
    ["APP_CANONICAL_URL", "https://example.com"],
    ["EMAIL_FROM", "LNX Beats <notifications@example.com>"],
    ["EMAIL_FROM", "Other Studio <notifications@mail.lnxbeats.fr>"],
    ["EMAIL_REPLY_TO", "support@example.com"],
    ["RAILWAY_ENVIRONMENT_NAME", "staging"],
  ];
  for (const [name, value] of requiredMutations) {
    if (name === "NOTIFICATION_SCHEDULER_MODE") {
      const rules = evaluateProductionNotificationEnvironment({ ...productionEnvironment, [name]: value });
      assert.equal(rules.find((rule) => rule.name === "scheduler.mode.railwayCron")?.passed, false, name);
    } else {
      assert.throws(() => parseNotificationConfiguration({ ...productionEnvironment, [name]: value }), name);
    }
  }
  assert.throws(() => parseNotificationConfiguration({
    ...productionEnvironment,
    NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST: "delivered@resend.dev",
  }));
  assert.throws(() => parseNotificationConfiguration({ ...productionEnvironment, RESEND_BASE_URL: "https://example.com" }));
});

test("le rollback production conserve une configuration Resend saine mais inactive", () => {
  const rollbackEnvironment = {
    ...productionEnvironment,
    EMAIL_NOTIFICATIONS_ENABLED: "false",
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "false",
    CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
    NOTIFICATION_WORKER_ENABLED: "false",
  };
  const configuration = parseNotificationConfiguration(rollbackEnvironment);
  assert.equal(configuration.emailTransport, "resend");
  assert.equal(configuration.emailConfigured, true);
  assert.equal(configuration.webhookConfigured, true);
  assert.equal(configuration.emailEnabled, false);
  assert.equal(configuration.ownerEmailEnabled, false);
  assert.equal(configuration.clientEmailEnabled, false);
  assert.equal(configuration.workerEnabled, false);

  const preflight = evaluateProductionNotificationEnvironment(rollbackEnvironment);
  assert.equal(preflight.find((rule) => rule.name === "configuration.valid")?.passed, true);
  assert.equal(preflight.find((rule) => rule.name === "email.global.enabled")?.passed, false);
  assert.equal(preflight.find((rule) => rule.name === "email.owner.enabled")?.passed, false);
  assert.equal(preflight.find((rule) => rule.name === "email.client.enabled")?.passed, false);
  assert.equal(preflight.find((rule) => rule.name === "worker.enabled")?.passed, false);
  assert.equal(preflight.every((rule) => rule.passed), false);
});

test("le résumé health n'expose ni destination ni secret", () => {
  const summary = notificationHealthSummary(parseNotificationConfiguration(productionEnvironment));
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /owner@|notifications@|support@|re_|whsec_|wwww/i);
  assert.deepEqual(summary, {
    emailTransport: "resend",
    emailEnabled: true,
    ownerEmailEnabled: true,
    clientEmailEnabled: true,
    emailConfigured: true,
    smsTransport: "disabled",
    workerEnabled: true,
    workerConfigured: true,
    webhookConfigured: true,
  });
});

test("le préflight production rend toutes les règles d'environnement explicites", () => {
  const passing = evaluateProductionNotificationEnvironment(productionEnvironment);
  assert.equal(passing.length > 20, true);
  assert.deepEqual(passing.filter((rule) => !rule.passed), []);

  const blocked = evaluateProductionNotificationEnvironment({
    ...productionEnvironment,
    CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
    NOTIFICATION_STAGING_CONFIRM: "resend-staging-approved",
  });
  assert.equal(blocked.find((rule) => rule.name === "email.client.enabled")?.passed, false);
  assert.equal(blocked.find((rule) => rule.name === "staging.controls.absent")?.passed, false);
  assert.equal(blocked.find((rule) => rule.name === "configuration.valid")?.passed, false);
});

test("le préflight owner-only exige owner actif et client explicitement fermé", () => {
  const ownerOnlyEnvironment = {
    ...productionEnvironment,
    CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
  };
  const passing = evaluateProductionNotificationEnvironment(ownerOnlyEnvironment, "owner-only");
  assert.deepEqual(passing.filter((rule) => !rule.passed), []);
  assert.equal(passing.find((rule) => rule.name === "email.owner.enabled")?.passed, true);
  assert.equal(passing.find((rule) => rule.name === "email.client.disabled")?.passed, true);

  const clientOpened = evaluateProductionNotificationEnvironment(productionEnvironment, "owner-only");
  assert.equal(clientOpened.find((rule) => rule.name === "email.client.disabled")?.passed, false);
  const clientAbsent = evaluateProductionNotificationEnvironment(Object.fromEntries(
    Object.entries(ownerOnlyEnvironment).filter(([name]) => name !== "CLIENT_EMAIL_NOTIFICATIONS_ENABLED"),
  ), "owner-only");
  assert.equal(clientAbsent.find((rule) => rule.name === "email.client.disabled")?.passed, false);
  const ownerClosed = evaluateProductionNotificationEnvironment({
    ...ownerOnlyEnvironment,
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "false",
  }, "owner-only");
  assert.equal(ownerClosed.find((rule) => rule.name === "email.owner.enabled")?.passed, false);
  const wrongReplyTo = evaluateProductionNotificationEnvironment({
    ...ownerOnlyEnvironment,
    EMAIL_REPLY_TO: "support@lnxbeats.fr",
  }, "owner-only");
  assert.equal(wrongReplyTo.find((rule) => rule.name === "replyTo.owner.expected")?.passed, false);
});

test("le préflight base reste strictement en lecture et valide le schéma courant", async () => {
  const database = {
    $queryRaw: async () => [{ tables_ready: true, indexes_ready: true, migrations: 18n, latest_ready: true }],
    orderNotification: { count: async () => 0 },
    notificationEvent: { count: async () => 0 },
    notificationSuppression: { count: async () => 0 },
  } as unknown as Parameters<typeof evaluateProductionNotificationDatabase>[0];
  const passing = await evaluateProductionNotificationDatabase(database, "owner@lnxbeats.fr");
  assert.deepEqual(passing.filter((rule) => !rule.passed), []);

  const outdatedDatabase = {
    ...database,
    $queryRaw: async () => [{ tables_ready: true, indexes_ready: true, migrations: 16n, latest_ready: false }],
  } as unknown as Parameters<typeof evaluateProductionNotificationDatabase>[0];
  const blocked = await evaluateProductionNotificationDatabase(outdatedDatabase, "owner@lnxbeats.fr");
  assert.equal(blocked.find((rule) => rule.name === "database.migrations")?.passed, false);

  const ownerPassing = await evaluateProductionOwnerNotificationDatabase(database, "owner@lnxbeats.fr");
  assert.deepEqual(ownerPassing.filter((rule) => !rule.passed), []);
  const ownerBacklogDatabase = {
    ...database,
    orderNotification: {
      count: async (input: { where?: { status?: string; kind?: unknown } }) => (
        input.where?.status === "PENDING" && input.where.kind ? 1 : 0
      ),
    },
  } as unknown as Parameters<typeof evaluateProductionOwnerNotificationDatabase>[0];
  const ownerBlocked = await evaluateProductionOwnerNotificationDatabase(ownerBacklogDatabase, "owner@lnxbeats.fr");
  assert.equal(ownerBlocked.find((rule) => rule.name === "outbox.owner.pending")?.passed, false);
  assert.equal(ownerBlocked.find((rule) => rule.name === "outbox.owner.pending")?.detail, "count=1");

  const reviewBacklogDatabase = {
    ...database,
    notificationEvent: { count: async () => 1 },
  } as unknown as Parameters<typeof evaluateProductionOwnerNotificationDatabase>[0];
  const reviewBlocked = await evaluateProductionOwnerNotificationDatabase(reviewBacklogDatabase, "owner@lnxbeats.fr");
  assert.equal(reviewBlocked.find((rule) => rule.name === "events.requiresReview.none")?.passed, false);
  assert.equal(reviewBlocked.find((rule) => rule.name === "events.requiresReview.none")?.detail, "count=1");

  const clientBacklogDatabase = {
    ...database,
    orderNotification: {
      count: async (input: { where?: { kind?: { notIn?: unknown }; status?: unknown } }) => (
        input.where?.kind?.notIn && typeof input.where.status === "object" ? 1 : 0
      ),
    },
  } as unknown as Parameters<typeof evaluateProductionOwnerNotificationDatabase>[0];
  const clientBacklogBlocked = await evaluateProductionOwnerNotificationDatabase(clientBacklogDatabase, "owner@lnxbeats.fr");
  assert.equal(clientBacklogBlocked.find((rule) => rule.name === "outbox.nonOwner.claimable.none")?.passed, false);
  assert.equal(clientBacklogBlocked.find((rule) => rule.name === "outbox.nonOwner.claimable.none")?.detail, "count=1");
});

test("le worker isole l'environnement courant et le retry manuel reste strict", () => {
  const where = globalNotificationDispatchWhere(new Date("2026-08-23T10:00:00Z"), "production");
  assert.equal(where.deploymentEnvironment, "production");
  assert.deepEqual(where.OR, [
    { status: "PENDING" },
    { status: "FAILED_RETRYABLE" },
    { status: "PROCESSING", leaseExpiresAt: { lte: new Date("2026-08-23T10:00:00Z") } },
  ]);
  assert.equal(manualRetryAllowed({ status: "FAILED_RETRYABLE", suppressionActive: false, attempts: 4 }), true);
  assert.equal(manualRetryAllowed({ status: "FAILED_FINAL", suppressionActive: false, attempts: 0 }), false);
  assert.equal(manualRetryAllowed({ status: "FAILED_RETRYABLE", suppressionActive: false, attempts: 5 }), false);
  assert.equal(manualRetryAllowed({ status: "FAILED_RETRYABLE", suppressionActive: true, attempts: 0 }), false);
});

test("l'adaptateur Resend transmet la clé idempotente et retourne l'identifiant fournisseur", async () => {
  let observedKey = "";
  let signalWasAborted: boolean | null = null;
  const providerMessageId = await sendResendEmail({
    apiKey: "re_fixture",
    idempotencyKey: "order:fixture:owner-new:email",
    message: { from: "LNX <notifications@lnxbeats.fr>", to: "owner@lnxbeats.fr", subject: "Test", text: "Test" },
  }, async (_message, options) => {
    observedKey = options.idempotencyKey;
    signalWasAborted = options.signal.aborted;
    return { data: { id: "email_provider_001" }, error: null, headers: null };
  });
  assert.equal(providerMessageId, "email_provider_001");
  assert.equal(observedKey, "order:fixture:owner-new:email");
  assert.equal(signalWasAborted, false);
});

test("les erreurs Resend sont classées sans exposer leur contenu", async () => {
  const cases = [
    { name: "rate_limit_exceeded", statusCode: 429, code: "PROVIDER_TEMPORARY", retryable: true },
    { name: "validation_error", statusCode: 400, code: "INVALID_MESSAGE", retryable: false },
    { name: "invalid_api_key", statusCode: 401, code: "PROVIDER_CONFIGURATION", retryable: false },
    { name: "application_error", statusCode: 503, code: "PROVIDER_TEMPORARY", retryable: true },
    { name: "concurrent_idempotent_requests", statusCode: 409, code: "PROVIDER_TEMPORARY", retryable: true },
    { name: "invalid_idempotent_request", statusCode: 409, code: "IDEMPOTENCY_CONFLICT", retryable: false },
  ] as const;
  for (const item of cases) {
    let thrown: unknown;
    try {
      await sendResendEmail({
        apiKey: "re_fixture",
        idempotencyKey: "order:fixture:owner-new:email",
        message: { from: "LNX <notifications@lnxbeats.fr>", to: "owner@lnxbeats.fr", subject: "Test", text: "Test" },
      }, async () => ({ data: null, error: { name: item.name, message: "provider private detail", statusCode: item.statusCode }, headers: null }));
    } catch (error) {
      thrown = error;
    }
    const failure = classifyNotificationFailure(thrown);
    assert.equal(failure.code, item.code, item.name);
    assert.equal(failure.retryable, item.retryable, item.name);
    assert.doesNotMatch(failure.message, /private detail/);
  }
  assert.deepEqual(classifyNotificationFailure(Object.assign(new Error("private conflict"), {
    name: "unknown_conflict",
    statusCode: 409,
  })), {
    code: "PROVIDER_FINAL",
    message: "La notification nécessite une vérification.",
    retryable: false,
  });
});

test("l'adaptateur Resend borne les appels fournisseur par un timeout", async () => {
  let providerObservedAbort = false;
  let thrown: unknown;
  try {
    await sendResendEmail({
      apiKey: "re_fixture",
      idempotencyKey: "order:fixture:timeout:email",
      message: { from: "LNX <notifications@lnxbeats.fr>", to: "owner@lnxbeats.fr", subject: "Test", text: "Test" },
      timeoutMs: 10,
    }, async (_message, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        providerObservedAbort = true;
        reject(new Error("aborted provider request"));
      }, { once: true });
    }));
  } catch (error) {
    thrown = error;
  }
  assert.equal(providerObservedAbort, true);
  assert.deepEqual(classifyNotificationFailure(thrown), {
    code: "PROVIDER_TEMPORARY",
    message: "Le fournisseur est temporairement indisponible.",
    retryable: true,
  });
});

test("le transport Resend conserve les métadonnées sûres et refuse une destination client falsifiée", async () => {
  const configuration = parseNotificationConfiguration(productionEnvironment);
  let calls = 0;
  let observedKey = "";
  let observedEnvironment = "";
  let observedTags = "";
  let observedEnvelope: Record<string, unknown> = {};
  const transport = createNotificationTransport(configuration, {
    resendSender: async (providerMessage, options) => {
      calls += 1;
      observedKey = options.idempotencyKey;
      observedEnvironment = providerMessage.headers?.["X-LNX-Environment"] ?? "";
      observedTags = JSON.stringify(providerMessage.tags ?? []);
      observedEnvelope = {
        from: providerMessage.from,
        to: providerMessage.to,
        replyTo: providerMessage.replyTo,
        subject: providerMessage.subject,
      };
      return { data: { id: "email_transport_001" }, error: null, headers: null };
    },
  });
  await transport.send(baseMessage, orderNotificationTemplate(baseMessage, configuration));
  assert.equal(calls, 1);
  assert.equal(observedKey, baseMessage.idempotencyKey);
  assert.equal(observedEnvironment, "production");
  assert.deepEqual(observedEnvelope, {
    from: productionEnvironment.EMAIL_FROM,
    to: baseMessage.recipient,
    replyTo: "contact@lnxbeats.fr",
    subject: "Nouvelle commande LNX Beats — LNX-2026-000002",
  });
  assert.deepEqual(JSON.parse(observedTags), [
    { name: "lnx_source", value: "order_outbox" },
    { name: "lnx_environment", value: "production" },
  ]);

  const clientMessage: OrderNotificationMessage = {
    ...baseMessage,
    kind: "CUSTOMER_PAYMENT_CONFIRMED",
    recipient: "attacker@example.com",
    templateKey: "customer-payment-confirmed",
  };
  await assert.rejects(
    () => transport.send(clientMessage, orderNotificationTemplate(clientMessage, configuration)),
    /destination client/i,
  );
  assert.equal(calls, 1);
});

test("tous les événements ont un template déterministe et versionné", () => {
  const configuration = parseNotificationConfiguration(productionEnvironment);
  const kinds: OrderNotificationKind[] = [
    "OWNER_NEW_ORDER", "CUSTOMER_PAYMENT_CONFIRMED", "CUSTOMER_ORDER_ACCEPTED", "CUSTOMER_CREATION_STARTED",
    "CUSTOMER_DELIVERY_READY", "OWNER_RIGHTS_REQUESTED", "CUSTOMER_RIGHTS_INFORMATION_REQUIRED",
    "CUSTOMER_RIGHTS_PREAUTHORIZATION_READY", "CUSTOMER_RIGHTS_CONTRACT_READY", "OWNER_RIGHTS_CLIENT_ACCEPTED",
    "CUSTOMER_RIGHTS_REJECTED", "CUSTOMER_RIGHTS_READY_FOR_PAYMENT", "CUSTOMER_PARTIAL_REFUND",
    "CUSTOMER_REFUND_COMPLETED", "OWNER_PAYMENT_INCIDENT",
  ];
  for (const kind of kinds) {
    const definition = notificationDefinition(kind);
    const rendered = orderNotificationTemplate({
      ...baseMessage,
      kind,
      priority: definition.priority,
      templateKey: definition.templateKey,
    }, configuration);
    assert.equal(rendered.subject.startsWith("[TEST]"), false, kind);
    assert.match(rendered.html, /<!doctype html>/i, kind);
    assert.equal(rendered.text.length > 40, true, kind);
  }
  assert.throws(() => orderNotificationTemplate({ ...baseMessage, templateKey: "unexpected" }, configuration));
  assert.throws(() => orderNotificationTemplate({ ...baseMessage, templateVersion: 2 }, configuration));
  assert.throws(() => orderNotificationTemplate({ ...baseMessage, payloadVersion: 2 }, configuration));
  assert.throws(() => orderNotificationTemplate({ ...baseMessage, deploymentEnvironment: "staging" }, configuration));
});
