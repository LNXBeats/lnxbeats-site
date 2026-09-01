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

import {
  createMemoryDiagnostics,
  type MemoryDiagnosticSnapshot,
} from "@/lib/memory-diagnostics";
import { canReadOrderMedia } from "@/lib/media/authorization";
import { LocalMediaStorage } from "@/lib/media/storage/local";
import { assertMediaStorageKey, safeContentDisposition } from "@/lib/media/storage/policy";
import {
  S3MediaStorage,
  S3_MULTIPART_PART_SIZE_BYTES,
  S3_MULTIPART_QUEUE_SIZE,
  setS3ClientFactoryForTests,
} from "@/lib/media/storage/s3";
import { MediaStorageError } from "@/lib/media/storage/types";
import {
  activeMediaStorage,
  mediaStorageForReference,
  resetMediaStorageCacheForTests,
  validateMediaStorageConfiguration,
} from "@/lib/media/storage/config";

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

function multipartProviderFailure(code: string, statusCode: number) {
  return Object.assign(new Error("provider detail sentinel"), {
    code,
    $metadata: { httpStatusCode: statusCode },
  });
}

function fixedMemoryUsage() {
  return {
    rss: 128 * 1024 * 1024,
    heapTotal: 64 * 1024 * 1024,
    heapUsed: 32 * 1024 * 1024,
    external: 8 * 1024 * 1024,
    arrayBuffers: 4 * 1024 * 1024,
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

test("object media storage reuses one client per compatible process configuration and isolates bucket changes", async () => {
  const names = [
    "NODE_ENV",
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
  const commands: HeadObjectCommand[] = [];
  let clientCreations = 0;
  const fakeClient = {
    config: {},
    async send(command: unknown) {
      assert.ok(command instanceof HeadObjectCommand);
      commands.push(command);
      return { ContentLength: 0 };
    },
  };

  try {
    Object.assign(process.env, {
      NODE_ENV: "test",
      MEDIA_STORAGE_DRIVER: "s3",
      MEDIA_DEPLOYMENT_ENV: "test",
      MEDIA_STORAGE_PROVIDER: "minio",
      MEDIA_S3_ENDPOINT: "http://127.0.0.1:9000/storage",
      MEDIA_S3_REGION: "us-east-1",
      MEDIA_S3_ACCESS_KEY_ID: "singleton-test-access",
      MEDIA_S3_SECRET_ACCESS_KEY: "singleton-test-secret",
      MEDIA_PUBLIC_BUCKET: "singleton-public-test",
      MEDIA_PRIVATE_BUCKET: "singleton-private-test",
      MEDIA_S3_FORCE_PATH_STYLE: "true",
    });
    resetMediaStorageCacheForTests();
    setS3ClientFactoryForTests(() => {
      clientCreations += 1;
      return fakeClient as never;
    });

    const sequential = Array.from({ length: 100 }, () => activeMediaStorage());
    const concurrent = await Promise.all(
      Array.from({ length: 100 }, async () => activeMediaStorage()),
    );
    const storage = sequential[0]!;
    assert.ok([...sequential, ...concurrent].every((candidate) => candidate === storage));
    assert.equal(clientCreations, 1);
    const processCache = Reflect.get(
      globalThis,
      Symbol.for("lnx-studio.media.object-storage-cache.v1"),
    );
    assert.ok(processCache instanceof Map);
    assert.equal(processCache.size, 1);
    assert.equal(mediaStorageForReference({ storageBackend: "OBJECT", storageProvider: "minio" }), storage);

    await storage.head({
      scope: "public",
      key: "catalog/images/00000000-0000-4000-8000-000000000001.webp",
    });
    await storage.head({
      scope: "private",
      key: "orders/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.webp",
    });
    assert.deepEqual(commands.map((command) => command.input.Bucket), [
      "singleton-public-test",
      "singleton-private-test",
    ]);

    process.env.MEDIA_PUBLIC_BUCKET = "isolated-public-test";
    process.env.MEDIA_PRIVATE_BUCKET = "isolated-private-test";
    const isolatedStorage = activeMediaStorage();
    assert.notEqual(isolatedStorage, storage);
    assert.equal(clientCreations, 2);
    assert.equal(processCache.size, 2);
    await isolatedStorage.head({
      scope: "public",
      key: "catalog/images/00000000-0000-4000-8000-000000000003.webp",
    });
    assert.equal(commands.at(-1)?.input.Bucket, "isolated-public-test");
  } finally {
    resetMediaStorageCacheForTests();
    setS3ClientFactoryForTests(null);
    for (const name of names) {
      if (previous[name] === undefined) Reflect.deleteProperty(process.env, name);
      else Reflect.set(process.env, name, previous[name]);
    }
  }
});

test("object media storage does not cache failed initialization and exposes a test-only reset", () => {
  const names = [
    "NODE_ENV",
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
  let clientCreations = 0;
  const fakeClient = { config: {}, send: async () => ({ ContentLength: 0 }) };
  try {
    Object.assign(process.env, {
      NODE_ENV: "test",
      MEDIA_STORAGE_DRIVER: "s3",
      MEDIA_DEPLOYMENT_ENV: "test",
      MEDIA_STORAGE_PROVIDER: "minio",
      MEDIA_S3_ENDPOINT: "http://127.0.0.1:9000/storage",
      MEDIA_S3_REGION: "us-east-1",
      MEDIA_S3_ACCESS_KEY_ID: "failure-test-access",
      MEDIA_S3_SECRET_ACCESS_KEY: "failure-test-secret",
      MEDIA_PUBLIC_BUCKET: "failure-public-test",
      MEDIA_PRIVATE_BUCKET: "failure-private-test",
      MEDIA_S3_FORCE_PATH_STYLE: "true",
    });
    resetMediaStorageCacheForTests();
    setS3ClientFactoryForTests(() => {
      clientCreations += 1;
      if (clientCreations === 1) throw new Error("simulated client initialization failure");
      return fakeClient as never;
    });

    assert.throws(() => activeMediaStorage(), /simulated client initialization failure/);
    const recovered = activeMediaStorage();
    assert.equal(clientCreations, 2);
    assert.equal(activeMediaStorage(), recovered);
    assert.equal(clientCreations, 2);

    resetMediaStorageCacheForTests();
    assert.notEqual(activeMediaStorage(), recovered);
    assert.equal(clientCreations, 3);
  } finally {
    resetMediaStorageCacheForTests();
    setS3ClientFactoryForTests(null);
    for (const name of names) {
      if (previous[name] === undefined) Reflect.deleteProperty(process.env, name);
      else Reflect.set(process.env, name, previous[name]);
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

test("S3 GET streams close normally without destroying the shared client", async () => {
  const data = Buffer.from("stream-normal-completion");
  const sources: Readable[] = [];
  let sends = 0;
  const fakeClient = {
    config: {},
    async send(command: unknown) {
      assert.ok(command instanceof GetObjectCommand);
      sends += 1;
      const source = Readable.from([data]);
      sources.push(source);
      return {
        Body: source,
        ContentLength: data.length,
        ContentType: "application/octet-stream",
      };
    },
  };
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "stream-test-access", secretAccessKey: "stream-test-secret",
    publicBucket: "stream-public-test", privateBucket: "stream-private-test",
    client: fakeClient as never,
  });

  const first = await storage.get({
    scope: "public",
    key: "catalog/audio-previews/00000000-0000-4000-8000-000000000071.mp3",
  });
  assert.equal(await new Response(first.body).text(), data.toString());
  assert.equal(sources.at(-1)?.destroyed, true);

  const second = await storage.get({
    scope: "public",
    key: "catalog/audio-previews/00000000-0000-4000-8000-000000000072.mp3",
  });
  assert.equal(await new Response(second.body).text(), data.toString());
  assert.equal(sends, 2);
  assert.equal(sources.length, 2);
  assert.ok(sources.every(({ destroyed }) => destroyed));
});

test("S3 GET stream cancellation destroys its source and leaves diagnostics idle", async () => {
  let sourceDestroyed = false;
  const source = new Readable({
    read() {
      this.push(Buffer.alloc(1024, 0x6c));
    },
    destroy(error, callback) {
      sourceDestroyed = true;
      callback(error);
    },
  });
  const diagnostics = createMemoryDiagnostics({
    environment: { MEMORY_DIAGNOSTICS_ENABLED: "true" },
    readMemoryUsage: fixedMemoryUsage,
    logger() {},
  });
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "stream-abort-access", secretAccessKey: "stream-abort-secret",
    publicBucket: "stream-abort-public-test", privateBucket: "stream-abort-private-test",
    client: {
      config: {},
      async send(command: unknown) {
        assert.ok(command instanceof GetObjectCommand);
        return { Body: source, ContentLength: 16 * 1024 };
      },
    } as never,
    memoryDiagnostics: diagnostics,
  });

  const object = await storage.get({
    scope: "public",
    key: "catalog/audio-previews/00000000-0000-4000-8000-000000000073.mp3",
  });
  const reader = object.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  await reader.cancel("synthetic client disconnect");
  assert.equal(sourceDestroyed, true);
  assert.deepEqual(diagnostics.counters(), {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  });
});

test("S3 GET stream source errors propagate and destroy the per-request source", async () => {
  const source = new Readable({
    read() {
      this.destroy(new Error("synthetic stream failure"));
    },
  });
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "stream-error-access", secretAccessKey: "stream-error-secret",
    publicBucket: "stream-error-public-test", privateBucket: "stream-error-private-test",
    client: {
      config: {},
      async send(command: unknown) {
        assert.ok(command instanceof GetObjectCommand);
        return { Body: source, ContentLength: 1024 };
      },
    } as never,
  });

  const object = await storage.get({
    scope: "public",
    key: "catalog/audio-previews/00000000-0000-4000-8000-000000000074.mp3",
  });
  await assert.rejects(new Response(object.body).arrayBuffer(), /synthetic stream failure/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(source.destroyed, true);
  // Node's Readable.toWeb adapter keeps one data/error listener on the now
  // destroyed per-request source. The storage and shared client retain no
  // reference to this source, so listeners cannot accumulate on a long-lived
  // object.
  assert.equal(source.listenerCount("end"), 0);
  assert.equal(source.listenerCount("close"), 0);
});

test("100 repeated S3 GET streams finish with stable diagnostics and one storage client", async () => {
  const data = Buffer.alloc(64 * 1024, 0x6c);
  const snapshots: MemoryDiagnosticSnapshot[] = [];
  const diagnostics = createMemoryDiagnostics({
    environment: { MEMORY_DIAGNOSTICS_ENABLED: "true" },
    readMemoryUsage: fixedMemoryUsage,
    logger(snapshot) { snapshots.push(snapshot); },
  });
  let sends = 0;
  const fakeClient = {
    config: {},
    async send(command: unknown) {
      assert.ok(command instanceof GetObjectCommand);
      sends += 1;
      return { Body: Readable.from([data]), ContentLength: data.length };
    },
  };
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "stream-cycle-access", secretAccessKey: "stream-cycle-secret",
    publicBucket: "stream-cycle-public-test", privateBucket: "stream-cycle-private-test",
    client: fakeClient as never,
    memoryDiagnostics: diagnostics,
  });

  for (let index = 0; index < 100; index += 1) {
    const object = await storage.get({
      scope: "public",
      key: `catalog/audio-previews/00000000-0000-4000-8000-${String(index).padStart(12, "0")}.mp3`,
    });
    assert.equal((await new Response(object.body).arrayBuffer()).byteLength, data.length);
  }

  assert.equal(sends, 100);
  assert.equal(snapshots.filter(({ event }) => event === "memory.storage.before").length, 100);
  assert.equal(snapshots.filter(({ event }) => event === "memory.storage.after").length, 100);
  assert.equal(snapshots.at(-1)?.activeS3Operations, 0);
  assert.deepEqual(diagnostics.counters(), {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  });
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

test("multipart S3 diagnostics emit one public event pair while SDK parts remain counter-only", { timeout: 30_000 }, async () => {
  const size = 18 * 1024 * 1024;
  const digest = repeatedBytesChecksum(size);
  const snapshots: MemoryDiagnosticSnapshot[] = [];
  const diagnostics = createMemoryDiagnostics({
    environment: { MEMORY_DIAGNOSTICS_ENABLED: "true" },
    readMemoryUsage: fixedMemoryUsage,
    logger(snapshot) { snapshots.push(snapshot); },
  });
  let maximumActiveS3Operations = 0;
  const fakeClient = multipartClient(async (command) => {
    maximumActiveS3Operations = Math.max(
      maximumActiveS3Operations,
      diagnostics.counters().activeS3Operations,
    );
    if (command instanceof CreateMultipartUploadCommand) return { UploadId: "diagnostic-upload-id" };
    if (command instanceof UploadPartCommand) return { ETag: `\"part-${command.input.PartNumber}\"` };
    if (command instanceof CompleteMultipartUploadCommand) return { ETag: "\"diagnostic-etag\"" };
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
    if (command instanceof AbortMultipartUploadCommand || command instanceof DeleteObjectCommand) return {};
    throw new Error("Unexpected command");
  });
  const storage = new S3MediaStorage({
    provider: "r2",
    region: "auto",
    endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "diagnostic-test-access",
    secretAccessKey: "diagnostic-test-secret",
    publicBucket: "diagnostic-public-test",
    privateBucket: "diagnostic-private-test",
    client: fakeClient as never,
    memoryDiagnostics: diagnostics,
  });

  await storage.put({
    scope: "private",
    key: "orders/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000099.wav",
    body: repeatedBytes(size),
    contentLength: size,
    contentType: "audio/wav",
    checksumSha256: digest,
  });

  assert.deepEqual(snapshots.map(({ event }) => event), [
    "memory.storage.before",
    "memory.storage.after",
  ]);
  assert.equal(snapshots[0]?.activeS3Operations, 1);
  assert.equal(snapshots[1]?.activeS3Operations, 0);
  assert.equal(snapshots[1]?.outcome, "completed");
  assert.ok(maximumActiveS3Operations >= 2);
  assert.ok(maximumActiveS3Operations <= S3_MULTIPART_QUEUE_SIZE + 1);
  assert.equal(diagnostics.counters().activeS3Operations, 0);
  const serialized = JSON.stringify(snapshots);
  assert.doesNotMatch(serialized, /diagnostic-(?:public|private)-test|00000000-0000-4000-8000-000000000099/);
});

test("failed S3 storage diagnostics emit one failed pair and restore all counters", async () => {
  const snapshots: MemoryDiagnosticSnapshot[] = [];
  const diagnostics = createMemoryDiagnostics({
    environment: { MEMORY_DIAGNOSTICS_ENABLED: "true" },
    readMemoryUsage: fixedMemoryUsage,
    logger(snapshot) { snapshots.push(snapshot); },
  });
  const fakeClient = {
    config: {},
    async send(command: unknown) {
      if (command instanceof PutObjectCommand) return { ETag: "\"put-etag\"" };
      if (command instanceof HeadObjectCommand) throw new Error("synthetic provider failure");
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error("Unexpected command");
    },
  };
  const storage = new S3MediaStorage({
    provider: "r2",
    region: "auto",
    endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "failure-diagnostic-test-access",
    secretAccessKey: "failure-diagnostic-test-secret",
    publicBucket: "failure-diagnostic-public-test",
    privateBucket: "failure-diagnostic-private-test",
    client: fakeClient as never,
    memoryDiagnostics: diagnostics,
  });
  const body = Buffer.from("diagnostic failure fixture");

  await assert.rejects(storage.put({
    scope: "public",
    key: "catalog/audio-previews/00000000-0000-4000-8000-000000000098.mp3",
    body,
    contentLength: body.length,
    contentType: "audio/mpeg",
    checksumSha256: checksum(body),
  }), MediaStorageError);

  assert.deepEqual(snapshots.map(({ event }) => event), [
    "memory.storage.before",
    "memory.storage.after",
  ]);
  assert.equal(snapshots[1]?.outcome, "failed");
  assert.equal(snapshots[1]?.activeS3Operations, 0);
  assert.deepEqual(diagnostics.counters(), {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  });
});

test("R2 multipart requests omit Expect 100-continue and unsupported S3 headers on the actual SDK wire request", { timeout: 30_000 }, async () => {
  const size = 18 * 1024 * 1024;
  const digest = repeatedBytesChecksum(size);
  const createHeaders: Array<Record<string, string>> = [];
  const partHeaders: Array<Record<string, string>> = [];
  let retryInjected = false;
  const requestHandler = {
    async handle(request: {
      method: string;
      headers: Record<string, string>;
      query?: Record<string, string | string[] | null>;
    }) {
      const headers = Object.fromEntries(
        Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]),
      );
      const query = request.query ?? {};
      if (request.method === "POST" && "uploads" in query) {
        createHeaders.push(headers);
        return {
          response: {
            statusCode: 200,
            headers: { "content-type": "application/xml" },
            body: Readable.from("<InitiateMultipartUploadResult><Bucket>lnx-private-test</Bucket><Key>opaque.wav</Key><UploadId>wire-upload</UploadId></InitiateMultipartUploadResult>"),
          },
        };
      }
      if (request.method === "PUT" && "partNumber" in query) {
        partHeaders.push(headers);
        if (!retryInjected && String(query.partNumber) === "1") {
          retryInjected = true;
          return {
            response: {
              statusCode: 503,
              headers: { "content-type": "application/xml" },
              body: Readable.from("<Error><Code>SlowDown</Code><Message>retry</Message></Error>"),
            },
          };
        }
        return { response: { statusCode: 200, headers: { etag: `\"part-${String(query.partNumber)}\"` } } };
      }
      if (request.method === "POST" && "uploadId" in query) {
        return {
          response: {
            statusCode: 200,
            headers: { "content-type": "application/xml" },
            body: Readable.from("<CompleteMultipartUploadResult><Bucket>lnx-private-test</Bucket><Key>opaque.wav</Key><ETag>\"wire-etag\"</ETag></CompleteMultipartUploadResult>"),
          },
        };
      }
      if (request.method === "HEAD") {
        return {
          response: {
            statusCode: 200,
            headers: {
              "content-length": String(size),
              "content-type": "audio/wav",
              "x-amz-meta-sha256": digest,
              etag: "\"wire-etag\"",
            },
          },
        };
      }
      if (request.method === "GET") {
        return {
          response: {
            statusCode: 200,
            headers: {
              "content-length": String(size),
              "content-type": "audio/wav",
              "x-amz-meta-sha256": digest,
            },
            body: repeatedBytes(size),
          },
        };
      }
      throw new Error(`Unexpected wire request ${request.method}`);
    },
  };
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "test-access", secretAccessKey: "test-secret", publicBucket: "lnx-public-test", privateBucket: "lnx-private-test",
    requestHandler: requestHandler as never,
  });

  await storage.put({
    scope: "private",
    key: "orders/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000005.wav",
    body: repeatedBytes(size),
    contentLength: size,
    contentType: "audio/wav",
    checksumSha256: digest,
  });

  assert.equal(createHeaders.length, 1);
  assert.equal(retryInjected, true);
  assert.equal(partHeaders.length, Math.ceil(size / S3_MULTIPART_PART_SIZE_BYTES) + 1);
  for (const headers of [...createHeaders, ...partHeaders]) {
    assert.equal(headers.expect, undefined);
    assert.equal(headers["x-amz-acl"], undefined);
    assert.equal(headers["x-amz-tagging"], undefined);
    assert.equal(headers["x-amz-server-side-encryption"], undefined);
    assert.equal(headers["x-amz-request-payer"], undefined);
    assert.equal(headers["x-amz-expected-bucket-owner"], undefined);
    assert.equal(headers["x-amz-sdk-checksum-algorithm"], undefined);
    assert.equal(Object.keys(headers).some((name) => name.startsWith("x-amz-checksum-")), false);
  }
  assert.equal(createHeaders[0]!["content-type"], "audio/wav");
  assert.equal(createHeaders[0]!["cache-control"], "private, no-store");
  assert.equal(createHeaders[0]!["x-amz-meta-sha256"], digest);
  assert.equal(createHeaders[0]!["content-length"], undefined);
  assert.ok(partHeaders.every((headers) => Number(headers["content-length"]) <= S3_MULTIPART_PART_SIZE_BYTES));
});

