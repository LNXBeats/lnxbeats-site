import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { CreationMediaUploadSession } from "@/generated/prisma/client";
import { CreationMediaError, replaceAdminCreationMedia } from "@/lib/creations/media-service";
import { CreationVideoError, validateCreationVideo } from "@/lib/creations/video";
import { activeMediaStorage } from "@/lib/media/storage/config";
import { MediaStorageError, type MediaStorage } from "@/lib/media/storage/types";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

const VALIDATION_LEASE_MS = 10 * 60 * 1_000;
const LEASE_HEARTBEAT_MS = 60 * 1_000;
const MAXIMUM_VALIDATION_FAILURES = 3;
const RETRY_BASE_MS = 30_000;

type ClaimedSession = CreationMediaUploadSession & { leaseToken: string };

function quarantineInput(session: Pick<CreationMediaUploadSession, "quarantineKey">) {
  return { scope: "private" as const, key: session.quarantineKey };
}

function objectStorageForSession(
  session: Pick<CreationMediaUploadSession, "provider">,
  override?: MediaStorage,
) {
  const storage = override ?? activeMediaStorage();
  if (storage.backend !== "OBJECT" || storage.provider !== session.provider) {
    throw new MediaStorageError("CONFIGURATION", "The upload-session object provider is unavailable.");
  }
  return storage;
}

async function claimValidationSession(now = new Date()): Promise<ClaimedSession | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = await prisma.creationMediaUploadSession.findFirst({
      where: {
        attempts: { lt: MAXIMUM_VALIDATION_FAILURES },
        availableAt: { lte: now },
        OR: [{ status: "QUARANTINE" }, { status: "VALIDATING", leaseExpiresAt: { lte: now } }],
      },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return null;
    const leaseToken = randomUUID();
    const claimed = await prisma.creationMediaUploadSession.updateMany({
      where: {
        id: candidate.id,
        attempts: { lt: MAXIMUM_VALIDATION_FAILURES },
        availableAt: { lte: now },
        OR: [{ status: "QUARANTINE" }, { status: "VALIDATING", leaseExpiresAt: { lte: now } }],
      },
      data: {
        status: "VALIDATING",
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + VALIDATION_LEASE_MS),
        validationStartedAt: candidate.validationStartedAt ?? now,
        lastErrorCode: null,
      },
    });
    if (claimed.count === 1) {
      const session = await prisma.creationMediaUploadSession.findUniqueOrThrow({ where: { id: candidate.id } });
      return { ...session, leaseToken };
    }
  }
  return null;
}

async function ownsLease(session: ClaimedSession) {
  const current = await prisma.creationMediaUploadSession.findUnique({
    where: { id: session.id },
    select: { status: true, leaseToken: true, leaseExpiresAt: true },
  });
  return current?.status === "VALIDATING"
    && current.leaseToken === session.leaseToken
    && Boolean(current.leaseExpiresAt && current.leaseExpiresAt.getTime() > Date.now());
}

function startLeaseHeartbeat(session: ClaimedSession) {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    if (stopped) return;
    try {
      await prisma.creationMediaUploadSession.updateMany({
        where: { id: session.id, status: "VALIDATING", leaseToken: session.leaseToken },
        data: { leaseExpiresAt: new Date(Date.now() + VALIDATION_LEASE_MS) },
      });
    } catch {
      // A transient DB failure does not grant ownership to anyone else. The
      // authoritative lease check before publication remains fail-closed.
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void tick(), LEASE_HEARTBEAT_MS);
        timer.unref();
      }
    }
  };
  timer = setTimeout(() => void tick(), LEASE_HEARTBEAT_MS);
  timer.unref();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

type QuarantineDownloadSession = Pick<CreationMediaUploadSession,
  "id" | "creationId" | "provider" | "quarantineKey" | "declaredSizeBytes"
>;

