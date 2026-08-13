import assert from "node:assert/strict";
import test from "node:test";

import {
  assertR2StagingRuntimeEnvironment,
  R2_STAGING_RUNTIME_CONFIRMATION,
} from "@/lib/media/r2-staging-runtime-guard";
import {
  R2_STAGING_CONFIRMATION,
  R2_STAGING_PRIVATE_BUCKET,
  R2_STAGING_PUBLIC_BUCKET,
} from "@/lib/media/r2-staging-guard";

const valid = {
  NODE_ENV: "test",
  EMAIL_PROVIDER: "capture",
  MEDIA_R2_STAGING_CONFIRM: R2_STAGING_CONFIRMATION,
  MEDIA_R2_STAGING_RUNTIME_CONFIRM: R2_STAGING_RUNTIME_CONFIRMATION,
  MEDIA_DEPLOYMENT_ENV: "staging",
  MEDIA_STORAGE_DRIVER: "s3",
  MEDIA_STORAGE_PROVIDER: "r2",
  MEDIA_S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  MEDIA_S3_REGION: "auto",
  MEDIA_S3_ACCESS_KEY_ID: "staging-access-key-fixture",
  MEDIA_S3_SECRET_ACCESS_KEY: "staging-secret-key-fixture",
  MEDIA_PUBLIC_BUCKET: R2_STAGING_PUBLIC_BUCKET,
  MEDIA_PRIVATE_BUCKET: R2_STAGING_PRIVATE_BUCKET,
  MEDIA_S3_FORCE_PATH_STYLE: "false",
  LNX_DATABASE_TARGET: "lnx-studio-r2-staging-test",
  DATABASE_URL: "postgresql://qa:fixture@127.0.0.1:59431/lnx_studio_test",
  LNX_PRISMA_DEV_SERVER_FILE: "/private/tmp/lnx-studio-r2-staging-test/server.json",
  AUTH_URL: "http://127.0.0.1:39173",
  AUTH_SECRET: "fixture-auth-secret-at-least-32-characters",
  LNX_AUTH_QA_PASSWORD: "fixture-password",
};

test("the R2 runtime QA accepts only its doubly confirmed disposable staging configuration", () => {
  const result = assertR2StagingRuntimeEnvironment(valid);
  assert.equal(result.databaseTarget, "lnx-studio-r2-staging-test");
  assert.equal(result.baseUrl, "http://127.0.0.1:39173");

  for (const mutation of [
    { MEDIA_R2_STAGING_RUNTIME_CONFIRM: undefined },
    { NODE_ENV: "production" },
    { EMAIL_PROVIDER: "resend" },
    { LNX_DATABASE_TARGET: "lnx-studio-local-preview" },
    { LNX_DATABASE_TARGET: "lnx-studio-staging" },
    { DATABASE_URL: "postgresql://qa:fixture@db.example.invalid:5432/lnx_studio" },
    { DATABASE_URL: "postgresql://qa:fixture@127.0.0.1:5432/lnx_studio_test" },
    { DATABASE_URL: "postgresql://qa:fixture@127.0.0.1:59431/lnx_studio_test?host=db.example.invalid" },
    { DATABASE_URL: "postgresql://qa:fixture@127.0.0.1:59431/lnx_studio_test?port=5432" },
    { AUTH_URL: "http://127.0.0.1:3000" },
    { AUTH_URL: "https://staging.example.invalid:39173" },
    { AUTH_SECRET: "short" },
    { LNX_AUTH_QA_PASSWORD: "short" },
  ]) {
    assert.throws(() => assertR2StagingRuntimeEnvironment({ ...valid, ...mutation }));
  }
});
