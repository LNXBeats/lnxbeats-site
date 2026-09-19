import "server-only";

import { randomUUID } from "node:crypto";

import type { CreationMediaUploadStatus } from "@/generated/prisma/client";
import {
  CREATION_DIRECT_UPLOAD_PART_SIZE_BYTES,
  CREATION_DIRECT_UPLOAD_PART_URL_TTL_SECONDS,
  type CreationDirectUploadInitInput,
  type CreationDirectUploadPart,
  type CreationDirectUploadStatusResponse,
} from "@/lib/creations/direct-upload-contract";
import {
  CreationDirectUploadError,
  directUploadExpiry,
  directUploadPartCount,
  directUploadState,
  expectedDirectUploadPartSize,
  newSessionToken,
  parseSessionToken,
  sessionTokenHash,
  sessionTokenHashMatches,
} from "@/lib/creations/direct-upload-domain";
import { headMediaObject } from "@/lib/media/storage";
import { activeMediaStorage, activeMultipartMediaStorage } from "@/lib/media/storage/config";
import { MediaStorageError, type MediaMultipartPart } from "@/lib/media/storage/types";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

const TERMINAL_STATUSES = new Set<CreationMediaUploadStatus>(["READY", "REJECTED", "ABORTED", "EXPIRED"]);

type UploadSession = Awaited<ReturnType<typeof findAuthorizedSession>>;

function quarantineReference(session: { quarantineKey: string; provider: string }) {
  return {
    storageKey: session.quarantineKey,
    storageBackend: "OBJECT" as const,
    storageProvider: session.provider,
    visibility: "PRIVATE" as const,
  };
}

function multipartIdentity(session: { quarantineKey: string; providerUploadId: string }) {
  return { scope: "private" as const, key: session.quarantineKey, uploadId: session.providerUploadId };
}

async function creationPreflight(input: CreationDirectUploadInitInput) {
  const creation = await prisma.creation.findUnique({
    where: { id: input.creationId },
    select: {
      slug: true,
      status: true,
      lockVersion: true,
      assets: { where: { role: input.role }, select: { assetId: true } },
    },
  });
  if (!creation || creation.status === "ARCHIVED" || creation.slug !== input.slug) {
    throw new CreationDirectUploadError("INVALID_REQUEST", "Création indisponible.");
  }
  if (creation.lockVersion !== input.expectedLockVersion || (creation.assets[0]?.assetId ?? null) !== input.expectedAssetId) {
    throw new CreationDirectUploadError("MEDIA_CONFLICT", "La création a changé. Rechargez la page.");
  }
}

async function findAuthorizedSession(sessionToken: unknown, actorUserId: string) {
  assertDatabaseConfigured();
  const token = parseSessionToken(sessionToken);
  const session = await prisma.creationMediaUploadSession.findUnique({ where: { id: token.id } });
  if (!session || session.actorUserId !== actorUserId || !sessionTokenHashMatches(token.token, session.tokenHash)) {
    throw new CreationDirectUploadError("INVALID_SESSION");
  }
  return { ...session, sessionToken: token.token };
}

function storageFor(session: { provider: string }) {
  const storage = activeMultipartMediaStorage();
  if (storage.provider !== session.provider) throw new CreationDirectUploadError("STORAGE_INTEGRITY");
  return storage;
}

function objectStorageFor(session: { provider: string }) {
  const storage = activeMediaStorage();
  if (storage.backend !== "OBJECT" || storage.provider !== session.provider) {
    throw new CreationDirectUploadError("STORAGE_INTEGRITY");
  }
  return storage;
}

async function cleanupOwnedSession(
  session: NonNullable<UploadSession>,
  options: { abortMultipart: boolean; terminalStatus: "ABORTED" | "EXPIRED"; baseError: string | null },
) {
  let failed = false;
  if (options.abortMultipart) {
    try { await storageFor(session).abortMultipartUpload(multipartIdentity(session)); }
    catch { failed = true; }
  }
  try { await objectStorageFor(session).delete({ scope: "private", key: session.quarantineKey }); }
  catch (error) {
    if (!(error instanceof MediaStorageError) || error.code !== "NOT_FOUND") failed = true;
  }
  await prisma.creationMediaUploadSession.updateMany({
    where: { id: session.id, status: options.terminalStatus },
    data: { lastErrorCode: failed ? `${options.terminalStatus}_CLEANUP_REQUIRED` : options.baseError },
  });
}

