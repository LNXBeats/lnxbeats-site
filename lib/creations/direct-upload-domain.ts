import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";

import {
  CREATION_DIRECT_UPLOAD_PART_SIZE_BYTES,
  CREATION_DIRECT_UPLOAD_SESSION_TTL_SECONDS,
  type CreationDirectUploadInitInput,
  type CreationDirectUploadStatus,
} from "@/lib/creations/direct-upload-contract";
import { CREATION_VIDEO_MAXIMUM_BYTES, creationVideoInputFormat, type CreationVideoInputMimeType } from "@/lib/creations/media-contract";
import { parseCreationIdentity, parseCreationLockVersion, parseCreationSlug } from "@/lib/creations/validation";
import { sanitizeOriginalFilename } from "@/lib/orders/domain";

const TOKEN_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i;

export type CreationDirectUploadErrorCode =
  | "INVALID_REQUEST" | "INVALID_SESSION" | "SESSION_EXPIRED" | "INVALID_STATE"
  | "INVALID_PART" | "INCOMPLETE_UPLOAD" | "FILE_TOO_LARGE" | "UNSUPPORTED_FORMAT"
  | "STORAGE_INTEGRITY" | "MEDIA_CONFLICT" | "VALIDATION_FAILED" | "INTERNAL_ERROR";

export class CreationDirectUploadError extends Error {
  constructor(readonly code: CreationDirectUploadErrorCode, message: string = code) {
    super(message);
    this.name = "CreationDirectUploadError";
  }
}

function closedRecord(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CreationDirectUploadError("INVALID_REQUEST");
  const record = value as Record<string, unknown>;
  const expected = new Set(fields);
  if (Object.keys(record).some((key) => !expected.has(key))) throw new CreationDirectUploadError("INVALID_REQUEST");
  return record;
}

function optionalAlt(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new CreationDirectUploadError("INVALID_REQUEST");
  const normalized = value.trim();
  if (!normalized || normalized.length > 500) throw new CreationDirectUploadError("INVALID_REQUEST");
  return normalized;
}

export function parseCreationDirectUploadInit(value: unknown): CreationDirectUploadInitInput {
  const input = closedRecord(value, [
    "creationId", "slug", "expectedLockVersion", "expectedAssetId", "rightsConfirmed", "alt",
    "role", "filename", "mimeType", "sizeBytes",
  ]);
  let creationId: string;
  let slug: string;
  let expectedLockVersion: number;
  let expectedAssetId: string | null;
  try {
    creationId = parseCreationIdentity(input.creationId);
    slug = parseCreationSlug(input.slug);
    expectedLockVersion = parseCreationLockVersion(input.expectedLockVersion);
    expectedAssetId = input.expectedAssetId === null || input.expectedAssetId === ""
      ? null
      : parseCreationIdentity(input.expectedAssetId);
  } catch {
    throw new CreationDirectUploadError("INVALID_REQUEST");
  }
  if (input.role !== "VIDEO" || input.rightsConfirmed !== true) throw new CreationDirectUploadError("INVALID_REQUEST");
  if (typeof input.mimeType !== "string" || typeof input.filename !== "string") {
    throw new CreationDirectUploadError("UNSUPPORTED_FORMAT");
  }
  const filename = sanitizeOriginalFilename(input.filename);
  const format = creationVideoInputFormat(filename, input.mimeType);
  if (!format || path.extname(filename).toLowerCase() !== `.${format.extension}`) throw new CreationDirectUploadError("UNSUPPORTED_FORMAT");
  if (!Number.isSafeInteger(input.sizeBytes) || Number(input.sizeBytes) <= 0) {
    throw new CreationDirectUploadError("INVALID_REQUEST");
  }
  const sizeBytes = Number(input.sizeBytes);
  if (sizeBytes > CREATION_VIDEO_MAXIMUM_BYTES) throw new CreationDirectUploadError("FILE_TOO_LARGE");
  return {
    creationId, slug, expectedLockVersion, expectedAssetId, rightsConfirmed: true,
    alt: optionalAlt(input.alt), role: "VIDEO", filename, mimeType: input.mimeType as CreationVideoInputMimeType, sizeBytes,
  };
}

export function parseSessionToken(value: unknown) {
  if (typeof value !== "string") throw new CreationDirectUploadError("INVALID_SESSION");
  const match = value.match(TOKEN_PATTERN);
  if (!match) throw new CreationDirectUploadError("INVALID_SESSION");
  return { id: match[1]!.toLowerCase(), token: value };
}

export function newSessionToken(id: string) {
  return `${id}.${randomBytes(32).toString("base64url")}`;
}

export function sessionTokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionTokenHashMatches(token: string, expectedHash: string) {
  const actual = Buffer.from(sessionTokenHash(token), "hex");
  const expected = /^[0-9a-f]{64}$/i.test(expectedHash) ? Buffer.from(expectedHash, "hex") : Buffer.alloc(actual.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function directUploadPartCount(sizeBytes: number) {
  return Math.ceil(sizeBytes / CREATION_DIRECT_UPLOAD_PART_SIZE_BYTES);
}

export function expectedDirectUploadPartSize(sizeBytes: number, partNumber: number) {
  const partCount = directUploadPartCount(sizeBytes);
  if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > partCount) {
    throw new CreationDirectUploadError("INVALID_PART");
  }
  return partNumber === partCount
    ? sizeBytes - CREATION_DIRECT_UPLOAD_PART_SIZE_BYTES * (partCount - 1)
    : CREATION_DIRECT_UPLOAD_PART_SIZE_BYTES;
}

export function directUploadExpiry(now = new Date()) {
  return new Date(now.getTime() + CREATION_DIRECT_UPLOAD_SESSION_TTL_SECONDS * 1_000);
}

export function directUploadState(status: CreationDirectUploadStatus, errorCode: string | null) {
  if (status === "UPLOADING") return "media-upload";
  if (status === "QUARANTINE") return "media-quarantaine";
  if (status === "ANALYZING") return "media-analyse";
  if (status === "TRANSCODING") return "media-conversion";
  if (status === "VALIDATING") return "media-validation";
  if (status === "READY") return "media-enregistre";
  if (status === "ABORTED") return "media-annule";
  if (status === "EXPIRED") return "media-expire";
  if (errorCode === "MEDIA_CONFLICT") return "media-conflit";
  if (errorCode === "FILE_TOO_LARGE") return "media-trop-lourd";
  if (errorCode === "UNSUPPORTED_FORMAT") return "media-format";
  return "media-illisible";
}
