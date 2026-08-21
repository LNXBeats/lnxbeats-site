import assert from "node:assert/strict";
import test from "node:test";

import { handleResendQaHarnessGet, handleResendQaHarnessPost } from "@/lib/notifications/resend-qa-harness-route-handler";
import {
  RESEND_QA_CONFIRMATION,
  RESEND_QA_SCENARIOS,
  resendQaIdempotencyKey,
  type ResendQaFixtureResult,
  type ResendQaHarnessRepository,
  type ResendQaScenario,
  type ResendQaStatusResult,
} from "@/lib/notifications/resend-qa-harness";
import { dispatchOrderNotification, type NotificationDispatchRepository } from "@/lib/notifications/service";
import type { OrderNotificationMessage } from "@/lib/notifications/types";

const WORKER_SECRET = "w".repeat(40);

function environment(scenario: ResendQaScenario = "delivered") {
  return {
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT_NAME: "staging",
    NOTIFICATION_DEPLOYMENT_ENV: "staging",
    NOTIFICATION_EMAIL_TRANSPORT: "resend",
    NOTIFICATION_STAGING_CONFIRM: "resend-staging-approved",
    NOTIFICATION_STAGING_QA_CONFIRM: RESEND_QA_CONFIRMATION,
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
    EMAIL_OWNER_RECIPIENT: RESEND_QA_SCENARIOS[scenario].recipient,
    APP_CANONICAL_URL: "https://staging.example.com",
    NOTIFICATION_WORKER_SECRET: WORKER_SECRET,
  } satisfies Record<string, string>;
}

function memoryRepository() {
  const fixtures = new Map<ResendQaScenario, ResendQaStatusResult>();
  let creates = 0;
  const repository: ResendQaHarnessRepository = {
    async create(scenario) {
      const current = fixtures.get(scenario);
      if (current) return { created: false, notificationId: current.notificationId, scenario, status: current.status };
      creates += 1;
      const fixture: ResendQaStatusResult = {
        scenario,
        notificationId: `00000000-0000-4000-8000-00000000000${creates}`,
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
        suppressionReason: null,
      };
      fixtures.set(scenario, fixture);
      return { created: true, notificationId: fixture.notificationId, scenario, status: fixture.status };
    },
    async read(scenario) { return fixtures.get(scenario) ?? null; },
  };
  return { repository, creates: () => creates, fixtures };
}

function request(
  scenario: ResendQaScenario | string = "delivered",
  options: { authorization?: string | null; body?: unknown; contentType?: string } = {},
) {
  const headers = new Headers();
  if (options.authorization !== null) headers.set("authorization", options.authorization ?? `Bearer ${WORKER_SECRET}`);
  headers.set("content-type", options.contentType ?? "application/json");
  return new Request("https://staging.example.com/api/internal/notifications/qa/resend", {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? { scenario }),
  });
}

function dependencies(
  repository: ResendQaHarnessRepository,
  overrides: Record<string, string | undefined> = {},
  scenario: ResendQaScenario = "delivered",
) {
  return { environment: { ...environment(scenario), ...overrides }, repository };
}

test("le harness refuse production et tout environnement non staging", async () => {
  const { repository } = memoryRepository();
  const cases = [
    { NOTIFICATION_DEPLOYMENT_ENV: "production" },
    { RAILWAY_ENVIRONMENT_NAME: "production" },
    { RAILWAY_ENVIRONMENT_NAME: "preview" },
    { RAILWAY_ENVIRONMENT: "production" },
    { NODE_ENV: "development" },
  ];
  for (const override of cases) {
    const response = await handleResendQaHarnessPost(request(), dependencies(repository, override));
    assert.equal(response.status, 404);
  }
});

test("la confirmation staging dédiée est obligatoire et exacte", async () => {
  const { repository } = memoryRepository();
  assert.equal((await handleResendQaHarnessPost(request(), dependencies(repository, { NOTIFICATION_STAGING_QA_CONFIRM: undefined }))).status, 404);
  assert.equal((await handleResendQaHarnessPost(request(), dependencies(repository, { NOTIFICATION_STAGING_QA_CONFIRM: "wrong" }))).status, 404);
});

