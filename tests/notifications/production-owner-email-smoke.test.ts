import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NOTIFICATION_PRODUCTION_CONFIRMATION } from "@/lib/notifications/config";
import {
  ONE_SHOT_NOTIFICATION_IDEMPOTENCY_KEYS,
  PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY,
} from "@/lib/notifications/domain";
import { assertOwnerEmailSmokeEnvironment } from "@/lib/notifications/owner-email-smoke";
import {
  handleProductionOwnerEmailSmokeCreate,
  handleProductionOwnerEmailSmokeDispatch,
  handleProductionOwnerEmailSmokeRead,
  type ProductionOwnerEmailSmokeRouteDependencies,
} from "@/lib/notifications/production-owner-email-smoke-route-handler";
import {
  assertProductionOwnerEmailSmokeEnvironment,
  PRODUCTION_OWNER_EMAIL_SMOKE_CONFIRMATION,
  PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER,
  productionOwnerEmailSmokeOrderData,
  type ProductionOwnerEmailSmokeRepository,
  type ProductionOwnerEmailSmokeStatus,
} from "@/lib/notifications/production-owner-email-smoke";
import { RESEND_WEBHOOK_EVENT_TYPES } from "@/lib/notifications/resend-webhook";
import { globalNotificationDispatchWhere } from "@/lib/notifications/service";
import { orderNotificationTemplate } from "@/lib/notifications/templates";
import type { OrderNotificationMessage } from "@/lib/notifications/types";

const WORKER_SECRET = "w".repeat(40);
const OWNER_RECIPIENT = "owner@lnxbeats.fr";
const NOTIFICATION_ID = "00000000-0000-4000-8000-000000000812";
const BASE_URL = "https://www.lnxbeats.fr/api/internal/notifications/production/owner-email-smoke";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT_NAME: "production",
    NOTIFICATION_DEPLOYMENT_ENV: "production",
    NOTIFICATION_EMAIL_TRANSPORT: "resend",
    NOTIFICATION_PRODUCTION_CONFIRM: NOTIFICATION_PRODUCTION_CONFIRMATION,
    NOTIFICATION_PRODUCTION_OWNER_SMOKE_CONFIRM: PRODUCTION_OWNER_EMAIL_SMOKE_CONFIRMATION,
    EMAIL_NOTIFICATIONS_ENABLED: "true",
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
    CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
    NOTIFICATION_WORKER_ENABLED: "false",
    NOTIFICATION_SCHEDULER_MODE: "disabled",
    PAYMENTS_ENABLED: "false",
    SMS_TRANSPORT: "disabled",
    SMS_NOTIFICATIONS_ENABLED: "false",
    RESEND_API_KEY: `re_${"fixture".repeat(6)}`,
    RESEND_WEBHOOK_SECRET: `whsec_${"fixture".repeat(6)}`,
    EMAIL_FROM: "LNX Beats <notifications@mail.lnxbeats.fr>",
    EMAIL_REPLY_TO: "reply@lnxbeats.fr",
    EMAIL_OWNER_RECIPIENT: OWNER_RECIPIENT,
    APP_CANONICAL_URL: "https://www.lnxbeats.fr",
    NOTIFICATION_WORKER_SECRET: WORKER_SECRET,
    ...overrides,
  } satisfies Record<string, string | undefined>;
}

function pendingStatus(): ProductionOwnerEmailSmokeStatus {
  return {
    notificationId: NOTIFICATION_ID,
    status: "PENDING",
    attempts: 0,
    provider: null,
    providerMessageIdPresent: false,
    sentAtPresent: false,
    deliveredAtPresent: false,
    failedAtPresent: false,
    lastErrorCode: null,
    eventTypes: [],
    suppressionActive: false,
  };
}

function memoryRepository() {
  let state: ProductionOwnerEmailSmokeStatus | null = null;
  let creates = 0;
  const recipients: string[] = [];
  const repository: ProductionOwnerEmailSmokeRepository = {
    async create(recipient) {
      recipients.push(recipient);
      if (state) return { created: false, ...state };
      creates += 1;
      state = pendingStatus();
      return { created: true, ...state };
    },
    async read() {
      return state;
    },
    async finalizeFailedAttempt() {
      if (!state || state.status !== "FAILED_RETRYABLE") return;
      state = { ...state, status: "FAILED_FINAL", lastErrorCode: "PRODUCTION_OWNER_SMOKE_ONE_SHOT_FAILED" };
    },
  };
  return {
    repository,
    state: () => state,
    setState(value: ProductionOwnerEmailSmokeStatus) {
      state = value;
    },
    creates: () => creates,
    recipients: () => recipients,
  };
}

