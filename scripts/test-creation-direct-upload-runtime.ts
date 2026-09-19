import "server-only";

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import {
  abortCreationVideoUpload,
  completeCreationVideoUpload,
  expireAbandonedCreationVideoUploads,
  getCreationVideoUploadStatus,
  initializeCreationVideoUpload,
} from "@/lib/creations/direct-upload-service";
import { CreationDirectUploadError } from "@/lib/creations/direct-upload-domain";
import { processNextCreationVideoValidation } from "@/lib/creations/direct-upload-worker";
import { replaceAdminCreationMedia } from "@/lib/creations/media-service";
import { catalogFfmpegPath } from "@/lib/catalog/ffmpeg";
import { resetMediaStorageCacheForTests } from "@/lib/media/storage/config";
import { setS3ClientFactoryForTests } from "@/lib/media/storage/s3";
import { prisma } from "@/lib/prisma";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (!(["127.0.0.1", "localhost"].includes(databaseUrl.hostname)) || !process.env.LNX_DATABASE_TARGET?.endsWith("-test")) {
  throw new Error("Direct-upload runtime QA requires an explicit local *-test database.");
}

Object.assign(process.env, {
  NODE_ENV: "test",
  MEDIA_STORAGE_DRIVER: "s3",
  MEDIA_DEPLOYMENT_ENV: "test",
  MEDIA_STORAGE_PROVIDER: "minio",
  MEDIA_S3_ENDPOINT: "http://127.0.0.1:9000/storage",
  MEDIA_S3_REGION: "us-east-1",
  MEDIA_S3_ACCESS_KEY_ID: "runtime-test-access",
  MEDIA_S3_SECRET_ACCESS_KEY: "runtime-test-secret",
  MEDIA_PUBLIC_BUCKET: "runtime-public-test",
  MEDIA_PRIVATE_BUCKET: "runtime-private-test",
  MEDIA_S3_FORCE_PATH_STYLE: "true",
});

const actorUserId = "30000000-0000-4000-8000-000000000031";
const otherUserId = "30000000-0000-4000-8000-000000000032";
const creationId = "10000000-0000-4000-8000-000000000031";
let uploadSequence = 0;
const providerParts = new Map<string, Array<{ PartNumber: number; ETag: string; Size: number }>>();
const completedObjects = new Map<string, { bytes: Buffer; contentType: string; metadata: Record<string, string> }>();
const quarantineBodies = new Map<string, Buffer>();
const forcedHeadSizes = new Map<string, number>();
const initiated = new Map<string, { key: string; metadata: Record<string, string> }>();
const commands: unknown[] = [];

setS3ClientFactoryForTests(() => ({
  config: {
    requestChecksumCalculation: async () => "WHEN_REQUIRED",
    requestHandler: {},
    endpoint: async () => new URL("http://127.0.0.1:9000/storage"),
    forcePathStyle: true,
  },
  async send(command: unknown) {
    commands.push(command);
    if (command instanceof CreateMultipartUploadCommand) {
      const uploadId = `upload-${++uploadSequence}`;
      initiated.set(uploadId, { key: command.input.Key!, metadata: command.input.Metadata ?? {} });
      return { UploadId: uploadId };
    }
    if (command instanceof ListPartsCommand) return { Parts: providerParts.get(command.input.UploadId!) ?? [] };
    if (command instanceof CompleteMultipartUploadCommand) {
      const source = initiated.get(command.input.UploadId!);
      assert.ok(source);
      const size = (providerParts.get(command.input.UploadId!) ?? []).reduce((total, part) => total + part.Size, 0);
      completedObjects.set(source.key, { bytes: quarantineBodies.get(command.input.UploadId!) ?? Buffer.alloc(size), contentType: "video/mp4", metadata: source.metadata });
      return { ETag: "complete" };
    }
    if (command instanceof HeadObjectCommand) {
      const object = completedObjects.get(command.input.Key!);
      if (!object) throw Object.assign(new Error("missing"), { name: "NotFound" });
      return { ContentLength: forcedHeadSizes.get(command.input.Key!) ?? object.bytes.length, ContentType: object.contentType, Metadata: object.metadata };
    }
    if (command instanceof GetObjectCommand) {
      const object = completedObjects.get(command.input.Key!);
      if (!object) throw Object.assign(new Error("missing"), { name: "NotFound" });
      return { Body: Readable.from([object.bytes]), ContentLength: object.bytes.length, ContentType: object.contentType, Metadata: object.metadata };
    }
    if (command instanceof PutObjectCommand) {
      const chunks: Buffer[] = [];
      const body = command.input.Body as AsyncIterable<Uint8Array> | Uint8Array;
      if (Symbol.asyncIterator in Object(body)) for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
      else chunks.push(Buffer.from(body as Uint8Array));
      completedObjects.set(command.input.Key!, { bytes: Buffer.concat(chunks), contentType: command.input.ContentType ?? "application/octet-stream", metadata: command.input.Metadata ?? {} });
      return { ETag: "put" };
    }
    if (command instanceof DeleteObjectCommand) { completedObjects.delete(command.input.Key!); return {}; }
    if (command instanceof AbortMultipartUploadCommand) return {};
    throw new Error(`Unexpected ${command?.constructor?.name}`);
  },
}) as never);
resetMediaStorageCacheForTests();

