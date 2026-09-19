import type { Readable } from "node:stream";

export type MediaScope = "public" | "private";
export type MediaStorageBackend = "LOCAL" | "OBJECT";
export type MediaStorageProviderOperation =
  | "MULTIPART_SOURCE"
  | "MULTIPART_CREATE"
  | "MULTIPART_UPLOAD_PART"
  | "MULTIPART_COMPLETE";
export type MediaStorageObjectState =
  | "none"
  | "multipart_aborted"
  | "multipart_incomplete"
  | "final_object_deleted"
  | "final_object_possible";

export type MediaStorageReference = {
  storageKey: string;
  storageBackend: MediaStorageBackend;
  storageProvider: string;
  visibility: "PUBLIC" | "PRIVATE";
};

export type MediaStoragePutInput = {
  scope: MediaScope;
  key: string;
  body: Uint8Array | Readable;
  contentLength: number;
  contentType: string;
  checksumSha256: string;
  contentDisposition?: string;
};

export type MediaStorageGetInput = {
  scope: MediaScope;
  key: string;
  range?: { start: number; end: number };
};

export type MediaObjectMetadata = {
  contentLength: number;
  contentType: string | null;
  etag: string | null;
  checksumSha256: string | null;
  lastModified: Date | null;
  customMetadata?: Record<string, string>;
};

export type MediaObject = MediaObjectMetadata & {
  body: ReadableStream<Uint8Array>;
};

export type MediaSignedUrlInput = {
  scope: MediaScope;
  key: string;
  operation: "get" | "put";
  expiresInSeconds: number;
  contentType?: string;
  contentLength?: number;
  downloadFilename?: string;
};

export type MediaMultipartPart = {
  partNumber: number;
  etag: string;
  sizeBytes: number;
};

export type MediaMultipartIdentity = {
  scope: MediaScope;
  key: string;
  uploadId: string;
};

export interface MediaMultipartStorage {
  readonly backend: "OBJECT";
  readonly provider: string;
  createMultipartUpload(input: {
    scope: MediaScope;
    key: string;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<{ uploadId: string }>;
  createMultipartPartSignedUrl(
    input: MediaMultipartIdentity & { partNumber: number; expiresInSeconds: number },
  ): Promise<string>;
  listMultipartParts(input: MediaMultipartIdentity): Promise<MediaMultipartPart[]>;
  completeMultipartUpload(
    input: MediaMultipartIdentity & { parts: Array<Pick<MediaMultipartPart, "partNumber" | "etag">> },
  ): Promise<{ etag: string | null }>;
  abortMultipartUpload(input: MediaMultipartIdentity): Promise<void>;
}

export interface MediaStorage {
  readonly backend: MediaStorageBackend;
  readonly provider: string;
  put(input: MediaStoragePutInput): Promise<MediaObjectMetadata>;
  get(input: MediaStorageGetInput): Promise<MediaObject>;
  head(input: Pick<MediaStorageGetInput, "scope" | "key">): Promise<MediaObjectMetadata>;
  delete(input: Pick<MediaStorageGetInput, "scope" | "key">): Promise<void>;
  createSignedUrl(input: MediaSignedUrlInput): Promise<string | null>;
}

export class MediaStorageError extends Error {
  constructor(
    readonly code: "CONFIGURATION" | "INVALID_KEY" | "NOT_FOUND" | "INTEGRITY" | "PROVIDER",
    message = "Media storage operation failed.",
    readonly providerCode: string | null = null,
    readonly providerStatusCode: number | null = null,
    readonly cleanupOutcome: "not_required" | "succeeded" | "failed" = "not_required",
    readonly providerOperation: MediaStorageProviderOperation | null = null,
    readonly objectState: MediaStorageObjectState | null = null,
  ) {
    super(message);
    this.name = "MediaStorageError";
  }
}
