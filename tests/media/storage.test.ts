import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";

import { canReadOrderMedia } from "@/lib/media/authorization";
import { LocalMediaStorage } from "@/lib/media/storage/local";
import { assertMediaStorageKey, safeContentDisposition } from "@/lib/media/storage/policy";
import {
  S3MediaStorage,
  S3_MULTIPART_PART_SIZE_BYTES,
  S3_MULTIPART_QUEUE_SIZE,
} from "@/lib/media/storage/s3";
import { MediaStorageError } from "@/lib/media/storage/types";
import { validateMediaStorageConfiguration } from "@/lib/media/storage/config";

function checksum(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function repeatedBytes(size: number, chunkSize = 257 * 1024) {
  const chunk = Buffer.alloc(chunkSize, 0x6c);
  return Readable.from((async function* () {
    let remaining = size;
    while (remaining > 0) {
      const length = Math.min(remaining, chunk.length);
      yield chunk.subarray(0, length);
      remaining -= length;
    }
  })());
}

function repeatedBytesChecksum(size: number, chunkSize = 257 * 1024) {
  const hash = createHash("sha256");
  const chunk = Buffer.alloc(chunkSize, 0x6c);
  let remaining = size;
  while (remaining > 0) {
    const length = Math.min(remaining, chunk.length);
    hash.update(chunk.subarray(0, length));
    remaining -= length;
  }
  return hash.digest("hex");
}

function multipartClient(send: (command: unknown) => Promise<unknown>) {
  return {
    config: {
      requestChecksumCalculation: async () => "WHEN_REQUIRED",
      requestHandler: {},
      endpoint: async () => new URL("https://account.r2.cloudflarestorage.com"),
      forcePathStyle: false,
    },
    send,
  };
}

test("production media migration is additive and classifies catalogue assets as public", async () => {
  const sql = await readFile(path.join(process.cwd(), "prisma/migrations/20260813120000_production_media_foundation/migration.sql"), "utf8");
  assert.match(sql, /ADD COLUMN "storageBackend"/);
  assert.match(sql, /ADD COLUMN "storageProvider"/);
  assert.match(sql, /ADD COLUMN "visibility"/);
  assert.match(sql, /ADD COLUMN "checksumSha256"/);
  assert.match(sql, /role" IN \('COVER', 'AUDIO_PREVIEW'\)/);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN|TYPE)/i);
  assert.doesNotMatch(sql, /TRUNCATE|DELETE\s+FROM/i);
});

test("a staging, production or Railway environment refuses ephemeral local media storage", () => {
  const previous = {
    driver: process.env.MEDIA_STORAGE_DRIVER,
    deployment: process.env.MEDIA_DEPLOYMENT_ENV,
    railway: process.env.RAILWAY_ENVIRONMENT,
  };
  try {
    process.env.MEDIA_STORAGE_DRIVER = "local";
    process.env.MEDIA_DEPLOYMENT_ENV = "staging";
    delete process.env.RAILWAY_ENVIRONMENT;
    assert.throws(validateMediaStorageConfiguration, (error) => error instanceof MediaStorageError && error.code === "CONFIGURATION");

    process.env.MEDIA_DEPLOYMENT_ENV = " staging ";
    assert.throws(validateMediaStorageConfiguration, (error) => error instanceof MediaStorageError && error.code === "CONFIGURATION");

    process.env.MEDIA_DEPLOYMENT_ENV = "stagng";
    assert.throws(validateMediaStorageConfiguration, (error) => error instanceof MediaStorageError && error.code === "CONFIGURATION");

    process.env.MEDIA_DEPLOYMENT_ENV = "production";
    delete process.env.RAILWAY_ENVIRONMENT;
    assert.throws(validateMediaStorageConfiguration, (error) => error instanceof MediaStorageError && error.code === "CONFIGURATION");

    delete process.env.MEDIA_STORAGE_DRIVER;
    assert.throws(validateMediaStorageConfiguration, (error) => error instanceof MediaStorageError && error.code === "CONFIGURATION");

    process.env.MEDIA_STORAGE_DRIVER = " s3 ";
    assert.throws(validateMediaStorageConfiguration, (error) => error instanceof MediaStorageError && error.code === "CONFIGURATION");

    process.env.MEDIA_DEPLOYMENT_ENV = "local-preview";
    process.env.RAILWAY_ENVIRONMENT = "production";
    assert.throws(validateMediaStorageConfiguration, (error) => error instanceof MediaStorageError && error.code === "CONFIGURATION");
  } finally {
    if (previous.driver === undefined) delete process.env.MEDIA_STORAGE_DRIVER; else process.env.MEDIA_STORAGE_DRIVER = previous.driver;
    if (previous.deployment === undefined) delete process.env.MEDIA_DEPLOYMENT_ENV; else process.env.MEDIA_DEPLOYMENT_ENV = previous.deployment;
    if (previous.railway === undefined) delete process.env.RAILWAY_ENVIRONMENT; else process.env.RAILWAY_ENVIRONMENT = previous.railway;
  }
});

test("Cloudflare R2 configuration requires its canonical endpoint and environment-specific buckets", () => {
  const names = [
    "MEDIA_STORAGE_DRIVER",
    "MEDIA_DEPLOYMENT_ENV",
    "MEDIA_STORAGE_PROVIDER",
    "MEDIA_S3_ENDPOINT",
    "MEDIA_S3_REGION",
    "MEDIA_S3_ACCESS_KEY_ID",
    "MEDIA_S3_SECRET_ACCESS_KEY",
    "MEDIA_PUBLIC_BUCKET",
    "MEDIA_PRIVATE_BUCKET",
    "MEDIA_S3_FORCE_PATH_STYLE",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, {
      MEDIA_STORAGE_DRIVER: "s3",
      MEDIA_DEPLOYMENT_ENV: "staging",
      MEDIA_STORAGE_PROVIDER: "r2",
      MEDIA_S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
      MEDIA_S3_REGION: "auto",
      MEDIA_S3_ACCESS_KEY_ID: "test-access",
      MEDIA_S3_SECRET_ACCESS_KEY: "test-secret",
      MEDIA_PUBLIC_BUCKET: "lnx-studio-staging-public",
      MEDIA_PRIVATE_BUCKET: "lnx-studio-staging-private",
      MEDIA_S3_FORCE_PATH_STYLE: "false",
    });
    assert.deepEqual(validateMediaStorageConfiguration(), { backend: "OBJECT", provider: "r2" });

    process.env.MEDIA_STORAGE_PROVIDER = "minio";
    assert.throws(validateMediaStorageConfiguration, (error) => error instanceof MediaStorageError && error.code === "CONFIGURATION");
    process.env.MEDIA_STORAGE_PROVIDER = "r2";

    const invalidConfigurations = [
      ["MEDIA_S3_ENDPOINT", "http://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"],
      ["MEDIA_S3_ENDPOINT", "https://example.invalid"],
      ["MEDIA_STORAGE_PROVIDER", "R2"],
      ["MEDIA_S3_REGION", "us-east-1"],
      ["MEDIA_S3_FORCE_PATH_STYLE", "true"],
      ["MEDIA_S3_FORCE_PATH_STYLE", "1"],
      ["MEDIA_PUBLIC_BUCKET", "lnx-studio-production-public"],
      ["MEDIA_PRIVATE_BUCKET", "lnx-studio-production-private"],
      ["MEDIA_PUBLIC_BUCKET", "another-staging-public"],
      ["MEDIA_PRIVATE_BUCKET", "another-staging-private"],
      ["MEDIA_PUBLIC_BUCKET", "lnx-studio-staging-public-copy"],
      ["MEDIA_PRIVATE_BUCKET", "lnx-studio-staging-private-copy"],
    ] as const;
    for (const [name, value] of invalidConfigurations) {
      const validValue = process.env[name];
      process.env[name] = value;
      assert.throws(validateMediaStorageConfiguration, (error) => error instanceof MediaStorageError && error.code === "CONFIGURATION");
      process.env[name] = validValue;
    }
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("generic S3-compatible providers retain custom endpoint and path-style support", () => {
  const names = [
    "MEDIA_STORAGE_DRIVER",
    "MEDIA_DEPLOYMENT_ENV",
    "MEDIA_STORAGE_PROVIDER",
    "MEDIA_S3_ENDPOINT",
    "MEDIA_S3_REGION",
    "MEDIA_S3_ACCESS_KEY_ID",
    "MEDIA_S3_SECRET_ACCESS_KEY",
    "MEDIA_PUBLIC_BUCKET",
    "MEDIA_PRIVATE_BUCKET",
    "MEDIA_S3_FORCE_PATH_STYLE",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, {
      MEDIA_STORAGE_DRIVER: "s3",
      MEDIA_DEPLOYMENT_ENV: "test",
      MEDIA_STORAGE_PROVIDER: "minio",
      MEDIA_S3_ENDPOINT: "http://127.0.0.1:9000/storage",
      MEDIA_S3_REGION: "us-east-1",
      MEDIA_S3_ACCESS_KEY_ID: "test-access",
      MEDIA_S3_SECRET_ACCESS_KEY: "test-secret",
      MEDIA_PUBLIC_BUCKET: "public-test",
      MEDIA_PRIVATE_BUCKET: "private-test",
      MEDIA_S3_FORCE_PATH_STYLE: "true",
    });
    assert.deepEqual(validateMediaStorageConfiguration(), { backend: "OBJECT", provider: "minio" });
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("local media storage separates scopes, streams ranges, replaces and deletes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-media-local-"));
  const publicRoot = path.join(root, "public-store");
  const privateRoot = path.join(root, "private-store");
  const storage = new LocalMediaStorage({ publicRoot, privateRoot });
  const first = Buffer.from("0123456789");
  const key = "catalog/audio-previews/00000000-0000-4000-8000-000000000001.mp3";
  try {
    await storage.put({ scope: "public", key, body: first, contentLength: first.length, contentType: "audio/mpeg", checksumSha256: checksum(first) });
    assert.deepEqual(await readFile(path.join(publicRoot, key)), first);
    assert.equal((await storage.head({ scope: "public", key })).contentLength, first.length);
    const ranged = await storage.get({ scope: "public", key, range: { start: 2, end: 5 } });
    assert.equal(await new Response(ranged.body).text(), "2345");

    const replacement = Buffer.from("replacement");
    await storage.put({ scope: "public", key, body: replacement, contentLength: replacement.length, contentType: "audio/mpeg", checksumSha256: checksum(replacement) });
    assert.deepEqual(await readFile(path.join(publicRoot, key)), replacement);

    const privateKey = "orders/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.webp";
    const privateBytes = Buffer.from("private-reference");
    await storage.put({ scope: "private", key: privateKey, body: privateBytes, contentLength: privateBytes.length, contentType: "image/webp", checksumSha256: checksum(privateBytes) });
    assert.deepEqual(await readFile(path.join(privateRoot, privateKey)), privateBytes);
    await assert.rejects(storage.get({ scope: "public", key: privateKey }), MediaStorageError);

    await storage.delete({ scope: "public", key });
    await assert.rejects(storage.head({ scope: "public", key }), (error) => error instanceof MediaStorageError && error.code === "NOT_FOUND");
    assert.equal(await storage.createSignedUrl({ scope: "private", key: privateKey, operation: "get", expiresInSeconds: 60 }), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("storage key and Content-Disposition policies refuse traversal and header injection", () => {
  assert.doesNotThrow(() => assertMediaStorageKey("public", "catalog/covers/00000000-0000-4000-8000-000000000001.webp"));
  assert.doesNotThrow(() => assertMediaStorageKey("private", "orders/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.webp"));
  const privateDelivery = "orders/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000003.wav";
  assert.doesNotThrow(() => assertMediaStorageKey("private", privateDelivery));
  assert.throws(() => assertMediaStorageKey("public", privateDelivery), MediaStorageError);
  for (const key of ["../secret", "catalog/covers/cover.webp", "orders/id/../../secret", "catalog\\covers\\secret.webp"]) {
    assert.throws(() => assertMediaStorageKey("public", key), MediaStorageError);
    assert.throws(() => assertMediaStorageKey("private", key), MediaStorageError);
  }
  const header = safeContentDisposition("attachment", "evil\r\nX-Test: yes\".wav");
  assert.doesNotMatch(header, /[\r\n]/);
  assert.equal(header, "attachment; filename=\"evil--X-Test- yes-.wav\"");
});

test("central order media authorization blocks IDOR", () => {
  const member = { id: "member", email: "member@example.invalid", name: "Member", role: "MEMBER" as const, status: "ACTIVE" as const, emailVerified: true };
  assert.equal(canReadOrderMedia(member, "member"), true);
  assert.equal(canReadOrderMedia(member, "another"), false);
  assert.equal(canReadOrderMedia({ ...member, role: "ADMIN" }, "another"), true);
  assert.equal(canReadOrderMedia({ ...member, status: "SUSPENDED" as never }, "member"), false);
  assert.equal(canReadOrderMedia({ ...member, emailVerified: false }, "member"), false);
});

test("S3 adapter keeps buckets separate, verifies metadata, supports range, delete and short signed URLs", async () => {
  const calls: unknown[] = [];
  const data = Buffer.from("object-body");
  const fakeClient = {
    async send(command: unknown) {
      calls.push(command);
      if (command instanceof PutObjectCommand) return { ETag: "\"put-etag\"" };
      if (command instanceof HeadObjectCommand) return { ContentLength: data.length, ContentType: "audio/mpeg", ETag: "\"head-etag\"", Metadata: { sha256: checksum(data) }, LastModified: new Date(0) };
      if (command instanceof GetObjectCommand) return { Body: Readable.from([data]), ContentLength: data.length, ContentType: "audio/mpeg", ETag: "\"get-etag\"", Metadata: { sha256: checksum(data) } };
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error("Unexpected command");
    },
  };
  const signed: Array<{ command: unknown; expiresIn?: number }> = [];
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "test-access", secretAccessKey: "test-secret", publicBucket: "lnx-public-test", privateBucket: "lnx-private-test",
    client: fakeClient as never,
    signer: (async (_client: unknown, command: unknown, options: { expiresIn?: number } | undefined) => {
      signed.push({ command, expiresIn: options?.expiresIn });
      return "https://signed.example.invalid/object?redacted";
    }) as never,
  });
  const publicKey = "catalog/audio-previews/00000000-0000-4000-8000-000000000001.mp3";
  await storage.put({ scope: "public", key: publicKey, body: data, contentLength: data.length, contentType: "audio/mpeg", checksumSha256: checksum(data) });
  const put = calls[0] as PutObjectCommand;
  assert.equal(put.input.Bucket, "lnx-public-test");
  assert.equal(put.input.CacheControl, "public, max-age=31536000, immutable");
  const object = await storage.get({ scope: "public", key: publicKey, range: { start: 0, end: 3 } });
  assert.equal(await new Response(object.body).text(), data.toString());
  const get = calls.find((value) => value instanceof GetObjectCommand && value.input.Range) as GetObjectCommand;
  assert.equal(get.input.Range, "bytes=0-3");
  await storage.delete({ scope: "public", key: publicKey });

  const privateKey = "orders/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.webp";
  const url = await storage.createSignedUrl({ scope: "private", key: privateKey, operation: "get", expiresInSeconds: 60 });
  assert.equal(url, "https://signed.example.invalid/object?redacted");
  assert.equal(signed[0]?.expiresIn, 60);
  assert.equal((signed[0]?.command as GetObjectCommand).input.Bucket, "lnx-private-test");
  await assert.rejects(storage.createSignedUrl({ scope: "private", key: privateKey, operation: "get", expiresInSeconds: 3 }), MediaStorageError);
});

test("S3 adapter removes a newly uploaded object when provider verification fails", async () => {
  const calls: unknown[] = [];
  const data = Buffer.from("object-body");
  const fakeClient = {
    async send(command: unknown) {
      calls.push(command);
      if (command instanceof PutObjectCommand) return { ETag: "\"put-etag\"" };
      if (command instanceof HeadObjectCommand) return { ContentLength: data.length - 1 };
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error("Unexpected command");
    },
  };
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "test-access", secretAccessKey: "test-secret", publicBucket: "lnx-public-test", privateBucket: "lnx-private-test",
    client: fakeClient as never,
  });
  await assert.rejects(storage.put({
    scope: "public",
    key: "catalog/audio-previews/00000000-0000-4000-8000-000000000001.mp3",
    body: data,
    contentLength: data.length,
    contentType: "audio/mpeg",
    checksumSha256: checksum(data),
  }), (error) => error instanceof MediaStorageError && error.code === "INTEGRITY");
  assert.equal(calls.filter((call) => call instanceof DeleteObjectCommand).length, 1);
});

test("S3 adapter attempts compensating cleanup when a PUT response is lost", async () => {
  const calls: unknown[] = [];
  const data = Buffer.from("object-body");
  const fakeClient = {
    async send(command: unknown) {
      calls.push(command);
      if (command instanceof PutObjectCommand) throw new Error("Simulated response loss after provider acceptance");
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error("Unexpected command");
    },
  };
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "test-access", secretAccessKey: "test-secret", publicBucket: "lnx-public-test", privateBucket: "lnx-private-test",
    client: fakeClient as never,
  });
  await assert.rejects(storage.put({
    scope: "public",
    key: "catalog/audio-previews/00000000-0000-4000-8000-000000000001.mp3",
    body: data,
    contentLength: data.length,
    contentType: "audio/mpeg",
    checksumSha256: checksum(data),
  }), (error) => error instanceof MediaStorageError && error.code === "PROVIDER");
  assert.equal(calls.filter((call) => call instanceof PutObjectCommand).length, 1);
  assert.equal(calls.filter((call) => call instanceof DeleteObjectCommand).length, 1);
});

test("S3 adapter uploads a fragmented 60 MiB Readable with bounded managed multipart parts", { timeout: 30_000 }, async () => {
  const size = 60 * 1024 * 1024;
  const digest = repeatedBytesChecksum(size);
  const calls: unknown[] = [];
  const partSizes: number[] = [];
  const fakeClient = multipartClient(async (command) => {
    calls.push(command);
    if (command instanceof CreateMultipartUploadCommand) return { UploadId: "qa-upload-id" };
    if (command instanceof UploadPartCommand) {
      assert.ok(command.input.Body instanceof Uint8Array);
      partSizes.push(command.input.Body.byteLength);
      return { ETag: `\"part-${command.input.PartNumber}\"` };
    }
    if (command instanceof CompleteMultipartUploadCommand) return { ETag: "\"multipart-etag\"" };
    if (command instanceof HeadObjectCommand) return {
      ContentLength: size,
      ContentType: "audio/wav",
      Metadata: { sha256: digest },
    };
    if (command instanceof GetObjectCommand) return {
      Body: repeatedBytes(size),
      ContentLength: size,
      ContentType: "audio/wav",
      Metadata: { sha256: digest },
    };
    if (command instanceof DeleteObjectCommand || command instanceof AbortMultipartUploadCommand) return {};
    throw new Error("Unexpected command");
  });
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "test-access", secretAccessKey: "test-secret", publicBucket: "lnx-public-test", privateBucket: "lnx-private-test",
    client: fakeClient as never,
  });

  await storage.put({
    scope: "private",
    key: "orders/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000002.wav",
    body: repeatedBytes(size, 65_537),
    contentLength: size,
    contentType: "audio/wav",
    checksumSha256: digest,
  });

  assert.equal(S3_MULTIPART_PART_SIZE_BYTES, 8 * 1024 * 1024);
  assert.equal(S3_MULTIPART_QUEUE_SIZE, 2);
  assert.equal(calls.filter((call) => call instanceof CreateMultipartUploadCommand).length, 1);
  assert.equal(calls.filter((call) => call instanceof CompleteMultipartUploadCommand).length, 1);
  assert.equal(calls.filter((call) => call instanceof PutObjectCommand).length, 0);
  assert.equal(partSizes.length, Math.ceil(size / S3_MULTIPART_PART_SIZE_BYTES));
  assert.ok(partSizes.every((partSize) => partSize > 0 && partSize <= S3_MULTIPART_PART_SIZE_BYTES));
  assert.equal(partSizes.reduce((total, partSize) => total + partSize, 0), size);
});

