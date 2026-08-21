import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  handleOwnerEmailSmokeCreate,
  handleOwnerEmailSmokeDispatch,
  handleOwnerEmailSmokeRead,
  type OwnerEmailSmokeRouteDependencies,
} from "@/lib/notifications/owner-email-smoke-route-handler";
import {
  assertOwnerEmailSmokeEnvironment,
  OWNER_EMAIL_SMOKE_CONFIRMATION,
  OWNER_EMAIL_SMOKE_ORDER_NUMBER,
  ownerEmailSmokeOrderData,
  type OwnerEmailSmokeRepository,
  type OwnerEmailSmokeStatus,
} from "@/lib/notifications/owner-email-smoke";
import { OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY } from "@/lib/notifications/domain";
import { globalNotificationDispatchWhere } from "@/lib/notifications/service";
import { orderNotificationTemplate } from "@/lib/notifications/templates";
import type { OrderNotificationMessage } from "@/lib/notifications/types";

const WORKER_SECRET = "w".repeat(40);
const OWNER_RECIPIENT = "owner-smoke@example.com";
const NOTIFICATION_ID = "00000000-0000-4000-8000-000000000321";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT_NAME: "staging",
    NOTIFICATION_DEPLOYMENT_ENV: "staging",
    NOTIFICATION_EMAIL_TRANSPORT: "resend",
    NOTIFICATION_STAGING_CONFIRM: "resend-staging-approved",
    NOTIFICATION_OWNER_SMOKE_TEST_CONFIRM: OWNER_EMAIL_SMOKE_CONFIRMATION,
    EMAIL_NOTIFICATIONS_ENABLED: "true",
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
    CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
    SMS_TRANSPORT: "disabled",
    SMS_NOTIFICATIONS_ENABLED: "false",
    PAYMENTS_ENABLED: "false",
    RESEND_API_KEY: "re_" + "fixture".repeat(6),
    RESEND_WEBHOOK_SECRET: "whsec_" + "fixture".repeat(6),
    EMAIL_FROM: "LNX Beats <notifications@mail.example.com>",
    EMAIL_REPLY_TO: "reply@example.com",
    EMAIL_OWNER_RECIPIENT: OWNER_RECIPIENT,
    APP_CANONICAL_URL: "https://staging.example.com",
    NOTIFICATION_WORKER_SECRET: WORKER_SECRET,
    ...overrides,
  } satisfies Record<string, string | undefined>;
}

function pendingStatus(): OwnerEmailSmokeStatus {
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
  let state: OwnerEmailSmokeStatus | null = null;
  let creates = 0;
  const recipients: string[] = [];
  let ownerNotifications = 0;
  const clientNotifications = 0;
  const smsNotifications = 0;
  const payments = 0;
  const repository: OwnerEmailSmokeRepository = {
    async create(recipient) {
      recipients.push(recipient);
      if (state) return { created: false, ...state };
      creates += 1;
      ownerNotifications += 1;
      state = pendingStatus();
      return { created: true, ...state };
    },
    async read() { return state; },
    async finalizeFailedAttempt() {
      if (!state || state.status !== "FAILED_RETRYABLE") return;
      state = { ...state, status: "FAILED_FINAL", lastErrorCode: "OWNER_SMOKE_ONE_SHOT_FAILED" };
    },
  };
  return {
    repository,
    state: () => state,
    setState(value: OwnerEmailSmokeStatus) { state = value; },
    counts: () => ({ creates, ownerNotifications, clientNotifications, smsNotifications, payments }),
    recipients: () => recipients,
  };
}