test("S3 adapter reports an R2 CreateMultipartUpload failure without cleanup or object deletion", async () => {
  const calls: unknown[] = [];
  const fakeClient = multipartClient(async (command) => {
    calls.push(command);
    if (command instanceof CreateMultipartUploadCommand) throw multipartProviderFailure("InvalidArgument", 400);
    throw new Error("Unexpected command");
  });
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "test-access", secretAccessKey: "test-secret", publicBucket: "lnx-public-test", privateBucket: "lnx-private-test",
    client: fakeClient as never,
  });

  await assert.rejects(storage.put({
    scope: "private",
    key: "orders/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000006.wav",
    body: repeatedBytes(18 * 1024 * 1024),
    contentLength: 18 * 1024 * 1024,
    contentType: "audio/wav",
    checksumSha256: repeatedBytesChecksum(18 * 1024 * 1024),
  }), (error) => error instanceof MediaStorageError
    && error.providerCode === "InvalidArgument"
    && error.providerStatusCode === 400
    && error.providerOperation === "MULTIPART_CREATE"
    && error.cleanupOutcome === "not_required"
    && error.objectState === "none");
  assert.equal(calls.filter((call) => call instanceof AbortMultipartUploadCommand).length, 0);
  assert.equal(calls.filter((call) => call instanceof DeleteObjectCommand).length, 0);
});