test("S3 adapter aborts multipart and deletes the opaque object after an R2 part failure", async () => {
  const size = 18 * 1024 * 1024;
  const calls: unknown[] = [];
  const fakeClient = multipartClient(async (command) => {
    calls.push(command);
    if (command instanceof CreateMultipartUploadCommand) return { UploadId: "qa-failing-upload" };
    if (command instanceof UploadPartCommand) {
      if (command.input.PartNumber === 2) {
        throw Object.assign(new Error("provider detail sentinel"), {
          code: "SlowDown",
          $metadata: { httpStatusCode: 503 },
        });
      }
      return { ETag: `\"part-${command.input.PartNumber}\"` };
    }
    if (command instanceof AbortMultipartUploadCommand || command instanceof DeleteObjectCommand) return {};
    throw new Error("Unexpected command");
  });
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "test-access", secretAccessKey: "test-secret", publicBucket: "lnx-public-test", privateBucket: "lnx-private-test",
    client: fakeClient as never,
  });
  await assert.rejects(storage.put({
    scope: "private",
    key: "orders/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000003.wav",
    body: repeatedBytes(size),
    contentLength: size,
    contentType: "audio/wav",
    checksumSha256: repeatedBytesChecksum(size),
  }), (error) => error instanceof MediaStorageError
    && error.code === "PROVIDER"
    && error.providerCode === "SlowDown"
    && error.providerStatusCode === 503
    && error.cleanupOutcome === "succeeded"
    && !error.message.includes("sentinel"));
  assert.equal(calls.filter((call) => call instanceof AbortMultipartUploadCommand).length, 1);
  assert.equal(calls.filter((call) => call instanceof DeleteObjectCommand).length, 1);
  assert.equal(calls.filter((call) => call instanceof CompleteMultipartUploadCommand).length, 0);
});