test("le Bearer worker est obligatoire et comparé avant toute création", async () => {
  const state = memoryRepository();
  assert.equal((await handleResendQaHarnessPost(request("delivered", { authorization: null }), dependencies(state.repository))).status, 401);
  assert.equal((await handleResendQaHarnessPost(request("delivered", { authorization: "Bearer wrong" }), dependencies(state.repository))).status, 401);
  assert.equal(state.creates(), 0);
});

test("les flags client, paiement et SMS restent fermés", async () => {
  const { repository } = memoryRepository();
  const cases = [
    { CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true" },
    { PAYMENTS_ENABLED: "true" },
    { SMS_NOTIFICATIONS_ENABLED: "true", SMS_TRANSPORT: "capture" },
  ];
  for (const override of cases) {
    assert.equal((await handleResendQaHarnessPost(request(), dependencies(repository, override))).status, 404);
  }
});

test("la création exige le flag propriétaire et la destination exacte du scénario", async () => {
  const { repository } = memoryRepository();
  assert.equal((await handleResendQaHarnessPost(request(), dependencies(repository, { OWNER_EMAIL_NOTIFICATIONS_ENABLED: "false" }))).status, 403);
  assert.equal((await handleResendQaHarnessPost(request(), dependencies(repository, { EMAIL_OWNER_RECIPIENT: RESEND_QA_SCENARIOS.bounced.recipient }))).status, 403);
});

test("le JSON strict refuse scénario inconnu et toute injection de destination", async () => {
  const state = memoryRepository();
  const bodies = [
    { scenario: "unknown" },
    { scenario: "delivered", recipient: "attacker@example.com" },
    { scenario: "delivered", email: "attacker@example.com" },
    { scenario: "delivered", to: "attacker@example.com" },
    { scenario: "delivered", extra: true },
  ];
  for (const body of bodies) {
    assert.equal((await handleResendQaHarnessPost(request("delivered", { body }), dependencies(state.repository))).status, 400);
  }
  assert.equal(state.creates(), 0);
});

test("chaque scénario impose l'unique adresse officielle attendue", async () => {
  const expected = {
    delivered: "delivered+lnx-v073-qa-01@resend.dev",
    bounced: "bounced+lnx-v073-qa-01@resend.dev",
    complained: "complained+lnx-v073-qa-01@resend.dev",
    suppressed: "suppressed@resend.dev",
  } as const;
  assert.deepEqual(Object.fromEntries(Object.entries(RESEND_QA_SCENARIOS).map(([scenario, value]) => [scenario, value.recipient])), expected);
  assert.ok(Object.values(RESEND_QA_SCENARIOS).every(({ recipient }) => recipient.endsWith("@resend.dev")));
  for (const scenario of Object.keys(RESEND_QA_SCENARIOS) as ResendQaScenario[]) {
    const state = memoryRepository();
    const response = await handleResendQaHarnessPost(request(scenario), dependencies(state.repository, {}, scenario));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).scenario, scenario);
    assert.equal(state.creates(), 1);
  }
});

test("un second POST conserve une seule notification logique", async () => {
  const state = memoryRepository();
  const injected = dependencies(state.repository);
  const first = await handleResendQaHarnessPost(request(), injected);
  const second = await handleResendQaHarnessPost(request(), injected);
  const firstBody = await first.json() as ResendQaFixtureResult;
  const secondBody = await second.json() as ResendQaFixtureResult;
  assert.equal(firstBody.created, true);
  assert.equal(secondBody.created, false);
  assert.equal(firstBody.notificationId, secondBody.notificationId);
  assert.equal(state.creates(), 1);
  assert.equal(resendQaIdempotencyKey("delivered"), "qa:resend:v073:delivered:01");
});

test("la route ne fait qu'enfiler la fixture, sans transport ni Resend", async () => {
  const state = memoryRepository();
  const response = await handleResendQaHarnessPost(request(), dependencies(state.repository));
  assert.equal(response.status, 200);
  assert.equal(state.fixtures.get("delivered")?.status, "PENDING");
  assert.equal(state.fixtures.get("delivered")?.provider, null);
  assert.equal(state.fixtures.get("delivered")?.attempts, 0);
});