function request(path = "", options: { authorization?: string | null; body?: unknown; contentType?: string; recipientHeader?: string } = {}) {
  const headers = new Headers();
  if (options.authorization !== null) headers.set("authorization", options.authorization ?? `Bearer ${WORKER_SECRET}`);
  headers.set("content-type", options.contentType ?? "application/json");
  if (options.recipientHeader) headers.set("x-recipient", options.recipientHeader);
  return new Request(`https://staging.example.com/api/internal/notifications/qa/owner-email-smoke${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? {}),
  });
}

function dependencies(
  repository: OwnerEmailSmokeRepository,
  dispatchTarget: OwnerEmailSmokeRouteDependencies["dispatchTarget"] = async () => ({ delivered: true, skipped: false }),
  overrides: Record<string, string | undefined> = {},
): OwnerEmailSmokeRouteDependencies {
  return { environment: environment(overrides), repository, dispatchTarget };
}

test("le smoke test est strictement staging et exige son armement dédié", async () => {
  const state = memoryRepository();
  const cases = [
    { NODE_ENV: "development" },
    { RAILWAY_ENVIRONMENT_NAME: "production" },
    { RAILWAY_ENVIRONMENT_NAME: "preview" },
    { RAILWAY_ENVIRONMENT: "production" },
    { NOTIFICATION_DEPLOYMENT_ENV: "production" },
    { NOTIFICATION_OWNER_SMOKE_TEST_CONFIRM: undefined },
    { NOTIFICATION_OWNER_SMOKE_TEST_CONFIRM: "wrong" },
    { NOTIFICATION_STAGING_QA_CONFIRM: "resend-v073-qa-approved" },
  ];
  for (const override of cases) {
    assert.equal((await handleOwnerEmailSmokeCreate(request(), dependencies(state.repository, undefined, override))).status, 404);
  }
  assert.equal(state.counts().creates, 0);
});

test("le Bearer worker est obligatoire avant toute lecture ou création", async () => {
  const state = memoryRepository();
  assert.equal((await handleOwnerEmailSmokeCreate(request("", { authorization: null }), dependencies(state.repository))).status, 401);
  assert.equal((await handleOwnerEmailSmokeCreate(request("", { authorization: "Bearer wrong" }), dependencies(state.repository))).status, 401);
  const get = new Request("https://staging.example.com/api/internal/notifications/qa/owner-email-smoke");
  assert.equal((await handleOwnerEmailSmokeRead(get, dependencies(state.repository))).status, 401);
  assert.equal(state.counts().creates, 0);
});

test("le destinataire vient uniquement de l'environnement et tout champ body est refusé", async () => {
  const state = memoryRepository();
  for (const body of [{ recipient: "attacker@example.com" }, { email: "attacker@example.com" }, { to: "attacker@example.com" }, { extra: true }]) {
    assert.equal((await handleOwnerEmailSmokeCreate(request("", { body }), dependencies(state.repository))).status, 400);
  }
  assert.equal((await handleOwnerEmailSmokeCreate(request(), dependencies(state.repository, undefined, { EMAIL_OWNER_RECIPIENT: undefined }))).status, 404);
  assert.equal((await handleOwnerEmailSmokeCreate(request(), dependencies(state.repository, undefined, { EMAIL_OWNER_RECIPIENT: "delivered@resend.dev" }))).status, 404);
  assert.equal(state.counts().creates, 0);

  const headerState = memoryRepository();
  assert.equal((await handleOwnerEmailSmokeCreate(
    request("", { recipientHeader: "attacker@example.com" }),
    dependencies(headerState.repository),
  )).status, 200);
  assert.deepEqual(headerState.recipients(), [OWNER_RECIPIENT]);

  const queryState = memoryRepository();
  assert.equal((await handleOwnerEmailSmokeCreate(
    request("?recipient=attacker%40example.com"),
    dependencies(queryState.repository),
  )).status, 400);
  assert.equal(queryState.counts().creates, 0);
});

test("les flags client, paiement et SMS restent fermés", async () => {
  const state = memoryRepository();
  const cases = [
    { CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true" },
    { PAYMENTS_ENABLED: "true" },
    { SMS_TRANSPORT: "capture", SMS_NOTIFICATIONS_ENABLED: "true" },
    { OWNER_EMAIL_NOTIFICATIONS_ENABLED: "false" },
  ];
  for (const override of cases) {
    assert.equal((await handleOwnerEmailSmokeCreate(request(), dependencies(state.repository, undefined, override))).status, 404);
  }
  assert.equal(state.counts().creates, 0);
});

test("la fixture est explicitement TEST, annulée et sans chemin Payment", () => {
  const cancelledAt = new Date("2026-08-21T12:00:00.000Z");
  const data = ownerEmailSmokeOrderData(cancelledAt);
  assert.equal(data.orderNumber, OWNER_EMAIL_SMOKE_ORDER_NUMBER);
  assert.equal(data.status, "CANCELLED");
  assert.equal(data.cancelledAt, cancelledAt);
  assert.match(String(data.title), /^\[TEST\]/);
  assert.equal(data.totalCents, 0);
  assert.equal("payments" in data, false);
  const source = readFileSync(new URL("../../lib/notifications/owner-email-smoke.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /transaction\.payment|payment\.create|kind:\s*"CUSTOMER_|channel:\s*"SMS"/);
});

test("deux créations produisent une seule notification propriétaire", async () => {
  const state = memoryRepository();
  const injected = dependencies(state.repository);
  const first = await handleOwnerEmailSmokeCreate(request(), injected);
  const second = await handleOwnerEmailSmokeCreate(request(), injected);
  const firstBody = await first.json() as Record<string, unknown>;
  const secondBody = await second.json() as Record<string, unknown>;
  assert.equal(firstBody.created, true);
  assert.equal(secondBody.created, false);
  assert.equal(firstBody.notificationId, secondBody.notificationId);
  assert.deepEqual(state.counts(), { creates: 1, ownerNotifications: 1, clientNotifications: 0, smsNotifications: 0, payments: 0 });
  assert.equal(OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY, "qa:owner-smoke:v0732:01");
});

test("la lecture n'expose ni destinataire ni identifiant fournisseur", async () => {
  const state = memoryRepository();
  await state.repository.create(OWNER_RECIPIENT);
  state.setState({ ...pendingStatus(), provider: "RESEND", providerMessageIdPresent: true });
  const get = new Request("https://staging.example.com/api/internal/notifications/qa/owner-email-smoke", {
    headers: { authorization: `Bearer ${WORKER_SECRET}` },
  });
  const response = await handleOwnerEmailSmokeRead(get, dependencies(state.repository));
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(body).includes(OWNER_RECIPIENT), false);
  assert.equal(JSON.stringify(body).includes(WORKER_SECRET), false);
  assert.equal("providerMessageId" in body, false);
});

test("le dispatch cible uniquement la notification smoke et laisse toute autre outbox inchangée", async () => {
  const state = memoryRepository();
  await state.repository.create(OWNER_RECIPIENT);
  const other = new Map([
    ["pending", { status: "PENDING", attempts: 0 }],
    ["retryable", { status: "FAILED_RETRYABLE", attempts: 1 }],
    ["expired-processing", { status: "PROCESSING", attempts: 1 }],
  ]);
  const before = structuredClone(Array.from(other.entries()));
  let targetedId: string | null = null;
  const response = await handleOwnerEmailSmokeDispatch(request("/dispatch"), dependencies(state.repository, async (id) => {
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

test("un statut terminal interdit tout deuxième appel fournisseur", async () => {
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
  const first = await handleOwnerEmailSmokeDispatch(request("/dispatch"), injected);
  const stateAfterFirstDispatch = structuredClone(state.state());
  const second = await handleOwnerEmailSmokeDispatch(request("/dispatch"), injected);
  assert.equal((await first.json()).dispatched, true);
  assert.equal((await second.json()).dispatched, false);
  assert.equal(sends, 1);
  assert.equal(state.state()?.providerMessageIdPresent, true);
  assert.deepEqual(state.state(), stateAfterFirstDispatch);
});

test("un échec provider devient final et ne déclenche aucune boucle", async () => {
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
  const first = await handleOwnerEmailSmokeDispatch(request("/dispatch"), injected);
  const second = await handleOwnerEmailSmokeDispatch(request("/dispatch"), injected);
  assert.equal((await first.json()).status, "FAILED_FINAL");
  assert.equal((await second.json()).dispatched, false);
  assert.equal(sends, 1);
  assert.equal(state.state()?.lastErrorCode, "OWNER_SMOKE_ONE_SHOT_FAILED");
});

test("le dispatcher global exclut la clé réservée au dispatch ciblé", () => {
  const where = globalNotificationDispatchWhere(new Date("2026-08-21T12:00:00.000Z"));
  assert.deepEqual(where.idempotencyKey, { not: OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY });
});

test("le rendu staging porte [TEST] dans le sujet et le corps", () => {
  const configuration = assertOwnerEmailSmokeEnvironment(environment());
  const message: OrderNotificationMessage = {
    id: NOTIFICATION_ID,
    kind: "OWNER_NEW_ORDER",
    channel: "EMAIL",
    priority: "CRITICAL",
    recipient: OWNER_RECIPIENT,
    idempotencyKey: OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY,
    templateKey: "owner-new-order",
    templateVersion: 1,
    payloadVersion: 1,
    payload: {
      orderNumber: OWNER_EMAIL_SMOKE_ORDER_NUMBER,
      customerName: "Smoke test propriétaire [TEST]",
      customerEmail: "owner-smoke-test@lnx.invalid",
      totalCents: 0,
      currency: "EUR",
      coverIncluded: false,
      priorityProcessing: false,
      createdAt: "2026-08-21T12:00:00.000Z",
    },
    resourceType: "ORDER",
    resourceId: "00000000-0000-4000-8000-000000000322",
    resourceReference: OWNER_EMAIL_SMOKE_ORDER_NUMBER,
    deploymentEnvironment: "staging",
    order: {
      orderNumber: OWNER_EMAIL_SMOKE_ORDER_NUMBER,
      customerName: "Smoke test propriétaire [TEST]",
      customerEmail: "owner-smoke-test@lnx.invalid",
      totalCents: 0,
      currency: "EUR",
      coverIncluded: false,
      priorityProcessing: false,
      createdAt: new Date("2026-08-21T12:00:00.000Z"),
    },
  };
  const rendered = orderNotificationTemplate(message, configuration);
  assert.match(rendered.subject, /^\[TEST\]/);
  assert.match(rendered.text, /STAGING · MODE TEST/);
  assert.match(rendered.html, /STAGING · MODE TEST/);
});