test("S3 adapter aborts and cleans a multipart upload when its source closes early", async () => {
  const size = 18 * 1024 * 1024;
  const calls: unknown[] = [];
  const source = Readable.from((async function* () {
    yield* repeatedBytes(9 * 1024 * 1024);
    throw Object.assign(new Error("source detail sentinel"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
  })());
  const fakeClient = multipartClient(async (command) => {
    calls.push(command);
    if (command instanceof CreateMultipartUploadCommand) return { UploadId: "qa-early-close" };
    if (command instanceof UploadPartCommand) return { ETag: `\"part-${command.input.PartNumber}\"` };
    if (command instanceof AbortMultipartUploadCommand || command instanceof DeleteObjectCommand) return {};
    throw new Error("Unexpected command");
  });
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "test-access", secretAccessKey: "test-secret", publicBucket: "lnx-public-test", privateBucket: "lnx-private-test",
    client: fakeClient as never,
  });
  await assert.rejects(storage.put({
    scope: "private",
    key: "orders/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000004.wav",
    body: source,
    contentLength: size,
    contentType: "audio/wav",
    checksumSha256: repeatedBytesChecksum(size),
  }), (error) => error instanceof MediaStorageError
    && error.code === "PROVIDER"
    && error.providerCode === "ERR_STREAM_PREMATURE_CLOSE"
    && error.cleanupOutcome === "succeeded");
  assert.equal(calls.filter((call) => call instanceof AbortMultipartUploadCommand).length, 1);
  assert.equal(calls.filter((call) => call instanceof DeleteObjectCommand).length, 1);
});