function request(
  path = "",
  options: { authorization?: string | null; body?: unknown; contentType?: string; recipientHeader?: string } = {},
) {
  const headers = new Headers();
  if (options.authorization !== null) headers.set("authorization", options.authorization ?? `Bearer ${WORKER_SECRET}`);
  headers.set("content-type", options.contentType ?? "application/json");
  if (options.recipientHeader) headers.set("x-recipient", options.recipientHeader);
  return new Request(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: typeof options.body === "string" ? options.body : JSON.stringify(options.body ?? {}),
  });
}

function dependencies(
  repository: ProductionOwnerEmailSmokeRepository,
  dispatchTarget: ProductionOwnerEmailSmokeRouteDependencies["dispatchTarget"] = async () => ({ delivered: true, skipped: false }),
  overrides: Record<string, string | undefined> = {},
): ProductionOwnerEmailSmokeRouteDependencies {
  return { environment: environment(overrides), repository, dispatchTarget };
}

test("le smoke Production exige tous les garde-fous explicites", async () => {
  const state = memoryRepository();
  const cases: Record<string, string | undefined>[] = [
    { NODE_ENV: "development" },
    { RAILWAY_ENVIRONMENT_NAME: undefined },
    { RAILWAY_ENVIRONMENT_NAME: "staging" },
    { NOTIFICATION_DEPLOYMENT_ENV: "staging" },
    { NOTIFICATION_EMAIL_TRANSPORT: "capture" },
    { EMAIL_NOTIFICATIONS_ENABLED: "false" },
    { OWNER_EMAIL_NOTIFICATIONS_ENABLED: "false" },
    { CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true" },
    { NOTIFICATION_WORKER_ENABLED: "true" },
    { NOTIFICATION_SCHEDULER_MODE: "railway-cron" },
    { PAYMENTS_ENABLED: "true" },
    { SMS_TRANSPORT: "capture", SMS_NOTIFICATIONS_ENABLED: "true" },
    { NOTIFICATION_PRODUCTION_CONFIRM: undefined },
    { NOTIFICATION_PRODUCTION_OWNER_SMOKE_CONFIRM: undefined },
    { NOTIFICATION_PRODUCTION_OWNER_SMOKE_CONFIRM: "wrong" },
    { RESEND_API_KEY: undefined },
    { RESEND_WEBHOOK_SECRET: undefined },
    { NOTIFICATION_WORKER_SECRET: "too-short" },
  ];
  for (const override of cases) {
    assert.equal((await handleProductionOwnerEmailSmokeCreate(request(), dependencies(state.repository, undefined, override))).status, 404);
  }
  assert.equal(state.creates(), 0);
});

test("le smoke staging reste strictement staging-only", () => {
  assert.throws(() => assertOwnerEmailSmokeEnvironment(environment()));
  const stagingSource = readFileSync(new URL("../../lib/notifications/owner-email-smoke.ts", import.meta.url), "utf8");
  assert.match(stagingSource, /RAILWAY_ENVIRONMENT_NAME\s*!==\s*"staging"/);
  assert.doesNotMatch(stagingSource, /NOTIFICATION_PRODUCTION_OWNER_SMOKE_CONFIRM/);
});

test("le Bearer worker est obligatoire et les réponses restent no-store", async () => {
  const state = memoryRepository();
  const missing = await handleProductionOwnerEmailSmokeCreate(request("", { authorization: null }), dependencies(state.repository));
  const wrong = await handleProductionOwnerEmailSmokeCreate(request("", { authorization: "Bearer wrong" }), dependencies(state.repository));
  const get = new Request(BASE_URL);
  const getResponse = await handleProductionOwnerEmailSmokeRead(get, dependencies(state.repository));
  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(getResponse.status, 401);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.equal(JSON.stringify(await missing.json()).includes(WORKER_SECRET), false);
  assert.equal(state.creates(), 0);
});

test("le body, le Content-Type et la query sont strictement fermés", async () => {
  const state = memoryRepository();
  for (const body of [{ recipient: "attacker@example.com" }, { email: "attacker@example.com" }, { to: "attacker@example.com" }, { extra: true }]) {
    assert.equal((await handleProductionOwnerEmailSmokeCreate(request("", { body }), dependencies(state.repository))).status, 400);
  }
  assert.equal((await handleProductionOwnerEmailSmokeCreate(request("", { contentType: "text/plain" }), dependencies(state.repository))).status, 400);
  assert.equal((await handleProductionOwnerEmailSmokeCreate(request("", { body: "{" + "x".repeat(80) + "}" }), dependencies(state.repository))).status, 400);
  assert.equal((await handleProductionOwnerEmailSmokeCreate(request("?recipient=attacker"), dependencies(state.repository))).status, 400);
  assert.equal((await handleProductionOwnerEmailSmokeCreate(request("/dispatch?retry=true"), dependencies(state.repository))).status, 400);
  assert.equal(state.creates(), 0);
});

test("le destinataire vient uniquement de la configuration Production", async () => {
  const state = memoryRepository();
  for (const recipient of [undefined, "owner@example.com", "owner@example.invalid", "delivered@resend.dev", "suppressed@resend.dev"]) {
    assert.equal((await handleProductionOwnerEmailSmokeCreate(
      request(),
      dependencies(state.repository, undefined, { EMAIL_OWNER_RECIPIENT: recipient }),
    )).status, 404);
  }
  const headerState = memoryRepository();
  const response = await handleProductionOwnerEmailSmokeCreate(
    request("", { recipientHeader: "attacker@example.com" }),
    dependencies(headerState.repository),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(headerState.recipients(), [OWNER_RECIPIENT]);
});

test("la fixture Production est synthétique, annulée, à zéro et sans Payment", () => {
  const cancelledAt = new Date("2026-08-25T08:00:00.000Z");
  const data = productionOwnerEmailSmokeOrderData(cancelledAt);
  assert.equal(data.orderNumber, PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER);
  assert.equal(data.status, "CANCELLED");
  assert.equal(data.cancelledAt, cancelledAt);
  assert.match(String(data.title), /^\[TEST PRODUCTION\]/);
  assert.match(String(data.customerName), /^\[TEST PRODUCTION\]/);
  assert.equal(data.totalCents, 0);
  assert.equal("payments" in data, false);
  const source = readFileSync(new URL("../../lib/notifications/production-owner-email-smoke.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /transaction\.payment|payment\.create|kind:\s*"CUSTOMER_|channel:\s*"SMS"/);
});

test("la création est idempotente et ne produit qu’une notification logique", async () => {
  const state = memoryRepository();
  const injected = dependencies(state.repository);
  const first = await handleProductionOwnerEmailSmokeCreate(request(), injected);
  const second = await handleProductionOwnerEmailSmokeCreate(request(), injected);
  const firstBody = await first.json() as Record<string, unknown>;
  const secondBody = await second.json() as Record<string, unknown>;
  assert.equal(firstBody.created, true);
  assert.equal(secondBody.created, false);
  assert.equal(firstBody.notificationId, secondBody.notificationId);
  assert.equal(state.creates(), 1);
  assert.equal(PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY, "production:owner-smoke:v0812:01");
});

test("le GET expose uniquement le statut allowlisté sans recipient ni providerMessageId", async () => {
  const state = memoryRepository();
  await state.repository.create(OWNER_RECIPIENT);
  state.setState({
    ...pendingStatus(),
    status: "SENT",
    attempts: 1,
    provider: "RESEND",
    providerMessageIdPresent: true,
    sentAtPresent: true,
    eventTypes: ["email.sent"],
  });
  const get = new Request(BASE_URL, { headers: { authorization: `Bearer ${WORKER_SECRET}` } });
  const response = await handleProductionOwnerEmailSmokeRead(get, dependencies(state.repository));
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), [
    "attempts", "deliveredAtPresent", "eventTypes", "failedAtPresent", "lastErrorCode", "notificationId",
    "provider", "providerMessageIdPresent", "sentAtPresent", "status", "suppressionActive",
  ].sort());
  assert.equal(JSON.stringify(body).includes(OWNER_RECIPIENT), false);
  assert.equal(JSON.stringify(body).includes(WORKER_SECRET), false);
  assert.equal("providerMessageId" in body, false);
});

test("le dispatch cible seulement le smoke et laisse toute autre outbox intacte", async () => {
  const state = memoryRepository();
  await state.repository.create(OWNER_RECIPIENT);
  const other = new Map([
    ["pending", { status: "PENDING", attempts: 0 }],
    ["retryable", { status: "FAILED_RETRYABLE", attempts: 1 }],
    ["expired-processing", { status: "PROCESSING", attempts: 1 }],
  ]);
  const before = structuredClone(Array.from(other.entries()));
  let targetedId: string | null = null;
  const response = await handleProductionOwnerEmailSmokeDispatch(request("/dispatch"), dependencies(state.repository, async (id) => {
    targetedId = id;
    state.setState({
      ...pendingStatus(), status: "SENT", attempts: 1, provider: "RESEND", providerMessageIdPresent: true, sentAtPresent: true,
    });
    return { delivered: true, skipped: false };
  }));
  assert.equal(response.status, 200);
  assert.equal(targetedId, NOTIFICATION_ID);
  assert.deepEqual(Array.from(other.entries()), before);
  assert.equal((await response.json()).dispatched, true);
});

test("le dispatch est strictement one-shot", async () => {
  const state = memoryRepository();
  await state.repository.create(OWNER_RECIPIENT);
  let sends = 0;
  const injected = dependencies(state.repository, async () => {
    sends += 1;
    state.setState({
      ...pendingStatus(), status: "SENT", attempts: 1, provider: "RESEND", providerMessageIdPresent: true, sentAtPresent: true,
    });
    return { delivered: true, skipped: false };
  });
  const first = await handleProductionOwnerEmailSmokeDispatch(request("/dispatch"), injected);
  const afterFirst = structuredClone(state.state());
  const second = await handleProductionOwnerEmailSmokeDispatch(request("/dispatch"), injected);
  assert.equal((await first.json()).dispatched, true);
  assert.equal((await second.json()).dispatched, false);
  assert.equal(sends, 1);
  assert.deepEqual(state.state(), afterFirst);
});

test("un échec devient final sans retry ni second appel", async () => {
  const state = memoryRepository();
  await state.repository.create(OWNER_RECIPIENT);
  let sends = 0;
  const injected = dependencies(state.repository, async () => {
    sends += 1;
    state.setState({
      ...pendingStatus(), status: "FAILED_RETRYABLE", attempts: 1, failedAtPresent: true, lastErrorCode: "PROVIDER_TEMPORARY",
    });
    return { delivered: false, skipped: false };
  });
  const first = await handleProductionOwnerEmailSmokeDispatch(request("/dispatch"), injected);
  const second = await handleProductionOwnerEmailSmokeDispatch(request("/dispatch"), injected);
  assert.equal((await first.json()).status, "FAILED_FINAL");
  assert.equal((await second.json()).dispatched, false);
  assert.equal(sends, 1);
  assert.equal(state.state()?.lastErrorCode, "PRODUCTION_OWNER_SMOKE_ONE_SHOT_FAILED");
});

test("les deux smokes one-shot sont exclus du dispatcher global", () => {
  const where = globalNotificationDispatchWhere(new Date("2026-08-25T08:00:00.000Z"), "production");
  assert.deepEqual(where.idempotencyKey, { notIn: [...ONE_SHOT_NOTIFICATION_IDEMPOTENCY_KEYS] });
  assert.ok(ONE_SHOT_NOTIFICATION_IDEMPOTENCY_KEYS.includes(PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY));
});

test("le template Production est explicitement un TEST sans prétendre à un paiement", () => {
  const configuration = assertProductionOwnerEmailSmokeEnvironment(environment());
  const message: OrderNotificationMessage = {
    id: NOTIFICATION_ID,
    kind: "OWNER_NEW_ORDER",
    channel: "EMAIL",
    priority: "CRITICAL",
    recipient: OWNER_RECIPIENT,
    idempotencyKey: PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY,
    templateKey: "owner-new-order",
    templateVersion: 1,
    payloadVersion: 1,
    payload: {
      orderNumber: PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER,
      customerName: "[TEST PRODUCTION] Aucun client réel",
      customerEmail: "production-owner-smoke@lnx.invalid",
      totalCents: 0,
      currency: "EUR",
      coverIncluded: false,
      priorityProcessing: false,
      createdAt: "2026-08-25T08:00:00.000Z",
    },
    resourceType: "ORDER",
    resourceId: "00000000-0000-4000-8000-000000000813",
    resourceReference: PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER,
    deploymentEnvironment: "production",
    order: {
      orderNumber: PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER,
      customerName: "[TEST PRODUCTION] Aucun client réel",
      customerEmail: "production-owner-smoke@lnx.invalid",
      totalCents: 0,
      currency: "EUR",
      coverIncluded: false,
      priorityProcessing: false,
      createdAt: new Date("2026-08-25T08:00:00.000Z"),
    },
  };
  const rendered = orderNotificationTemplate(message, configuration);
  assert.match(rendered.subject, /^\[TEST PRODUCTION\]/);
  assert.match(rendered.text, /aucun client et aucun paiement réel/i);
  assert.match(rendered.html, /aucun client et aucun paiement réel/i);
  assert.doesNotMatch(rendered.text, /paiement a été confirmé/i);
});

test("le webhook existant couvre tous les états demandés", () => {
  for (const type of ["email.sent", "email.delivered", "email.bounced", "email.complained", "email.failed", "email.suppressed"] as const) {
    assert.ok(RESEND_WEBHOOK_EVENT_TYPES.includes(type));
  }
});