test("S3 adapter aborts multipart without deleting a non-final object after an R2 part failure", async () => {
  const size = 18 * 1024 * 1024;
  const calls: unknown[] = [];
  const fakeClient = multipartClient(async (command) => {
    calls.push(command);
    if (command instanceof CreateMultipartUploadCommand) return { UploadId: "qa-failing-upload" };
    if (command instanceof UploadPartCommand) {
      if (command.input.PartNumber === 2) {
        throw multipartProviderFailure("SlowDown", 503);
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
    && error.providerOperation === "MULTIPART_UPLOAD_PART"
    && error.cleanupOutcome === "succeeded"
    && error.objectState === "multipart_aborted"
    && !error.message.includes("sentinel"));
  assert.equal(calls.filter((call) => call instanceof AbortMultipartUploadCommand).length, 1);
  assert.equal(calls.filter((call) => call instanceof DeleteObjectCommand).length, 0);
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
    && error.providerOperation === "MULTIPART_SOURCE"
    && error.cleanupOutcome === "succeeded"
    && error.objectState === "multipart_aborted");
  assert.equal(calls.filter((call) => call instanceof AbortMultipartUploadCommand).length, 1);
  assert.equal(calls.filter((call) => call instanceof DeleteObjectCommand).length, 0);
});

test("S3 adapter classifies CompleteMultipartUpload failure and aborts the still-open upload", async () => {
  const calls: unknown[] = [];
  const fakeClient = multipartClient(async (command) => {
    calls.push(command);
    if (command instanceof CreateMultipartUploadCommand) return { UploadId: "qa-complete-failure" };
    if (command instanceof UploadPartCommand) return { ETag: `\"part-${command.input.PartNumber}\"` };
    if (command instanceof CompleteMultipartUploadCommand) throw multipartProviderFailure("InvalidArgument", 400);
    if (command instanceof AbortMultipartUploadCommand) return {};
    throw new Error("Unexpected command");
  });
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "test-access", secretAccessKey: "test-secret", publicBucket: "lnx-public-test", privateBucket: "lnx-private-test",
    client: fakeClient as never,
  });

  await assert.rejects(storage.put({
    scope: "private",
    key: "orders/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000007.wav",
    body: repeatedBytes(18 * 1024 * 1024),
    contentLength: 18 * 1024 * 1024,
    contentType: "audio/wav",
    checksumSha256: repeatedBytesChecksum(18 * 1024 * 1024),
  }), (error) => error instanceof MediaStorageError
    && error.providerCode === "InvalidArgument"
    && error.providerOperation === "MULTIPART_COMPLETE"
    && error.cleanupOutcome === "succeeded"
    && error.objectState === "multipart_aborted");
  assert.equal(calls.filter((call) => call instanceof AbortMultipartUploadCommand).length, 1);
  assert.equal(calls.filter((call) => call instanceof DeleteObjectCommand).length, 0);
});

