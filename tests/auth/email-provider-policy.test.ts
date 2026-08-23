import assert from "node:assert/strict";
import test from "node:test";

import {
  assertResendAuthDelivery,
  authEmailIdempotencyKey,
  assertResendPreviewDelivery,
  configuredEmailProvider,
  RESEND_PREVIEW_FROM,
  RESEND_PREVIEW_REPLY_TO,
} from "@/lib/email/provider-policy";

const approvedInput = {
  apiKey: "configured-without-using-a-real-secret",
  environment: {
    EMAIL_PROVIDER: "resend",
    LNX_DATABASE_TARGET: "lnx-studio-local-preview",
    NODE_ENV: "production",
  },
  from: RESEND_PREVIEW_FROM,
  idempotencyKey: "registration-code/00000000-0000-4000-8000-000000000000",
  isPersistentLocalPreview: true,
  kind: "registration-code" as const,
  replyTo: RESEND_PREVIEW_REPLY_TO,
  to: RESEND_PREVIEW_REPLY_TO,
};

test("email provider selection accepts only disabled, capture and resend", () => {
  assert.equal(configuredEmailProvider({ EMAIL_PROVIDER: "disabled" }), "disabled");
  assert.equal(configuredEmailProvider({ EMAIL_PROVIDER: "capture" }), "capture");
  assert.equal(configuredEmailProvider({ EMAIL_PROVIDER: " RESEND " }), "resend");
  assert.throws(() => configuredEmailProvider({ EMAIL_PROVIDER: "smtp" }));
  assert.throws(() => configuredEmailProvider({}));
});

const productionEnvironment = {
  NODE_ENV: "production",
  RAILWAY_ENVIRONMENT_NAME: "production",
  NOTIFICATION_DEPLOYMENT_ENV: "production",
  NOTIFICATION_EMAIL_TRANSPORT: "resend",
  EMAIL_NOTIFICATIONS_ENABLED: "true",
  OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
  CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
  NOTIFICATION_WORKER_ENABLED: "true",
  NOTIFICATION_PRODUCTION_CONFIRM: "I_UNDERSTAND_THIS_ENABLES_PRODUCTION_EMAILS",
  NOTIFICATION_WORKER_SECRET: "w".repeat(32),
  RESEND_API_KEY: `re_${"a".repeat(32)}`,
  RESEND_WEBHOOK_SECRET: `whsec_${"b".repeat(32)}`,
  EMAIL_FROM: "LNX Beats <notifications@mail.lnxbeats.fr>",
  EMAIL_REPLY_TO: "support@lnxbeats.fr",
  EMAIL_OWNER_RECIPIENT: "owner@lnxbeats.fr",
  APP_CANONICAL_URL: "https://lnxbeats.fr",
  AUTH_URL: "https://lnxbeats.fr",
  SMS_TRANSPORT: "disabled",
  SMS_NOTIFICATIONS_ENABLED: "false",
};

test("Resend is accepted only for the approved persistent preview", () => {
  assert.doesNotThrow(() => assertResendPreviewDelivery(approvedInput));
  assert.throws(() => assertResendPreviewDelivery({
    ...approvedInput,
    isPersistentLocalPreview: false,
  }));
  assert.throws(() => assertResendPreviewDelivery({
    ...approvedInput,
    environment: { ...approvedInput.environment, NODE_ENV: "test" },
  }));
  assert.throws(() => assertResendPreviewDelivery({
    ...approvedInput,
    environment: { ...approvedInput.environment, LNX_DATABASE_TARGET: "lnx-studio-v062-auth-test" },
  }));
});

test("Resend refuses QA recipients, foreign recipients and invalid configuration", () => {
  assert.throws(() => assertResendPreviewDelivery({
    ...approvedInput,
    to: "qa@example.invalid",
  }));
  assert.throws(() => assertResendPreviewDelivery({
    ...approvedInput,
    to: "another-person@gmail.com",
  }));
  assert.throws(() => assertResendPreviewDelivery({
    ...approvedInput,
    apiKey: "",
  }));
  assert.throws(() => assertResendPreviewDelivery({
    ...approvedInput,
    from: "LNX Beats <no-reply@lnxbeats.fr>",
  }));
  assert.throws(() => assertResendPreviewDelivery({
    ...approvedInput,
    replyTo: "support@example.invalid",
  }));
});

test("registration delivery requires a bounded provider idempotency key", () => {
  assert.throws(() => assertResendPreviewDelivery({
    ...approvedInput,
    idempotencyKey: undefined,
  }));
  assert.throws(() => assertResendPreviewDelivery({
    ...approvedInput,
    idempotencyKey: "x".repeat(257),
  }));
  assert.throws(() => assertResendPreviewDelivery({
    ...approvedInput,
    idempotencyKey: "registration code with spaces",
  }));
});

test("les e-mails auth production réutilisent exactement les gardes notifications", () => {
  const input = {
    apiKey: productionEnvironment.RESEND_API_KEY,
    environment: productionEnvironment,
    from: productionEnvironment.EMAIL_FROM,
    idempotencyKey: "auth-verification/fixture",
    isPersistentLocalPreview: false,
    kind: "verification" as const,
    replyTo: productionEnvironment.EMAIL_REPLY_TO,
    to: "member@example.com",
  };
  assert.doesNotThrow(() => assertResendAuthDelivery(input));
  assert.throws(() => assertResendAuthDelivery({
    ...input,
    environment: { ...productionEnvironment, CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false" },
  }));
  assert.throws(() => assertResendAuthDelivery({ ...input, to: "qa@example.invalid" }));
  assert.throws(() => assertResendAuthDelivery({ ...input, to: "delivered@resend.dev" }));
  assert.throws(() => assertResendAuthDelivery({
    ...input,
    environment: { ...productionEnvironment, AUTH_URL: "https://other.lnxbeats.fr" },
  }));
});

test("les clés auth sont déterministes, bornées et ne révèlent jamais le token", () => {
  const token = "secret-token-that-must-not-appear-anywhere";
  const verification = authEmailIdempotencyKey("verification", token);
  const reset = authEmailIdempotencyKey("password-reset", token);
  assert.equal(verification, authEmailIdempotencyKey("verification", token));
  assert.notEqual(verification, reset);
  assert.equal(verification.length <= 256, true);
  assert.doesNotMatch(verification, /secret-token/);
  assert.match(verification, /^auth-verification\/[a-f0-9]{64}$/);
});
