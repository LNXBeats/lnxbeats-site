import "server-only";

import { Readable } from "node:stream";
import { createHash } from "node:crypto";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type S3ClientConfig,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  withMemoryDiagnosticCounter,
  withMemoryDiagnosticOperation,
  type MemoryDiagnostics,
} from "@/lib/memory-diagnostics";
import { assertMediaStorageKey, safeContentDisposition } from "@/lib/media/storage/policy";
import {
  MediaStorageError,
  type MediaObject,
  type MediaObjectMetadata,
  type MediaStorageObjectState,
  type MediaStorageProviderOperation,
  type MediaScope,
  type MediaSignedUrlInput,
  type MediaStorage,
  type MediaStorageGetInput,
  type MediaStoragePutInput,
} from "@/lib/media/storage/types";

type S3LikeClient = Pick<S3Client, "config" | "send">;
type S3ClientFactory = (configuration: S3ClientConfig) => S3LikeClient;

const defaultS3ClientFactory: S3ClientFactory = (configuration) => new S3Client(configuration);
let s3ClientFactory: S3ClientFactory = defaultS3ClientFactory;

type S3MemoryDiagnostics = Pick<MemoryDiagnostics, "withCounter" | "withOperation">;

const processS3MemoryDiagnostics: S3MemoryDiagnostics = {
  withCounter: withMemoryDiagnosticCounter,
  withOperation: withMemoryDiagnosticOperation,
};

const DEFAULT_OBJECT_OPERATION_TIMEOUT_MS = 180_000;
export const S3_MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;
export const S3_MULTIPART_QUEUE_SIZE = 2;

export type S3MediaStorageOptions = {
  provider: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBucket: string;
  privateBucket: string;
  forcePathStyle?: boolean;
  client?: S3LikeClient;
  signer?: typeof getSignedUrl;
  operationTimeoutMs?: number;
  requestHandler?: S3ClientConfig["requestHandler"];
  memoryDiagnostics?: S3MemoryDiagnostics;
};

async function streamSha256(body: ReadableStream<Uint8Array>) {
  const hash = createHash("sha256");
  for await (const chunk of Readable.fromWeb(body as never)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function safeProviderCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = "code" in error && typeof error.code === "string"
    ? error.code
    : "name" in error && typeof error.name === "string"
      ? error.name
      : null;
  return candidate && /^[A-Za-z0-9_.:-]{1,80}$/.test(candidate) ? candidate : null;
}

function safeProviderStatusCode(error: unknown) {
  if (!error || typeof error !== "object" || !("$metadata" in error)) return null;
  const metadata = error.$metadata;
  if (!metadata || typeof metadata !== "object" || !("httpStatusCode" in metadata)) return null;
  return typeof metadata.httpStatusCode === "number" && Number.isSafeInteger(metadata.httpStatusCode)
    ? metadata.httpStatusCode
    : null;
}

function providerError(
  error: unknown,
  cleanupOutcome: MediaStorageError["cleanupOutcome"] = "not_required",
  providerOperation: MediaStorageProviderOperation | null = null,
  objectState: MediaStorageObjectState | null = null,
): never {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "NoSuchKey" || name === "NotFound") throw new MediaStorageError("NOT_FOUND", "Media object not found.");
  throw new MediaStorageError(
    "PROVIDER",
    "The object storage provider rejected the media operation.",
    safeProviderCode(error),
    safeProviderStatusCode(error),
    cleanupOutcome,
    providerOperation,
    objectState,
  );
}

function multipartOperation(command: unknown): MediaStorageProviderOperation | null {
  if (command instanceof CreateMultipartUploadCommand) return "MULTIPART_CREATE";
  if (command instanceof UploadPartCommand) return "MULTIPART_UPLOAD_PART";
  if (command instanceof CompleteMultipartUploadCommand) return "MULTIPART_COMPLETE";
  return null;
}

function isNoSuchUpload(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : null;
  const name = "name" in error && typeof error.name === "string" ? error.name : null;
  return code === "NoSuchUpload" || name === "NoSuchUpload";
}

