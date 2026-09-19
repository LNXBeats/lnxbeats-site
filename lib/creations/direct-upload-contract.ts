import type { CreationMediaRole } from "@/lib/creations/media-contract";

export const CREATION_DIRECT_UPLOAD_PART_SIZE_BYTES = 8 * 1024 * 1024;
export const CREATION_DIRECT_UPLOAD_CONCURRENCY = 2;
export const CREATION_DIRECT_UPLOAD_SESSION_TTL_SECONDS = 60 * 60;
export const CREATION_DIRECT_UPLOAD_PART_URL_TTL_SECONDS = 5 * 60;
export const CREATION_DIRECT_UPLOAD_POLL_SECONDS = 3;

export const CREATION_DIRECT_UPLOAD_STATUSES = [
  "UPLOADING", "QUARANTINE", "VALIDATING", "READY", "REJECTED", "ABORTED", "EXPIRED",
] as const;

export type CreationDirectUploadStatus = typeof CREATION_DIRECT_UPLOAD_STATUSES[number];

export type CreationDirectUploadPart = {
  partNumber: number;
  etag: string;
  sizeBytes: number;
};

export type CreationDirectUploadInitInput = {
  creationId: string;
  slug: string;
  expectedLockVersion: number;
  expectedAssetId: string | null;
  rightsConfirmed: true;
  alt: string | null;
  role: Extract<CreationMediaRole, "VIDEO">;
  filename: string;
  mimeType: "video/mp4";
  sizeBytes: number;
};

export type CreationDirectUploadStatusResponse = {
  ok: true;
  sessionToken: string;
  status: CreationDirectUploadStatus;
  state: string;
  expiresAt: string;
  partSizeBytes: number;
  partCount: number;
  completedParts: CreationDirectUploadPart[];
  errorCode: string | null;
  currentAssetId: string | null;
  currentLockVersion: number | null;
  location: string | null;
};