async function expireIfNeeded(session: NonNullable<UploadSession>, now = new Date()) {
  if (session.status !== "UPLOADING" || session.expiresAt.getTime() > now.getTime()) return session;
  const claimed = await prisma.creationMediaUploadSession.updateMany({
    where: { id: session.id, status: "UPLOADING", expiresAt: { lte: now } },
    data: { status: "EXPIRED", lastErrorCode: "EXPIRED_CLEANUP_REQUIRED", validationFinishedAt: now },
  });
  if (claimed.count === 1) {
    await cleanupOwnedSession(session, { abortMultipart: true, terminalStatus: "EXPIRED", baseError: "SESSION_EXPIRED" });
  }
  return findAuthorizedSession(session.sessionToken, session.actorUserId);
}

function validatePartSet(session: NonNullable<UploadSession>, parts: MediaMultipartPart[]) {
  if (parts.length !== session.partCount) throw new CreationDirectUploadError("INCOMPLETE_UPLOAD");
  let total = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const partNumber = index + 1;
    if (part.partNumber !== partNumber || part.sizeBytes !== expectedDirectUploadPartSize(Number(session.declaredSizeBytes), partNumber) || !part.etag) {
      throw new CreationDirectUploadError("INCOMPLETE_UPLOAD");
    }
    total += part.sizeBytes;
  }
  if (total !== Number(session.declaredSizeBytes)) throw new CreationDirectUploadError("STORAGE_INTEGRITY");
}

async function completedParts(session: NonNullable<UploadSession>): Promise<CreationDirectUploadPart[]> {
  if (session.status !== "UPLOADING") return [];
  const parts = await storageFor(session).listMultipartParts(multipartIdentity(session));
  return parts.map(({ partNumber, etag, sizeBytes }) => ({ partNumber, etag, sizeBytes }));
}

export function directUploadStatusResponse(
  session: NonNullable<UploadSession>,
  parts: CreationDirectUploadPart[],
  baseUrl: string,
): CreationDirectUploadStatusResponse {
  const ready = session.status === "READY" && session.resultAssetId && session.resultLockVersion;
  return {
    ok: true,
    sessionToken: session.sessionToken,
    status: session.status,
    state: directUploadState(session.status, session.lastErrorCode),
    expiresAt: session.expiresAt.toISOString(),
    partSizeBytes: session.partSizeBytes,
    partCount: session.partCount,
    completedParts: parts,
    errorCode: session.lastErrorCode,
    currentAssetId: ready ? session.resultAssetId : null,
    currentLockVersion: ready ? session.resultLockVersion : null,
    location: ready
      ? new URL(`/admin/creations/${encodeURIComponent(session.creationSlug)}?etat=media-enregistre`, baseUrl).toString()
      : null,
  };
}

