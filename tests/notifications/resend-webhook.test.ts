import assert from "node:assert/strict";
import test from "node:test";

import { handleResendWebhookPost, type ResendWebhookRouteDependencies } from "@/lib/notifications/resend-webhook-route-handler";

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
    headers: { "svix-id": "msg_webhook_01", "svix-timestamp": "1787300000", "svix-signature": "v1,fixture", ...overrides },
    body,
  });
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
  assert.equal((await handleResendWebhookPost(new Request("https://staging.example.com", { method: "POST", body: "x" }), dependencies)).status, 400);
  assert.equal(mutations, 0);
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
    providerMessageId: "email_01", recipient: "Client@Example.com", suppressionOrigin: "complaint",
  });
});
