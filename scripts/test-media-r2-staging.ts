import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import {
  assertR2StagingEnvironment,
  r2StagingAnonymousPublicObjectUrl,
} from "@/lib/media/r2-staging-guard";
import { S3MediaStorage } from "@/lib/media/storage/s3";
import { MediaStorageError, type MediaScope } from "@/lib/media/storage/types";

const OPERATION_TIMEOUT_MS = 30_000;
const SIGNED_URL_TTL_SECONDS = 30;
const SIGNED_URL_EXPIRY_GRACE_SECONDS = 3;

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canaryBytes() {
  return Buffer.from(Array.from({ length: 4_096 }, (_, index) => (index * 37 + 19) % 251));
}

async function within<T>(label: string, operation: Promise<T>, timeoutMs = OPERATION_TIMEOUT_MS) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} exceeded the staging timeout.`)), timeoutMs);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function bytesFrom(stream: ReadableStream<Uint8Array>, label: string) {
  return Buffer.from(await within(label, new Response(stream).arrayBuffer()));
}

async function verifyObject(storage: S3MediaStorage, scope: MediaScope, key: string, expected: Buffer) {
  const checksumSha256 = sha256(expected);
  const metadata = await within(`${scope} PUT`, storage.put({
    scope,
    key,
    body: expected,
    contentLength: expected.length,
    contentType: "application/octet-stream",
    checksumSha256,
  }));
  assert.equal(metadata.contentLength, expected.length);
  assert.equal(metadata.checksumSha256, checksumSha256);

  const head = await within(`${scope} HEAD`, storage.head({ scope, key }));
  assert.equal(head.contentLength, expected.length);
  assert.equal(head.checksumSha256, checksumSha256);

  const full = await within(`${scope} GET`, storage.get({ scope, key }));
  assert.equal(full.contentLength, expected.length);
  assert.deepEqual(await bytesFrom(full.body, `${scope} GET body`), expected);

  for (const [start, end] of [[0, 1_023], [1_024, 2_047], [expected.length - 512, expected.length - 1]] as const) {
    const ranged = await within(`${scope} Range ${start}-${end}`, storage.get({ scope, key, range: { start, end } }));
    assert.equal(ranged.contentLength, end - start + 1);
    assert.deepEqual(await bytesFrom(ranged.body, `${scope} Range body`), expected.subarray(start, end + 1));
  }
}

function signedExpiry(url: URL) {
  for (const [name, value] of url.searchParams) {
    if (name.toLowerCase() === "x-amz-expires") return value;
  }
  return null;
}

async function verifySignedPrivateGet(storage: S3MediaStorage, key: string, expected: Buffer) {
  const signedValue = await within("private signed URL", storage.createSignedUrl({
    scope: "private",
    key,
    operation: "get",
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    downloadFilename: "r2-staging-canary.bin",
  }));
  assert.ok(signedValue, "R2 staging must return a signed private GET URL.");
  const signed = new URL(signedValue);
  assert.equal(signed.protocol, "https:");
  assert.equal(signedExpiry(signed), String(SIGNED_URL_TTL_SECONDS));

  const signedResponse = await fetch(signed, {
    redirect: "error",
    signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
  });
  assert.equal(signedResponse.status, 200, "The signed private GET must succeed.");
  assert.deepEqual(Buffer.from(await signedResponse.arrayBuffer()), expected);
  assert.match(signedResponse.headers.get("cache-control") ?? "", /private/i);
  assert.match(signedResponse.headers.get("cache-control") ?? "", /no-store/i);

  const unsigned = new URL(signed);
  unsigned.search = "";
  unsigned.hash = "";
  const unsignedResponse = await fetch(unsigned, {
    redirect: "manual",
    signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
  });
  assert.ok(
    unsignedResponse.status >= 400 && unsignedResponse.status < 500,
    "The same private R2 object must be refused without its signature.",
  );

  await new Promise((resolve) => setTimeout(
    resolve,
    (SIGNED_URL_TTL_SECONDS + SIGNED_URL_EXPIRY_GRACE_SECONDS) * 1_000,
  ));
  const expiredResponse = await fetch(signed, {
    redirect: "manual",
    signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
  });
  assert.ok(
    expiredResponse.status >= 400 && expiredResponse.status < 500,
    "The private R2 signed URL must be refused after its 30-second lifetime.",
  );
}

async function verifyAnonymousPublicGetRefused(endpoint: string, key: string) {
  const response = await fetch(r2StagingAnonymousPublicObjectUrl(endpoint, key), {
    redirect: "manual",
    signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
  });
  assert.ok(
    response.status >= 400 && response.status < 500,
    "The public staging bucket must refuse anonymous unsigned object access.",
  );
}

async function expectMissing(storage: S3MediaStorage, scope: MediaScope, key: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await within(`${scope} cleanup HEAD`, storage.head({ scope, key }));
    } catch (error) {
      if (error instanceof MediaStorageError && error.code === "NOT_FOUND") return;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (lastError) throw lastError;
  throw new Error(`${scope} R2 canary object still exists after cleanup.`);
}

async function run() {
  const configuration = assertR2StagingEnvironment(process.env);
  const storage = new S3MediaStorage({
    provider: "r2",
    region: "auto",
    endpoint: configuration.endpoint,
    accessKeyId: configuration.accessKeyId,
    secretAccessKey: configuration.secretAccessKey,
    publicBucket: configuration.publicBucket,
    privateBucket: configuration.privateBucket,
    forcePathStyle: false,
    operationTimeoutMs: OPERATION_TIMEOUT_MS,
  });
  const publicKey = `catalog/images/${randomUUID()}.webp`;
  const privateKey = `orders/${randomUUID()}/${randomUUID()}.webp`;
  const expected = canaryBytes();

  try {
    await verifyObject(storage, "public", publicKey, expected);
    await verifyObject(storage, "private", privateKey, expected);
    await verifyAnonymousPublicGetRefused(configuration.endpoint, publicKey);
    await verifySignedPrivateGet(storage, privateKey, expected);
    console.info("R2 staging canary passed: public/private PUT, HEAD, GET, three ranges, anonymous public refusal, signed private GET, unsigned private refusal and real 30-second expiry.");
  } finally {
    const cleanup = await Promise.allSettled([
      within("public cleanup DELETE", storage.delete({ scope: "public", key: publicKey })),
      within("private cleanup DELETE", storage.delete({ scope: "private", key: privateKey })),
    ]);
    const failure = cleanup.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    await expectMissing(storage, "public", publicKey);
    await expectMissing(storage, "private", privateKey);
  }
}

run().catch(() => {
  console.error("R2 staging canary failed; no provider detail was logged.");
  process.exitCode = 1;
});