export async function initializeCreationVideoUpload(input: { actorUserId: string; media: CreationDirectUploadInitInput; now?: Date }) {
  assertDatabaseConfigured();
  await creationPreflight(input.media);
  const storage = activeMultipartMediaStorage();
  const sessionId = randomUUID();
  const activationAssetId = randomUUID();
  const uploadToken = newSessionToken(sessionId);
  const quarantineKey = `creations/quarantine/${input.media.creationId}/${randomUUID()}/video.mp4`;
  const now = input.now ?? new Date();
  const multipart = await storage.createMultipartUpload({
    scope: "private",
    key: quarantineKey,
    contentType: input.media.mimeType,
    metadata: {
      "lnx-session-id": sessionId,
      "lnx-creation-id": input.media.creationId,
      "lnx-declared-size": String(input.media.sizeBytes),
    },
  });
  try {
    const session = await prisma.creationMediaUploadSession.create({
      data: {
        id: sessionId,
        tokenHash: sessionTokenHash(uploadToken),
        creationId: input.media.creationId,
        creationSlug: input.media.slug,
        actorUserId: input.actorUserId,
        role: "VIDEO",
        expectedLockVersion: input.media.expectedLockVersion,
        expectedAssetId: input.media.expectedAssetId,
        rightsConfirmed: true,
        alt: input.media.alt,
        originalFilename: input.media.filename,
        declaredMimeType: "video/mp4",
        declaredSizeBytes: BigInt(input.media.sizeBytes),
        quarantineKey,
        provider: storage.provider,
        providerUploadId: multipart.uploadId,
        partSizeBytes: CREATION_DIRECT_UPLOAD_PART_SIZE_BYTES,
        partCount: directUploadPartCount(input.media.sizeBytes),
        expiresAt: directUploadExpiry(now),
        availableAt: now,
        resultAssetId: activationAssetId,
      },
    });
    return { ...session, sessionToken: uploadToken };
  } catch (error) {
    await storage.abortMultipartUpload({ scope: "private", key: quarantineKey, uploadId: multipart.uploadId }).catch(() => undefined);
    throw error;
  }
}

async function assertCompletedQuarantineObject(session: NonNullable<UploadSession>) {
  const object = await headMediaObject(quarantineReference(session));
  if (
    object.contentLength !== Number(session.declaredSizeBytes)
    || object.contentType !== session.declaredMimeType
    || object.customMetadata?.["lnx-session-id"] !== session.id
    || object.customMetadata?.["lnx-creation-id"] !== session.creationId
    || object.customMetadata?.["lnx-declared-size"] !== String(session.declaredSizeBytes)
  ) throw new CreationDirectUploadError("STORAGE_INTEGRITY");
  return object;
}

export async function getCreationVideoUploadStatus(input: { actorUserId: string; sessionToken: unknown; baseUrl: string }) {
  let session = await expireIfNeeded(await findAuthorizedSession(input.sessionToken, input.actorUserId));
  let parts: CreationDirectUploadPart[] = [];
  if (session.status === "UPLOADING") {
    try { parts = await completedParts(session); }
    catch (error) {
      try {
        await assertCompletedQuarantineObject(session);
        await prisma.creationMediaUploadSession.updateMany({
          where: { id: session.id, status: "UPLOADING" },
          data: { status: "QUARANTINE", completedAt: new Date(), availableAt: new Date() },
        });
        session = await findAuthorizedSession(session.sessionToken, session.actorUserId);
      } catch { throw error; }
    }
  }
  return directUploadStatusResponse(session, parts, input.baseUrl);
}

export async function createCreationVideoPartUrl(input: { actorUserId: string; sessionToken: unknown; partNumber: unknown; now?: Date }) {
  const session = await expireIfNeeded(await findAuthorizedSession(input.sessionToken, input.actorUserId), input.now ?? new Date());
  if (session.status === "EXPIRED") throw new CreationDirectUploadError("SESSION_EXPIRED");
  if (session.status !== "UPLOADING") throw new CreationDirectUploadError("INVALID_STATE");
  if (!Number.isSafeInteger(input.partNumber) || Number(input.partNumber) < 1 || Number(input.partNumber) > session.partCount) {
    throw new CreationDirectUploadError("INVALID_PART");
  }
  const url = await storageFor(session).createMultipartPartSignedUrl({
    ...multipartIdentity(session),
    partNumber: Number(input.partNumber),
    expiresInSeconds: CREATION_DIRECT_UPLOAD_PART_URL_TTL_SECONDS,
  });
  return { ok: true as const, url };
}