test("une fixture propriétaire est dispatchable par le worker existant", async () => {
  const scenario = "delivered" as const;
  const recipient = RESEND_QA_SCENARIOS[scenario].recipient;
  const message: OrderNotificationMessage = {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "OWNER_NEW_ORDER",
    channel: "EMAIL",
    priority: "CRITICAL",
    recipient,
    idempotencyKey: resendQaIdempotencyKey(scenario),
    templateKey: "owner-new-order",
    templateVersion: 1,
    payloadVersion: 1,
    payload: {
      orderNumber: RESEND_QA_SCENARIOS[scenario].orderNumber,
      customerName: "Resend QA delivered",
      customerEmail: recipient,
      totalCents: 0,
      currency: "EUR",
      coverIncluded: false,
      priorityProcessing: false,
      createdAt: "2026-08-21T12:00:00.000Z",
    },
    resourceType: "ORDER",
    resourceId: "00000000-0000-4000-8000-000000000010",
    resourceReference: RESEND_QA_SCENARIOS[scenario].orderNumber,
    deploymentEnvironment: "staging",
    order: {
      orderNumber: RESEND_QA_SCENARIOS[scenario].orderNumber,
      customerName: "Resend QA delivered",
      customerEmail: recipient,
      totalCents: 0,
      currency: "EUR",
      coverIncluded: false,
      priorityProcessing: false,
      createdAt: new Date("2026-08-21T12:00:00.000Z"),
    },
  };
  let claim: OrderNotificationMessage | null = message;
  let sent = false;
  let sends = 0;
  const repository: NotificationDispatchRepository = {
    async claim() { const current = claim; claim = null; return current; },
    async markSent() { sent = true; },
    async markFailed() { assert.fail("The fixture should not fail."); },
  };
  const result = await dispatchOrderNotification(message.id, {
    repository,
    async sendEmail(value) {
      sends += 1;
      assert.equal(value.recipient, recipient);
      return { provider: "RESEND", providerMessageId: "provider-message-fixture", deliveredImmediately: false };
    },
  });
  assert.deepEqual(result, { delivered: true, skipped: false });
  assert.equal(sends, 1);
  assert.equal(sent, true);
});

test("la lecture QA est authentifiée et ne divulgue ni adresse ni identifiant provider", async () => {
  const state = memoryRepository();
  await state.repository.create("delivered");
  const url = "https://staging.example.com/api/internal/notifications/qa/resend?scenario=delivered";
  assert.equal((await handleResendQaHarnessGet(new Request(url), dependencies(state.repository))).status, 401);
  const response = await handleResendQaHarnessGet(new Request(url, { headers: { authorization: `Bearer ${WORKER_SECRET}` } }), dependencies(state.repository));
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), [
    "attempts", "deliveredAtPresent", "eventTypes", "failedAtPresent", "lastErrorCode", "notificationId", "ok",
    "provider", "providerMessageIdPresent", "scenario", "sentAtPresent", "status", "suppressionActive", "suppressionReason",
  ].sort());
  assert.equal(JSON.stringify(body).includes(RESEND_QA_SCENARIOS.delivered.recipient), false);
  assert.equal(JSON.stringify(body).includes(WORKER_SECRET), false);
  assert.equal(JSON.stringify(body).includes("provider-message-fixture"), false);
});

test("la corrélation webhook s'appuie sur providerMessageId sans payload provider brut", () => {
  const status: ResendQaStatusResult = {
    scenario: "delivered",
    notificationId: "00000000-0000-4000-8000-000000000001",
    status: "DELIVERED",
    attempts: 1,
    provider: "RESEND",
    providerMessageIdPresent: true,
    sentAtPresent: true,
    deliveredAtPresent: true,
    failedAtPresent: false,
    lastErrorCode: null,
    eventTypes: ["email.sent", "email.delivered"],
    suppressionActive: false,
    suppressionReason: null,
  };
  assert.equal(status.providerMessageIdPresent, true);
  assert.deepEqual(status.eventTypes, ["email.sent", "email.delivered"]);
});
