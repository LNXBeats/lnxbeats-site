import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("email provider selection accepts only capture and resend", () => {
  assert.equal(configuredEmailProvider({ EMAIL_PROVIDER: "capture" }), "capture");
  assert.equal(configuredEmailProvider({ EMAIL_PROVIDER: " RESEND " }), "resend");
  assert.throws(() => configuredEmailProvider({ EMAIL_PROVIDER: "smtp" }));
  assert.throws(() => configuredEmailProvider({}));
});

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
