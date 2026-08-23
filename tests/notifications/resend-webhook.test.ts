import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  handleResendWebhookPost,
  verifyResendWebhookSignature,
  type ResendWebhookRouteDependencies,
} from "@/lib/notifications/resend-webhook-route-handler";
import {
  applyResendWebhookNotificationEvent,
  resendWebhookNotificationUpdate,
  unmatchedResendWebhookEventCode,
  type VerifiedResendWebhookEvent,
} from "@/lib/notifications/resend-webhook";

const saved = { ...process.env };

function configure() {
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  process.env.NOTIFICATION_DEPLOYMENT_ENV = "staging";
  process.env.NOTIFICATION_EMAIL_TRANSPORT = "resend";
  process.env.NOTIFICATION_STAGING_CONFIRM = "resend-staging-approved";
  process.env.EMAIL_NOTIFICATIONS_ENABLED = "true";
  process.env.OWNER_EMAIL_NOTIFICATIONS_ENABLED = "true";
  process.env.CLIENT_EMAIL_NOTIFICATIONS_ENABLED = "true";
  process.env.RESEND_API_KEY = "re_" + "fixture".repeat(6);
  process.env.RESEND_WEBHOOK_SECRET = "wh" + "sec_" + "fixture".repeat(6);
  process.env.EMAIL_FROM = "LNX Beats <notifications@mail.example.com>";
  process.env.EMAIL_REPLY_TO = "reply@example.com";
  process.env.EMAIL_OWNER_RECIPIENT = "owner@example.com";
  process.env.APP_CANONICAL_URL = "https://staging.example.com";
}

function request(body = "signed-body", overrides: Record<string, string> = {}) {
  return new Request("https://staging.example.com/api/notifications/resend/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": "msg_webhook_01",
      "svix-timestamp": "1787300000",
      "svix-signature": "v1,fixture",
      ...overrides,
    },
    body,
  });
}

function event(overrides: Partial<VerifiedResendWebhookEvent> = {}): VerifiedResendWebhookEvent {
  return {
    providerEventId: "msg_webhook_01",
    type: "email.delivered",
    occurredAt: new Date("2026-08-21T12:00:00.000Z"),
    providerMessageId: "email_01",
    recipient: "client@example.com",
    suppressionOrigin: null,
    bounceType: null,
    bounceSubType: null,
    deploymentEnvironment: "staging",
    ...overrides,
  };
}

test.afterEach(() => {
  for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
  Object.assign(process.env, saved);
});

test("le webhook vérifie le corps brut puis traite une livraison", async () => {
  configure();
  let verifiedBody = "";
  let processedType = "";
  const dependencies: ResendWebhookRouteDependencies = {
    verify(input) {
      verifiedBody = input.payload;
      assert.equal(input.secret, process.env.RESEND_WEBHOOK_SECRET);
      return { type: "email.delivered", created_at: "2026-08-21T12:00:00.000Z", data: { email_id: "email_01", to: ["client@example.com"] } };
    },
    async process(event) { processedType = event.type; return { outcome: "PROCESSED", duplicate: false }; },
  };
  const response = await handleResendWebhookPost(request(), dependencies);
  assert.equal(response.status, 200);
  assert.equal(verifiedBody, "signed-body");
  assert.equal(processedType, "email.delivered");
  assert.deepEqual(await response.json(), { ok: true, outcome: "PROCESSED", duplicate: false });
});

test("signature absente ou invalide ne produit aucune mutation", async () => {
  configure();
  let mutations = 0;
  const dependencies: ResendWebhookRouteDependencies = {
    verify() { throw new Error("invalid signature"); },
    async process() { mutations += 1; return { outcome: "PROCESSED", duplicate: false }; },
  };
  assert.equal((await handleResendWebhookPost(request(), dependencies)).status, 400);
  assert.equal((await handleResendWebhookPost(new Request("https://staging.example.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "x",
  }), dependencies)).status, 400);
  assert.equal(mutations, 0);
});