test("S3 adapter rejects and removes uploads whose remote checksum or MIME metadata differs", async (context) => {
  const data = Buffer.from("object-body");
  const key = "catalog/audio-previews/00000000-0000-4000-8000-000000000001.mp3";
  for (const mismatch of ["checksum", "mime"] as const) {
    await context.test(mismatch, async () => {
      const calls: unknown[] = [];
      const fakeClient = {
        async send(command: unknown) {
          calls.push(command);
          if (command instanceof PutObjectCommand) return { ETag: "\"put-etag\"" };
          if (command instanceof HeadObjectCommand) return {
            ContentLength: data.length,
            ContentType: mismatch === "mime" ? "application/octet-stream" : "audio/mpeg",
            Metadata: { sha256: mismatch === "checksum" ? "incorrect" : checksum(data) },
          };
          if (command instanceof DeleteObjectCommand) return {};
          throw new Error("Unexpected command");
        },
      };
      const storage = new S3MediaStorage({
        provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
        accessKeyId: "test-access", secretAccessKey: "test-secret", publicBucket: "lnx-public-test", privateBucket: "lnx-private-test",
        client: fakeClient as never,
      });
      await assert.rejects(storage.put({
        scope: "public",
        key,
        body: data,
        contentLength: data.length,
        contentType: "audio/mpeg",
        checksumSha256: checksum(data),
      }), (error) => error instanceof MediaStorageError && error.code === "INTEGRITY");
      assert.equal(calls.filter((call) => call instanceof DeleteObjectCommand).length, 1);
    });
  }
});