class ManagedMultipartUploadError extends Error {
  constructor(
    readonly originalError: unknown,
    readonly providerOperation: MediaStorageProviderOperation,
    readonly cleanupOutcome: MediaStorageError["cleanupOutcome"],
    readonly objectState: MediaStorageObjectState,
  ) {
    super("Managed multipart upload failed.");
    this.name = "ManagedMultipartUploadError";
  }
}

export class S3MediaStorage implements MediaStorage {
  readonly backend = "OBJECT" as const;
  readonly provider: string;
  private readonly buckets: Record<MediaScope, string>;
  private readonly client: S3LikeClient;
  private readonly signer: typeof getSignedUrl;
  private readonly operationTimeoutMs: number;
  private readonly memoryDiagnostics: S3MemoryDiagnostics;

  constructor(options: S3MediaStorageOptions) {
    if (!options.publicBucket || !options.privateBucket || options.publicBucket === options.privateBucket) {
      throw new MediaStorageError("CONFIGURATION", "Public and private object storage buckets must be distinct.");
    }
    this.provider = options.provider;
    this.buckets = { public: options.publicBucket, private: options.privateBucket };
    const config: S3ClientConfig = {
      region: options.region,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
      // Cloudflare R2 does not support HTTP 100 Continue. AWS SDK v3 adds
      // Expect: 100-continue to bodies >= 2 MiB unless this is disabled.
      ...(options.provider === "r2" ? { expectContinueHeader: false } : {}),
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.forcePathStyle !== undefined ? { forcePathStyle: options.forcePathStyle } : {}),
      ...(options.requestHandler ? { requestHandler: options.requestHandler } : {}),
    };
    this.client = options.client ?? s3ClientFactory(config);
    this.signer = options.signer ?? getSignedUrl;
    this.memoryDiagnostics = options.memoryDiagnostics ?? processS3MemoryDiagnostics;
    this.operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OBJECT_OPERATION_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.operationTimeoutMs) || this.operationTimeoutMs < 1_000) {
      throw new MediaStorageError("CONFIGURATION", "Object storage operation timeout is invalid.");
    }
  }

  private bucket(scope: MediaScope, key: string) {
    assertMediaStorageKey(scope, key);
    return this.buckets[scope];
  }

  private instrumentOperation<T>(operation: () => Promise<T>) {
    return this.memoryDiagnostics.withOperation("s3Operation", operation);
  }

  private countSdkOperation<T>(operation: () => Promise<T>) {
    return this.memoryDiagnostics.withCounter("s3Operation", operation);
  }

  private async uploadStream(parameters: PutObjectCommandInput) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.operationTimeoutMs);
    timeout.unref();
    let failedOperation: MediaStorageProviderOperation | null = null;
    const trackedClient = {
      config: this.client.config,
      send: async (command: unknown) => {
        try {
          return await this.countSdkOperation(() => this.client.send(command as never));
        } catch (error) {
          failedOperation ??= multipartOperation(command);
          throw error;
        }
      },
    } as unknown as S3Client;
    let upload: Upload | null = null;
    try {
      upload = new Upload({
        client: trackedClient,
        params: parameters,
        queueSize: S3_MULTIPART_QUEUE_SIZE,
        partSize: S3_MULTIPART_PART_SIZE_BYTES,
        // Cleanup is explicit below so the application can distinguish an
        // initiation failure from an incomplete or possibly completed upload.
        leavePartsOnError: true,
        abortController,
      });
      return await upload.done();
    } catch (error) {
      const operation =
        (failedOperation as MediaStorageProviderOperation | null) ?? "MULTIPART_SOURCE";
      const uploadId = upload?.uploadId;
      if (!uploadId) {
        throw new ManagedMultipartUploadError(error, operation, "not_required", "none");
      }
      try {
        await this.countSdkOperation(() => this.client.send(
            new AbortMultipartUploadCommand({
              Bucket: parameters.Bucket,
              Key: parameters.Key,
              UploadId: uploadId,
            }),
            { abortSignal: AbortSignal.timeout(this.operationTimeoutMs) },
          ),
        );
        throw new ManagedMultipartUploadError(error, operation, "succeeded", "multipart_aborted");
      } catch (abortError) {
        if (abortError instanceof ManagedMultipartUploadError) throw abortError;
        if (operation === "MULTIPART_COMPLETE" && isNoSuchUpload(abortError)) {
          try {
            await this.countSdkOperation(() => this.client.send(
                new DeleteObjectCommand({ Bucket: parameters.Bucket, Key: parameters.Key }),
                { abortSignal: AbortSignal.timeout(this.operationTimeoutMs) },
              ),
            );
            throw new ManagedMultipartUploadError(error, operation, "succeeded", "final_object_deleted");
          } catch (deleteError) {
            if (deleteError instanceof ManagedMultipartUploadError) throw deleteError;
            throw new ManagedMultipartUploadError(error, operation, "failed", "final_object_possible");
          }
        }
        throw new ManagedMultipartUploadError(error, operation, "failed", "multipart_incomplete");
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async put(input: MediaStoragePutInput): Promise<MediaObjectMetadata> {
    return this.instrumentOperation(() => this.putObject(input));
  }

  private async putObject(input: MediaStoragePutInput): Promise<MediaObjectMetadata> {
    const bucket = this.bucket(input.scope, input.key);
    // Application writes always use a fresh, server-generated object key. Mark
    // the attempt before awaiting R2: the provider may persist the object and
    // lose the response (timeout/reset), in which case cleanup is still needed.
    let putAttempted = false;
    try {
      putAttempted = true;
      const parameters: PutObjectCommandInput = {
        Bucket: bucket,
        Key: input.key,
        Body: input.body,
        ContentLength: input.contentLength,
        ContentType: input.contentType,
        CacheControl: input.scope === "public" ? "public, max-age=31536000, immutable" : "private, no-store",
        ...(input.contentDisposition ? { ContentDisposition: input.contentDisposition } : {}),
        Metadata: { "sha256": input.checksumSha256 },
      };
      // A raw Node Readable is not replayable by Smithy's retry middleware.
      // The managed uploader buffers only bounded parts, so each UploadPart
      // request is retryable without ever loading a 200 MiB delivery in RAM.
      const result = input.body instanceof Uint8Array
        ? await this.countSdkOperation(() => this.client.send(
              new PutObjectCommand(parameters),
              { abortSignal: AbortSignal.timeout(this.operationTimeoutMs) },
            ),
          )
        : await this.uploadStream(parameters);
      const verified = await this.headObject({ scope: input.scope, key: input.key });
      if (verified.contentLength !== input.contentLength) {
        throw new MediaStorageError("INTEGRITY", "The stored media size does not match its metadata.");
      }
      if (verified.checksumSha256 !== input.checksumSha256) {
        throw new MediaStorageError("INTEGRITY", "The stored media checksum does not match its metadata.");
      }
      if (verified.contentType !== input.contentType) {
        throw new MediaStorageError("INTEGRITY", "The stored media type does not match its metadata.");
      }
      const storedChecksumSha256 = await streamSha256((await this.getObject({ scope: input.scope, key: input.key })).body);
      if (storedChecksumSha256 !== input.checksumSha256) {
        throw new MediaStorageError("INTEGRITY", "The stored media content does not match its checksum.");
      }
      return { ...verified, etag: result.ETag ?? verified.etag };
    } catch (error) {
      if (error instanceof ManagedMultipartUploadError) {
        return providerError(
          error.originalError,
          error.cleanupOutcome,
          error.providerOperation,
          error.objectState,
        );
      }
      let cleanupOutcome: MediaStorageError["cleanupOutcome"] = "not_required";
      if (putAttempted) {
        try {
          await this.countSdkOperation(() => this.client.send(
              new DeleteObjectCommand({ Bucket: bucket, Key: input.key }),
              { abortSignal: AbortSignal.timeout(this.operationTimeoutMs) },
            ),
          );
          cleanupOutcome = "succeeded";
        } catch {
          cleanupOutcome = "failed";
        }
      }
      if (error instanceof MediaStorageError) {
        throw new MediaStorageError(
          error.code,
          error.message,
          error.providerCode,
          error.providerStatusCode,
          cleanupOutcome,
          error.providerOperation,
          cleanupOutcome === "succeeded" ? "final_object_deleted" : "final_object_possible",
        );
      }
      return providerError(
        error,
        cleanupOutcome,
        null,
        cleanupOutcome === "succeeded" ? "final_object_deleted" : "final_object_possible",
      );
    }
  }

  async head(input: { scope: MediaScope; key: string }): Promise<MediaObjectMetadata> {
    return this.instrumentOperation(() => this.headObject(input));
  }

  private async headObject(input: { scope: MediaScope; key: string }): Promise<MediaObjectMetadata> {
    try {
      const result = await this.countSdkOperation(() => this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket(input.scope, input.key), Key: input.key }),
          { abortSignal: AbortSignal.timeout(this.operationTimeoutMs) },
        ),
      );
      if (result.ContentLength === undefined) throw new MediaStorageError("INTEGRITY", "Object metadata is incomplete.");
      return {
        contentLength: result.ContentLength,
        contentType: result.ContentType ?? null,
        etag: result.ETag ?? null,
        checksumSha256: result.Metadata?.sha256 ?? null,
        lastModified: result.LastModified ?? null,
      };
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      return providerError(error);
    }
  }

  async get(input: MediaStorageGetInput): Promise<MediaObject> {
    return this.instrumentOperation(() => this.getObject(input));
  }

  private async getObject(input: MediaStorageGetInput): Promise<MediaObject> {
    try {
      const result = await this.countSdkOperation(() => this.client.send(new GetObjectCommand({
          Bucket: this.bucket(input.scope, input.key),
          Key: input.key,
          ...(input.range ? { Range: `bytes=${input.range.start}-${input.range.end}` } : {}),
        }), { abortSignal: AbortSignal.timeout(this.operationTimeoutMs) }),
      );
      if (!result.Body || result.ContentLength === undefined) throw new MediaStorageError("NOT_FOUND", "Media object not found.");
      const body = "transformToWebStream" in result.Body
        ? result.Body.transformToWebStream()
        : Readable.toWeb(result.Body as Readable) as ReadableStream<Uint8Array>;
      return {
        body,
        contentLength: result.ContentLength,
        contentType: result.ContentType ?? null,
        etag: result.ETag ?? null,
        checksumSha256: result.Metadata?.sha256 ?? null,
        lastModified: result.LastModified ?? null,
      };
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      return providerError(error);
    }
  }

  async delete(input: { scope: MediaScope; key: string }) {
    return this.instrumentOperation(() => this.deleteObject(input));
  }

  private async deleteObject(input: { scope: MediaScope; key: string }) {
    try {
      await this.countSdkOperation(() => this.client.send(
          new DeleteObjectCommand({ Bucket: this.bucket(input.scope, input.key), Key: input.key }),
          { abortSignal: AbortSignal.timeout(this.operationTimeoutMs) },
        ),
      );
    } catch (error) {
      return providerError(error);
    }
  }

  async createSignedUrl(input: MediaSignedUrlInput) {
    return this.instrumentOperation(() => this.createSignedUrlForObject(input));
  }

  private async createSignedUrlForObject(input: MediaSignedUrlInput) {
    if (!Number.isSafeInteger(input.expiresInSeconds) || input.expiresInSeconds < 30 || input.expiresInSeconds > 900) {
      throw new MediaStorageError("CONFIGURATION", "Private signed URLs must expire between 30 and 900 seconds.");
    }
    const bucket = this.bucket("private", input.key);
    const command = input.operation === "get"
      ? new GetObjectCommand({
          Bucket: bucket,
          Key: input.key,
          ...(input.downloadFilename ? { ResponseContentDisposition: safeContentDisposition("attachment", input.downloadFilename) } : {}),
        })
      : new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          ...(input.contentType ? { ContentType: input.contentType } : {}),
          ...(input.contentLength !== undefined ? { ContentLength: input.contentLength } : {}),
          CacheControl: "private, no-store",
        });
    try {
      return await this.countSdkOperation(() => this.signer(
        this.client as S3Client,
        command,
        { expiresIn: input.expiresInSeconds },
      ));
    } catch (error) {
      return providerError(error);
    }
  }
}

/** @internal Test-only seam used to prove process-level client reuse without network access. */
export function setS3ClientFactoryForTests(factory: S3ClientFactory | null) {
  if (process.env.NODE_ENV !== "test") {
    throw new MediaStorageError("CONFIGURATION", "The S3 client factory can only be changed in tests.");
  }
  s3ClientFactory = factory ?? defaultS3ClientFactory;
}