export async function downloadCreationVideoToTemporary(
  session: QuarantineDownloadSession,
  options: { storage?: MediaStorage; temporaryRoot?: string } = {},
) {
  const storage = objectStorageForSession(session, options.storage);
  const metadata = await storage.head(quarantineInput(session));
  if (
    metadata.contentLength !== Number(session.declaredSizeBytes)
    || metadata.contentType !== "video/mp4"
    || metadata.customMetadata?.["lnx-session-id"] !== session.id
    || metadata.customMetadata?.["lnx-creation-id"] !== session.creationId
    || metadata.customMetadata?.["lnx-declared-size"] !== String(session.declaredSizeBytes)
  ) throw new MediaStorageError("INTEGRITY", "Quarantine metadata does not match the upload session.");

  const directory = await mkdtemp(path.join(options.temporaryRoot ?? os.tmpdir(), "lnx-creation-validation-"));
  const target = path.join(directory, `${randomUUID()}.mp4`);
  const object = await storage.get(quarantineInput(session));
  if (object.contentLength !== Number(session.declaredSizeBytes)) {
    await rm(directory, { recursive: true, force: true });
    throw new MediaStorageError("INTEGRITY", "Quarantine content length changed before validation.");
  }
  let received = 0;
  const hash = createHash("sha256");
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > Number(session.declaredSizeBytes)) return callback(new MediaStorageError("INTEGRITY"));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(object.body as never),
      meter,
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
    );
    if (received !== Number(session.declaredSizeBytes)) throw new MediaStorageError("INTEGRITY");
    return { directory, target, checksumSha256: hash.digest("hex") };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function terminalErrorCode(error: unknown) {
  if (error instanceof CreationVideoError) return error.code === "ABORTED" ? null : "VALIDATION_FAILED";
  if (error instanceof CreationMediaError) return error.code === "CONFLICT" ? "MEDIA_CONFLICT" : "STORAGE_INTEGRITY";
  if (error instanceof MediaStorageError && error.code === "INTEGRITY") return "STORAGE_INTEGRITY";
  return null;
}

async function deleteQuarantineAfterTerminalClaim(session: ClaimedSession, status: "READY" | "REJECTED", baseError: string | null) {
  try {
    await objectStorageForSession(session).delete(quarantineInput(session));
    await prisma.creationMediaUploadSession.updateMany({
      where: { id: session.id, status },
      data: { lastErrorCode: baseError },
    });
  } catch {
    // The row already carries *_CLEANUP_REQUIRED; a later worker pass or R2
    // lifecycle rule can safely retry without changing publication state.
  }
}

async function markFailure(session: ClaimedSession, error: unknown) {
  const terminalCode = terminalErrorCode(error);
  const failureCount = session.attempts + 1;
  if (!terminalCode && failureCount < MAXIMUM_VALIDATION_FAILURES) {
    const released = await prisma.creationMediaUploadSession.updateMany({
      where: { id: session.id, status: "VALIDATING", leaseToken: session.leaseToken },
      data: {
        status: "QUARANTINE",
        attempts: failureCount,
        leaseToken: null,
        leaseExpiresAt: null,
        availableAt: new Date(Date.now() + RETRY_BASE_MS * failureCount),
        lastErrorCode: "INTERNAL_ERROR",
      },
    });
    return released.count === 1 ? "retry" as const : "lease_lost" as const;
  }
  const baseError = terminalCode ?? "INTERNAL_ERROR";
  const rejected = await prisma.creationMediaUploadSession.updateMany({
    where: { id: session.id, status: "VALIDATING", leaseToken: session.leaseToken },
    data: {
      status: "REJECTED",
      attempts: failureCount,
      leaseToken: null,
      leaseExpiresAt: null,
      validationFinishedAt: new Date(),
      lastErrorCode: `${baseError}_CLEANUP_REQUIRED`,
    },
  });
  if (rejected.count !== 1) return "lease_lost" as const;
  await deleteQuarantineAfterTerminalClaim(session, "REJECTED", baseError);
  return "rejected" as const;
}