test("S3 adapter rejects and removes an upload whose downloaded bytes differ from signed metadata", async () => {
  const expected = Buffer.from("object-body");
  const corrupt = Buffer.from("corrupt-bod");
  const calls: unknown[] = [];
  const fakeClient = {
    async send(command: unknown) {
      calls.push(command);
      if (command instanceof PutObjectCommand) return { ETag: "\"put-etag\"" };
      if (command instanceof HeadObjectCommand) return {
        ContentLength: expected.length,
        ContentType: "audio/mpeg",
        Metadata: { sha256: checksum(expected) },
      };
      if (command instanceof GetObjectCommand) return {
        Body: Readable.from([corrupt]),
        ContentLength: corrupt.length,
        ContentType: "audio/mpeg",
        Metadata: { sha256: checksum(expected) },
      };
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error("Unexpected command");
    },
  };
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "test-access", secretAccessKey: "test-secret", publicBucket: "lnx-public-test", privateBucket: "lnx-private-test",
    client: fakeClient as never,
  });
  await assert.rejects(storage.put({
    scope: "public",
    key: "catalog/audio-previews/00000000-0000-4000-8000-000000000001.mp3",
    body: expected,
    contentLength: expected.length,
    contentType: "audio/mpeg",
    checksumSha256: checksum(expected),
  }), (error) => error instanceof MediaStorageError && error.code === "INTEGRITY");
  assert.equal(calls.filter((call) => call instanceof GetObjectCommand).length, 1);
  assert.equal(calls.filter((call) => call instanceof DeleteObjectCommand).length, 1);
});

test("S3 adapter rejects a shared public/private bucket", () => {
  assert.throws(() => new S3MediaStorage({
    provider: "r2", region: "auto", accessKeyId: "a", secretAccessKey: "b", publicBucket: "same", privateBucket: "same",
  }), MediaStorageError);
});
