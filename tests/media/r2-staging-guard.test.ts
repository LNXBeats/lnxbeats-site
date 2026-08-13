import assert from "node:assert/strict";
import test from "node:test";

import {
  assertR2StagingEnvironment,
  r2StagingAnonymousPublicObjectUrl,
  R2_STAGING_CONFIRMATION,
  R2_STAGING_PRIVATE_BUCKET,
  R2_STAGING_PUBLIC_BUCKET,
} from "@/lib/media/r2-staging-guard";

const valid = {
  MEDIA_R2_STAGING_CONFIRM: R2_STAGING_CONFIRMATION,
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
};

test("the R2 live canary accepts only its explicit staging configuration", () => {
  const result = assertR2StagingEnvironment(valid);
  assert.equal(result.publicBucket, R2_STAGING_PUBLIC_BUCKET);
  assert.equal(result.privateBucket, R2_STAGING_PRIVATE_BUCKET);

  for (const mutation of [
    { MEDIA_R2_STAGING_CONFIRM: undefined },
    { MEDIA_DEPLOYMENT_ENV: "production" },
    { MEDIA_STORAGE_DRIVER: "local" },
    { MEDIA_STORAGE_PROVIDER: "s3" },
    { MEDIA_PUBLIC_BUCKET: "lnx-studio-production-public" },
    { MEDIA_PRIVATE_BUCKET: "lnx-studio-production-private" },
    { MEDIA_S3_ENDPOINT: "https://example.invalid" },
    { MEDIA_S3_FORCE_PATH_STYLE: "true" },
    { RAILWAY_ENVIRONMENT: "production" },
  ]) {
    assert.throws(() => assertR2StagingEnvironment({ ...valid, ...mutation }));
  }
});

test("the anonymous public staging probe targets only a valid canary key without a signature", () => {
  const key = "catalog/images/123e4567-e89b-42d3-a456-426614174000.webp";
  const url = r2StagingAnonymousPublicObjectUrl(valid.MEDIA_S3_ENDPOINT, key);
  assert.equal(
    url.toString(),
    `https://${R2_STAGING_PUBLIC_BUCKET}.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/${key}`,
  );
  assert.equal(url.search, "");
  assert.throws(() => r2StagingAnonymousPublicObjectUrl(valid.MEDIA_S3_ENDPOINT, "orders/not-public.webp"));
  assert.throws(() => r2StagingAnonymousPublicObjectUrl("https://example.invalid", key));
});