test("la signature Standard Webhooks réelle est vérifiée par l'adaptateur Resend", async () => {
  configure();
  const secretBytes = Buffer.alloc(32, 7);
  const secret = `whsec_${secretBytes.toString("base64")}`;
  process.env.RESEND_WEBHOOK_SECRET = secret;
  const body = JSON.stringify({
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: { email_id: "email_signed_01", to: ["client@example.com"] },
  });
  const id = "msg_signed_01";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = `v1,${createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
  let processed = 0;
  const dependencies: ResendWebhookRouteDependencies = {
    verify: verifyResendWebhookSignature,
    async process() { processed += 1; return { outcome: "PROCESSED", duplicate: false }; },
  };
  const signedRequest = (value: string) => request(body, {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": value,
  });
  assert.equal((await handleResendWebhookPost(signedRequest(signature), dependencies)).status, 200);
  assert.equal(processed, 1);
  assert.equal((await handleResendWebhookPost(signedRequest(`${signature}invalid`), dependencies)).status, 400);
  assert.equal(processed, 1);
});

test("un body trop gros est refusé avant vérification", async () => {
  configure();
  let verified = 0;
  const dependencies: ResendWebhookRouteDependencies = {
    verify() { verified += 1; return {}; },
    async process() { return { outcome: "PROCESSED", duplicate: false }; },
  };
  const response = await handleResendWebhookPost(request("x".repeat(256 * 1024 + 1)), dependencies);
  assert.equal(response.status, 413);
  assert.equal(verified, 0);
});

test("une panne PostgreSQL répond 500 afin que Resend retente", async () => {
  configure();
  const dependencies: ResendWebhookRouteDependencies = {
    verify() { return { type: "email.bounced", created_at: "2026-08-21T12:00:00.000Z", data: { email_id: "email_01", to: ["bounced@resend.dev"] } }; },
    async process() { throw new Error("database unavailable"); },
  };
  assert.equal((await handleResendWebhookPost(request(), dependencies)).status, 500);
});

test("un événement suppression normalise la destination et la source", async () => {
  configure();
  let snapshot: unknown;
  const dependencies: ResendWebhookRouteDependencies = {
    verify() { return { type: "suppression.added", created_at: "2026-08-21T12:00:00.000Z", data: { email: "Client@Example.com", origin: "complaint", source_id: "email_01" } }; },
    async process(event) { snapshot = event; return { outcome: "PROCESSED", duplicate: true }; },
  };
  const response = await handleResendWebhookPost(request(), dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(snapshot, {
    providerEventId: "msg_webhook_01", type: "suppression.added", occurredAt: new Date("2026-08-21T12:00:00.000Z"),
    providerMessageId: "email_01", recipient: "client@example.com", suppressionOrigin: "complaint",
    bounceType: null, bounceSubType: null, deploymentEnvironment: "staging",
  });
});

test("un événement Resend QA conserve le providerMessageId nécessaire à la corrélation", async () => {
  configure();
  let snapshot: unknown;
  const dependencies: ResendWebhookRouteDependencies = {
    verify() {
      return {
        type: "email.delivered",
        created_at: "2026-08-21T12:00:00.000Z",
        data: { email_id: "email_resend_qa_01", to: ["delivered+lnx-v073-qa-01@resend.dev"] },
      };
    },
    async process(event) { snapshot = event; return { outcome: "PROCESSED", duplicate: false }; },
  };
  assert.equal((await handleResendWebhookPost(request(), dependencies)).status, 200);
  assert.deepEqual(snapshot, {
    providerEventId: "msg_webhook_01",
    type: "email.delivered",
    occurredAt: new Date("2026-08-21T12:00:00.000Z"),
    providerMessageId: "email_resend_qa_01",
    recipient: "delivered+lnx-v073-qa-01@resend.dev",
    suppressionOrigin: null,
    bounceType: null,
    bounceSubType: null,
    deploymentEnvironment: "staging",
  });
});

test("le webhook reste disponible avec le transport sortant désactivé", async () => {
  configure();
  process.env.NOTIFICATION_EMAIL_TRANSPORT = "disabled";
  process.env.EMAIL_NOTIFICATIONS_ENABLED = "false";
  process.env.OWNER_EMAIL_NOTIFICATIONS_ENABLED = "false";
  process.env.CLIENT_EMAIL_NOTIFICATIONS_ENABLED = "false";
  delete process.env.NOTIFICATION_STAGING_CONFIRM;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_REPLY_TO;
  delete process.env.EMAIL_OWNER_RECIPIENT;
  delete process.env.APP_CANONICAL_URL;
  let processed = 0;
  const dependencies: ResendWebhookRouteDependencies = {
    verify() {
      return { type: "email.delivered", created_at: "2026-08-21T12:00:00.000Z", data: { email_id: "email_01", to: ["client@example.com"] } };
    },
    async process() { processed += 1; return { outcome: "PROCESSED", duplicate: false }; },
  };
  assert.equal((await handleResendWebhookPost(request(), dependencies)).status, 200);
  assert.equal(processed, 1);
});

test("le webhook exige JSON et borne les identifiants avant toute mutation", async () => {
  configure();
  let verified = 0;
  const dependencies: ResendWebhookRouteDependencies = {
    verify() { verified += 1; return {}; },
    async process() { throw new Error("must not run"); },
  };
  assert.equal((await handleResendWebhookPost(request("signed", { "content-type": "text/plain" }), dependencies)).status, 400);
  assert.equal((await handleResendWebhookPost(request("signed", { "svix-id": "x".repeat(256) }), dependencies)).status, 400);
  assert.equal(verified, 0);
});

test("les champs vérifiés restent bornés et un bounce officiel est normalisé", async () => {
  configure();
  let snapshot: VerifiedResendWebhookEvent | undefined;
  const dependencies: ResendWebhookRouteDependencies = {
    verify() {
      return {
        type: "email.bounced",
        created_at: "2026-08-21T12:00:00.000Z",
        data: {
          email_id: "email_01",
          to: ["Client@Example.com"],
          bounce: { type: "Permanent", subType: "General" },
        },
      };
    },
    async process(value) { snapshot = value; return { outcome: "PROCESSED", duplicate: false }; },
  };
  assert.equal((await handleResendWebhookPost(request(), dependencies)).status, 200);
  assert.equal(snapshot?.bounceType, "Permanent");
  assert.equal(snapshot?.bounceSubType, "General");
  assert.equal(snapshot?.recipient, "client@example.com");

  const oversizedDependencies: ResendWebhookRouteDependencies = {
    ...dependencies,
    verify: () => ({
      type: "email.bounced",
      created_at: "2026-08-21T12:00:00.000Z",
      data: { email_id: "x".repeat(256), to: ["client@example.com"] },
    }),
  };
  assert.equal((await handleResendWebhookPost(request(), oversizedDependencies)).status, 400);
});

test("les transitions webhook ne régressent jamais un état terminal", () => {
  const delivered = { status: "DELIVERED", sentAt: new Date(), deliveredAt: new Date(), failedAt: null, lastErrorCode: null } as const;
  assert.equal(resendWebhookNotificationUpdate(delivered, event({ type: "email.sent" })), null);
  assert.equal(resendWebhookNotificationUpdate(delivered, event({ type: "email.failed" })), null);

  const complained = { status: "COMPLAINED", sentAt: new Date(), deliveredAt: new Date(), failedAt: new Date(), lastErrorCode: "COMPLAINT" } as const;
  assert.equal(resendWebhookNotificationUpdate(complained, event({ type: "email.delivered" })), null);
  assert.equal(resendWebhookNotificationUpdate(complained, event({ type: "email.bounced", bounceType: "Permanent" })), null);
});

test("un bounce permanent et un bounce transitoire restent distincts", () => {
  const sent = { status: "SENT", sentAt: new Date(), deliveredAt: null, failedAt: null, lastErrorCode: null } as const;
  const permanent = resendWebhookNotificationUpdate(sent, event({ type: "email.bounced", bounceType: "Permanent" }));
  const transient = resendWebhookNotificationUpdate(sent, event({ type: "email.bounced", bounceType: "Transient" }));
  assert.equal(permanent?.lastErrorCode, "BOUNCE_PERMANENT");
  assert.equal(transient?.lastErrorCode, "BOUNCE_TRANSIENT");
  assert.equal(permanent?.status, "BOUNCED");
  assert.equal(transient?.status, "BOUNCED");
});

test("un delivered ultérieur réconcilie uniquement un bounce non permanent", () => {
  const bounceAt = new Date("2026-08-21T12:00:00.000Z");
  const transient = {
    status: "BOUNCED", sentAt: bounceAt, deliveredAt: null, failedAt: bounceAt, lastErrorCode: "BOUNCE_TRANSIENT",
  } as const;
  const permanent = { ...transient, lastErrorCode: "BOUNCE_PERMANENT" } as const;
  const delivered = event({ type: "email.delivered", occurredAt: new Date("2026-08-21T12:01:00.000Z") });
  assert.equal(resendWebhookNotificationUpdate(transient, delivered)?.status, "DELIVERED");
  assert.equal(resendWebhookNotificationUpdate(permanent, delivered), null);
  assert.equal(resendWebhookNotificationUpdate(transient, event({
    type: "email.delivered",
    occurredAt: new Date("2026-08-21T11:59:00.000Z"),
  })), null);
});

test("tous les événements de message précoces ont une transition déterministe", () => {
  const initial = {
    status: "PROCESSING", sentAt: null, deliveredAt: null, failedAt: null, lastErrorCode: null, lastErrorMessage: null,
  } as const;
  const cases = [
    ["email.sent", "SENT", null],
    ["email.delivered", "DELIVERED", null],
    ["email.delivery_delayed", "PROCESSING", null],
    ["email.bounced", "BOUNCED", "BOUNCE_PERMANENT"],
    ["email.complained", "COMPLAINED", "COMPLAINT"],
    ["email.failed", "FAILED_FINAL", "PROVIDER_DELIVERY_FAILED"],
    ["email.suppressed", "SUPPRESSED", "PROVIDER_SUPPRESSED"],
  ] as const;
  for (const [type, expectedStatus, expectedError] of cases) {
    const applied = applyResendWebhookNotificationEvent(initial, event({
      type,
      bounceType: type === "email.bounced" ? "Permanent" : null,
    }));
    assert.equal(applied.outcome, "PROCESSED", type);
    assert.equal(applied.notification.status, expectedStatus, type);
    assert.equal(applied.notification.lastErrorCode, expectedError, type);
  }
});

test("la preuve d'un événement précoce lie environnement, type et destinataire", () => {
  const early = event({ type: "email.failed", deploymentEnvironment: "production" });
  const expected = unmatchedResendWebhookEventCode(early, "client@example.com");
  assert.match(expected, /^UNMATCHED_PRODUCTION_EMAIL_FAILED_[a-f0-9]{16}$/);
  assert.notEqual(expected, unmatchedResendWebhookEventCode(early, "other@example.com"));
  assert.notEqual(expected, unmatchedResendWebhookEventCode({ ...early, deploymentEnvironment: "staging" }, "client@example.com"));
});

test("toute sortie de PROCESSING libère le lease et respecte les timestamps terminaux", () => {
  const processing = { status: "PROCESSING", sentAt: null, deliveredAt: null, failedAt: null, lastErrorCode: null } as const;
  const delivered = resendWebhookNotificationUpdate(processing, event({ type: "email.delivered" }));
  assert.equal(delivered?.processingStartedAt, null);
  assert.equal(delivered?.leaseExpiresAt, null);
  assert.ok(delivered?.sentAt);
  assert.ok(delivered?.deliveredAt);

  const complained = resendWebhookNotificationUpdate(processing, event({ type: "email.complained" }));
  assert.equal(complained?.processingStartedAt, null);
  assert.equal(complained?.leaseExpiresAt, null);
  assert.ok(complained?.sentAt);
  assert.ok(complained?.deliveredAt);
  assert.ok(complained?.failedAt);
});