let expectedLockVersion = 1;
let expectedAssetId: string | null = null;
function media(sizeBytes: number) {
  return {
    creationId, slug: "runtime-direct-video", expectedLockVersion, expectedAssetId,
    rightsConfirmed: true as const, alt: null, role: "VIDEO" as const, filename: "runtime.mp4",
    mimeType: "video/mp4" as const, sizeBytes,
  };
}

try {
  await prisma.creationMediaUploadSession.deleteMany({ where: { creationId } });
  await prisma.creation.deleteMany({ where: { id: creationId } });
  await prisma.user.deleteMany({ where: { id: { in: [actorUserId, otherUserId] } } });
  await prisma.user.createMany({ data: [
    { id: actorUserId, email: "direct-runtime-admin@example.test", role: "ADMIN", status: "ACTIVE", updatedAt: new Date() },
    { id: otherUserId, email: "direct-runtime-other@example.test", role: "ADMIN", status: "ACTIVE", updatedAt: new Date() },
  ] });
  await prisma.creation.create({ data: { id: creationId, slug: "runtime-direct-video", title: "Runtime video", status: "DRAFT", lockVersion: 1 } });

  const mediaRoot = await mkdtemp(path.join(os.tmpdir(), "lnx-direct-runtime-media-"));
  const videoPath = path.join(mediaRoot, "valid.mp4");
  await promisify(execFile)(catalogFfmpegPath(), [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=size=160x90:rate=10:duration=1",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "32k", "-movflags", "+faststart", "-shortest", "-y", videoPath,
  ]);
  const videoBytes = await readFile(videoPath);
  const size = videoBytes.length;
  const session = await initializeCreationVideoUpload({ actorUserId, media: media(size) });
  assert.match(session.quarantineKey, new RegExp(`^creations/quarantine/${creationId}/[0-9a-f-]{36}/source\\.mp4$`));
  assert.equal(session.actorUserId, actorUserId);
  await assert.rejects(
    getCreationVideoUploadStatus({ actorUserId: otherUserId, sessionToken: session.sessionToken, baseUrl: "http://localhost" }),
    (error) => error instanceof CreationDirectUploadError && error.code === "INVALID_SESSION",
  );
  await assert.rejects(
    getCreationVideoUploadStatus({ actorUserId, sessionToken: `${session.id}.${"x".repeat(43)}`, baseUrl: "http://localhost" }),
    (error) => error instanceof CreationDirectUploadError && error.code === "INVALID_SESSION",
  );
  quarantineBodies.set(session.providerUploadId, videoBytes);
  providerParts.set(session.providerUploadId, [{ PartNumber: 1, ETag: "etag-1", Size: size }]);
  const completed = await completeCreationVideoUpload({
    actorUserId, sessionToken: session.sessionToken,
    parts: [{ partNumber: 1, etag: "etag-1" }], baseUrl: "http://localhost",
  });
  assert.equal(completed.status, "QUARANTINE");
  const validation = await processNextCreationVideoValidation();
  if (validation.status !== "READY") {
    console.error(JSON.stringify({ validation, session: await prisma.creationMediaUploadSession.findUnique({ where: { id: session.id } }), commands: commands.map((command) => command?.constructor?.name) }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
  }
  assert.equal(validation.status, "READY");
  const ready = await prisma.creationMediaUploadSession.findUniqueOrThrow({ where: { id: session.id } });
  assert.equal(ready.status, "READY");
  assert.equal((await prisma.creationAsset.findUniqueOrThrow({ where: { creationId_role: { creationId, role: "VIDEO" } } })).assetId, ready.resultAssetId);
  const activatedAsset = await prisma.asset.findUniqueOrThrow({ where: { id: ready.resultAssetId! } });
  const replay = await replaceAdminCreationMedia({
    creationId, slug: "runtime-direct-video", expectedLockVersion: "1", expectedAssetId: null,
    rightsConfirmed: true, alt: null, role: "VIDEO", path: "/path-must-not-be-read-on-idempotent-replay",
    originalFilename: "runtime.mp4", mimeType: "video/mp4", extension: "mp4", sizeBytes: Number(activatedAsset.sizeBytes),
    width: activatedAsset.width, height: activatedAsset.height, durationMs: activatedAsset.durationMs,
    checksumSha256: activatedAsset.checksumSha256!, cleanup: async () => { throw new Error("cleanup must not run"); },
    activationAssetId: ready.resultAssetId!,
  });
  assert.equal(replay.assetId, ready.resultAssetId);
  expectedLockVersion = ready.resultLockVersion!;
  expectedAssetId = ready.resultAssetId;

  const lostLease = await initializeCreationVideoUpload({ actorUserId, media: media(size) });
  await assert.rejects(
    replaceAdminCreationMedia({
      creationId, slug: "runtime-direct-video", expectedLockVersion: String(expectedLockVersion), expectedAssetId,
      rightsConfirmed: true, alt: null, role: "VIDEO", path: videoPath,
      originalFilename: "runtime.mp4", mimeType: "video/mp4", extension: "mp4", sizeBytes: size,
      width: activatedAsset.width, height: activatedAsset.height, durationMs: activatedAsset.durationMs,
      checksumSha256: activatedAsset.checksumSha256!, cleanup: async () => undefined,
      activationAssetId: lostLease.id,
      activationLease: { uploadSessionId: lostLease.id, leaseToken: "lease-that-was-never-claimed" },
    }),
  );
  assert.equal(
    (await prisma.creationAsset.findUniqueOrThrow({ where: { creationId_role: { creationId, role: "VIDEO" } } })).assetId,
    ready.resultAssetId,
  );
  assert.equal(await prisma.asset.findUnique({ where: { id: lostLease.id } }), null);
  await abortCreationVideoUpload({ actorUserId, sessionToken: lostLease.sessionToken, baseUrl: "http://localhost" });
  await rm(mediaRoot, { recursive: true, force: true });

  const aborted = await initializeCreationVideoUpload({ actorUserId, media: media(1024) });
  const abortedResponse = await abortCreationVideoUpload({ actorUserId, sessionToken: aborted.sessionToken, baseUrl: "http://localhost" });
  assert.equal(abortedResponse.status, "ABORTED");
  assert.ok(commands.some((command) => command instanceof AbortMultipartUploadCommand && command.input.UploadId === aborted.providerUploadId));

  const expired = await initializeCreationVideoUpload({ actorUserId, media: media(2048), now: new Date("2026-01-01T00:00:00Z") });
  assert.equal(await expireAbandonedCreationVideoUploads(10, new Date("2026-01-01T02:00:00Z")), 1);
  assert.equal((await prisma.creationMediaUploadSession.findUniqueOrThrow({ where: { id: expired.id } })).status, "EXPIRED");

  const mismatch = await initializeCreationVideoUpload({ actorUserId, media: media(4096) });
  providerParts.set(mismatch.providerUploadId, [{ PartNumber: 1, ETag: "etag-mismatch", Size: 4096 }]);
  const object = initiated.get(mismatch.providerUploadId)!;
  forcedHeadSizes.set(object.key, 4095);
  await assert.rejects(
    completeCreationVideoUpload({ actorUserId, sessionToken: mismatch.sessionToken, parts: [{ partNumber: 1, etag: "etag-mismatch" }], baseUrl: "http://localhost" }),
    (error) => error instanceof CreationDirectUploadError && error.code === "STORAGE_INTEGRITY",
  );
  console.log(JSON.stringify({ ok: true, sessions: 5, actorBinding: true, generatedKeys: true, complete: true, asyncValidation: true, deterministicAsset: true, crashReplayIdempotent: true, lostLeaseCannotAttach: true, abort: true, expiry: true, headMismatch: true }));
} finally {
  const creation = await prisma.creation.findUnique({ where: { id: creationId }, select: { assets: { select: { assetId: true } } } });
  await prisma.creationAsset.deleteMany({ where: { creationId } });
  if (creation?.assets.length) await prisma.asset.deleteMany({ where: { id: { in: creation.assets.map(({ assetId }) => assetId) } } });
  await prisma.creationMediaUploadSession.deleteMany({ where: { creationId } });
  await prisma.creation.deleteMany({ where: { id: creationId } });
  await prisma.user.deleteMany({ where: { id: { in: [actorUserId, otherUserId] } } });
  setS3ClientFactoryForTests(null);
  resetMediaStorageCacheForTests();
  await prisma.$disconnect();
}