function normalizeCompletionParts(value: unknown, partCount: number) {
  if (!Array.isArray(value) || value.length !== partCount) throw new CreationDirectUploadError("INCOMPLETE_UPLOAD");
  const seen = new Set<number>();
  const parts = value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new CreationDirectUploadError("INCOMPLETE_UPLOAD");
    const record = candidate as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 || !("partNumber" in record) || !("etag" in record)
      || !Number.isSafeInteger(record.partNumber) || Number(record.partNumber) < 1 || Number(record.partNumber) > partCount
      || typeof record.etag !== "string" || record.etag.length < 1 || record.etag.length > 256 || /[\r\n]/.test(record.etag)
      || seen.has(Number(record.partNumber))
    ) throw new CreationDirectUploadError("INCOMPLETE_UPLOAD");
    seen.add(Number(record.partNumber));
    return { partNumber: Number(record.partNumber), etag: record.etag };
  });
  return parts.sort((left, right) => left.partNumber - right.partNumber);
}

export async function completeCreationVideoUpload(input: { actorUserId: string; sessionToken: unknown; parts: unknown; baseUrl: string }) {
  let session = await expireIfNeeded(await findAuthorizedSession(input.sessionToken, input.actorUserId));
  if (session.status === "EXPIRED") throw new CreationDirectUploadError("SESSION_EXPIRED");
  if (session.status !== "UPLOADING") return directUploadStatusResponse(session, [], input.baseUrl);
  const requested = normalizeCompletionParts(input.parts, session.partCount);
  const providerParts = await completedParts(session);
  validatePartSet(session, providerParts);
  if (requested.some((part, index) => part.partNumber !== providerParts[index]?.partNumber || part.etag !== providerParts[index]?.etag)) {
    throw new CreationDirectUploadError("INCOMPLETE_UPLOAD");
  }
  try {
    await storageFor(session).completeMultipartUpload({ ...multipartIdentity(session), parts: requested });
  } catch (error) {
    try { await assertCompletedQuarantineObject(session); }
    catch { throw error; }
  }
  await assertCompletedQuarantineObject(session);
  await prisma.creationMediaUploadSession.updateMany({
    where: { id: session.id, status: "UPLOADING" },
    data: { status: "QUARANTINE", completedAt: new Date(), availableAt: new Date(), lastErrorCode: null },
  });
  session = await findAuthorizedSession(session.sessionToken, session.actorUserId);
  return directUploadStatusResponse(session, [], input.baseUrl);
}

export async function abortCreationVideoUpload(input: { actorUserId: string; sessionToken: unknown; baseUrl: string }) {
  let session = await findAuthorizedSession(input.sessionToken, input.actorUserId);
  if (TERMINAL_STATUSES.has(session.status)) return directUploadStatusResponse(session, [], input.baseUrl);
  if (session.status === "VALIDATING") throw new CreationDirectUploadError("INVALID_STATE", "La validation finale a déjà commencé.");
  const previousStatus = session.status;
  const claimed = await prisma.creationMediaUploadSession.updateMany({
    where: { id: session.id, status: previousStatus },
    data: { status: "ABORTED", validationFinishedAt: new Date(), lastErrorCode: "ABORTED_CLEANUP_REQUIRED" },
  });
  if (claimed.count === 1) {
    await cleanupOwnedSession(session, { abortMultipart: previousStatus === "UPLOADING", terminalStatus: "ABORTED", baseError: null });
  }
  session = await findAuthorizedSession(session.sessionToken, session.actorUserId);
  if (session.status === "VALIDATING") throw new CreationDirectUploadError("INVALID_STATE");
  return directUploadStatusResponse(session, [], input.baseUrl);
}

export async function expireAbandonedCreationVideoUploads(limit = 25, now = new Date()) {
  assertDatabaseConfigured();
  const sessions = await prisma.creationMediaUploadSession.findMany({
    where: { status: "UPLOADING", expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
  });
  let expired = 0;
  for (const session of sessions) {
    const claimed = await prisma.creationMediaUploadSession.updateMany({
      where: { id: session.id, status: "UPLOADING", expiresAt: { lte: now } },
      data: { status: "EXPIRED", lastErrorCode: "EXPIRED_CLEANUP_REQUIRED", validationFinishedAt: now },
    });
    if (claimed.count !== 1) continue;
    expired += 1;
    await cleanupOwnedSession(
      { ...session, sessionToken: "" },
      { abortMultipart: true, terminalStatus: "EXPIRED", baseError: "SESSION_EXPIRED" },
    );
  }
  return expired;
}