test("S3 adapter removes a possibly finalized object when Complete response is lost and the upload no longer exists", async () => {
  const calls: unknown[] = [];
  const fakeClient = multipartClient(async (command) => {
    calls.push(command);
    if (command instanceof CreateMultipartUploadCommand) return { UploadId: "qa-ambiguous-complete" };
    if (command instanceof UploadPartCommand) return { ETag: `\"part-${command.input.PartNumber}\"` };
    if (command instanceof CompleteMultipartUploadCommand) throw multipartProviderFailure("TimeoutError", 504);
    if (command instanceof AbortMultipartUploadCommand) throw Object.assign(new Error("gone"), { name: "NoSuchUpload" });
    if (command instanceof DeleteObjectCommand) return {};
    throw new Error("Unexpected command");
  });
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "test-access", secretAccessKey: "test-secret", publicBucket: "lnx-public-test", privateBucket: "lnx-private-test",
    client: fakeClient as never,
  });

  await assert.rejects(storage.put({
    scope: "private",
    key: "orders/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000008.wav",
    body: repeatedBytes(18 * 1024 * 1024),
    contentLength: 18 * 1024 * 1024,
    contentType: "audio/wav",
    checksumSha256: repeatedBytesChecksum(18 * 1024 * 1024),
  }), (error) => error instanceof MediaStorageError
    && error.providerCode === "TimeoutError"
    && error.providerOperation === "MULTIPART_COMPLETE"
    && error.cleanupOutcome === "succeeded"
    && error.objectState === "final_object_deleted");
  assert.equal(calls.filter((call) => call instanceof AbortMultipartUploadCommand).length, 1);
  assert.equal(calls.filter((call) => call instanceof DeleteObjectCommand).length, 1);
});