async function markReady(session: ClaimedSession, result: { assetId: string; lockVersion: number }) {
  const ready = await prisma.creationMediaUploadSession.updateMany({
    where: { id: session.id, status: "VALIDATING", leaseToken: session.leaseToken },
    data: {
      status: "READY",
      resultAssetId: result.assetId,
      resultLockVersion: result.lockVersion,
      leaseToken: null,
      leaseExpiresAt: null,
      validationFinishedAt: new Date(),
      lastErrorCode: "QUARANTINE_CLEANUP_REQUIRED",
    },
  });
  if (ready.count !== 1) return false;
  await deleteQuarantineAfterTerminalClaim(session, "READY", null);
  return true;
}

export async function processNextCreationVideoValidation(
  now = new Date(),
  options: { signal?: AbortSignal } = {},
) {
  assertDatabaseConfigured();
  const session = await claimValidationSession(now);
  if (!session) return { processed: false as const };
  const stopHeartbeat = startLeaseHeartbeat(session);
  let temporary: Awaited<ReturnType<typeof downloadCreationVideoToTemporary>> | null = null;
  try {
    temporary = await downloadCreationVideoToTemporary(session);
    const video = await validateCreationVideo(temporary.target, { signal: options.signal });
    if (!(await ownsLease(session))) return { processed: true as const, status: "LEASE_LOST" as const, sessionId: session.id };
    const result = await replaceAdminCreationMedia({
      creationId: session.creationId,
      slug: session.creationSlug,
      expectedLockVersion: String(session.expectedLockVersion),
      expectedAssetId: session.expectedAssetId,
      rightsConfirmed: session.rightsConfirmed,
      alt: session.alt,
      role: "VIDEO",
      path: temporary.target,
      originalFilename: session.originalFilename,
      mimeType: "video/mp4",
      extension: "mp4",
      sizeBytes: Number(session.declaredSizeBytes),
      width: video.width,
      height: video.height,
      durationMs: video.durationMs,
      checksumSha256: temporary.checksumSha256,
      cleanup: async () => undefined,
      activationAssetId: session.resultAssetId ?? session.id,
      activationLease: { uploadSessionId: session.id, leaseToken: session.leaseToken },
    });
    if (!(await markReady(session, result))) {
      return { processed: true as const, status: "LEASE_LOST" as const, sessionId: session.id };
    }
    return { processed: true as const, status: "READY" as const, sessionId: session.id };
  } catch (error) {
    const status = await markFailure(session, error);
    return { processed: true as const, status, sessionId: session.id };
  } finally {
    stopHeartbeat();
    if (temporary) await rm(temporary.directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function cleanupTerminalCreationVideoQuarantine(limit = 25) {
  assertDatabaseConfigured();
  const sessions = await prisma.creationMediaUploadSession.findMany({
    where: {
      status: { in: ["READY", "REJECTED", "ABORTED", "EXPIRED"] },
      lastErrorCode: { endsWith: "CLEANUP_REQUIRED" },
    },
    orderBy: { updatedAt: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
  });
  let cleaned = 0;
  for (const session of sessions) {
    try {
      await objectStorageForSession(session).delete(quarantineInput(session));
      await prisma.creationMediaUploadSession.updateMany({
        where: { id: session.id, status: session.status },
        data: {
          lastErrorCode: session.status === "READY"
            ? null
            : session.lastErrorCode?.replace(/_CLEANUP_REQUIRED$/, "") ?? null,
        },
      });
      cleaned += 1;
    } catch {
      // R2 lifecycle is the final safety net.
    }
  }
  return cleaned;
}

export const creationVideoWorkerPolicy = {
  validationLeaseMs: VALIDATION_LEASE_MS,
  leaseHeartbeatMs: LEASE_HEARTBEAT_MS,
  maximumFailures: MAXIMUM_VALIDATION_FAILURES,
  retryBaseMs: RETRY_BASE_MS,
} as const;