test("S3 adapter reports a remaining incomplete multipart when abort cleanup fails", async () => {
  const calls: unknown[] = [];
  const fakeClient = multipartClient(async (command) => {
    calls.push(command);
    if (command instanceof CreateMultipartUploadCommand) return { UploadId: "qa-abort-failure" };
    if (command instanceof UploadPartCommand) throw multipartProviderFailure("InvalidArgument", 400);
    if (command instanceof AbortMultipartUploadCommand) throw multipartProviderFailure("ServiceUnavailable", 503);
    throw new Error("Unexpected command");
  });
  const storage = new S3MediaStorage({
    provider: "r2", region: "auto", endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "test-access", secretAccessKey: "test-secret", publicBucket: "lnx-public-test", privateBucket: "lnx-private-test",
    client: fakeClient as never,
  });

  await assert.rejects(storage.put({
    scope: "private",
    key: "orders/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000009.wav",
    body: repeatedBytes(18 * 1024 * 1024),
    contentLength: 18 * 1024 * 1024,
    contentType: "audio/wav",
    checksumSha256: repeatedBytesChecksum(18 * 1024 * 1024),
  }), (error) => error instanceof MediaStorageError
    && error.providerCode === "InvalidArgument"
    && error.providerOperation === "MULTIPART_UPLOAD_PART"
    && error.cleanupOutcome === "failed"
    && error.objectState === "multipart_incomplete");
  assert.equal(calls.filter((call) => call instanceof AbortMultipartUploadCommand).length, 1);
  assert.equal(calls.filter((call) => call instanceof DeleteObjectCommand).length, 0);
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
