import { Readable } from "node:stream";
import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { assertMediaStorageKey, safeContentDisposition } from "@/lib/media/storage/policy";
import {
  MediaStorageError,
  type MediaObject,
  type MediaObjectMetadata,
  type MediaScope,
  type MediaSignedUrlInput,
  type MediaStorage,
  type MediaStorageGetInput,
  type MediaStoragePutInput,
} from "@/lib/media/storage/types";

type S3LikeClient = Pick<S3Client, "send">;

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
): never {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "NoSuchKey" || name === "NotFound") throw new MediaStorageError("NOT_FOUND", "Media object not found.");
  throw new MediaStorageError(
    "PROVIDER",
    "The object storage provider rejected the media operation.",
    safeProviderCode(error),
    safeProviderStatusCode(error),
    cleanupOutcome,
  );
}

export class S3MediaStorage implements MediaStorage {
  readonly backend = "OBJECT" as const;
  readonly provider: string;
  private readonly buckets: Record<MediaScope, string>;
  private readonly client: S3LikeClient;
  private readonly signer: typeof getSignedUrl;
  private readonly operationTimeoutMs: number;

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
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.forcePathStyle !== undefined ? { forcePathStyle: options.forcePathStyle } : {}),
    };
    this.client = options.client ?? new S3Client(config);
    this.signer = options.signer ?? getSignedUrl;
    this.operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OBJECT_OPERATION_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.operationTimeoutMs) || this.operationTimeoutMs < 1_000) {
      throw new MediaStorageError("CONFIGURATION", "Object storage operation timeout is invalid.");
    }
  }

  private bucket(scope: MediaScope, key: string) {
    assertMediaStorageKey(scope, key);
    return this.buckets[scope];
  }

  private async uploadStream(parameters: PutObjectCommandInput) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.operationTimeoutMs);
    timeout.unref();
    try {
      const upload = new Upload({
        client: this.client as S3Client,
        params: parameters,
        queueSize: S3_MULTIPART_QUEUE_SIZE,
        partSize: S3_MULTIPART_PART_SIZE_BYTES,
        leavePartsOnError: false,
        abortController,
      });
      return await upload.done();
    } finally {
      clearTimeout(timeout);
    }
  }

  async put(input: MediaStoragePutInput): Promise<MediaObjectMetadata> {
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
        ? await this.client.send(
            new PutObjectCommand(parameters),
            { abortSignal: AbortSignal.timeout(this.operationTimeoutMs) },
          )
        : await this.uploadStream(parameters);
      const verified = await this.head({ scope: input.scope, key: input.key });
      if (verified.contentLength !== input.contentLength) {
        throw new MediaStorageError("INTEGRITY", "The stored media size does not match its metadata.");
      }
      if (verified.checksumSha256 !== input.checksumSha256) {
        throw new MediaStorageError("INTEGRITY", "The stored media checksum does not match its metadata.");
      }
      if (verified.contentType !== input.contentType) {
        throw new MediaStorageError("INTEGRITY", "The stored media type does not match its metadata.");
      }
      const storedChecksumSha256 = await streamSha256((await this.get({ scope: input.scope, key: input.key })).body);
      if (storedChecksumSha256 !== input.checksumSha256) {
        throw new MediaStorageError("INTEGRITY", "The stored media content does not match its checksum.");
      }
      return { ...verified, etag: result.ETag ?? verified.etag };
    } catch (error) {
      let cleanupOutcome: MediaStorageError["cleanupOutcome"] = "not_required";
      if (putAttempted) {
        try {
          await this.client.send(
            new DeleteObjectCommand({ Bucket: bucket, Key: input.key }),
            { abortSignal: AbortSignal.timeout(this.operationTimeoutMs) },
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
        );
      }
      return providerError(error, cleanupOutcome);
    }
  }

  async head(input: { scope: MediaScope; key: string }): Promise<MediaObjectMetadata> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket(input.scope, input.key), Key: input.key }),
        { abortSignal: AbortSignal.timeout(this.operationTimeoutMs) },
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
    try {
      const result = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket(input.scope, input.key),
        Key: input.key,
        ...(input.range ? { Range: `bytes=${input.range.start}-${input.range.end}` } : {}),
      }), { abortSignal: AbortSignal.timeout(this.operationTimeoutMs) });
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
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket(input.scope, input.key), Key: input.key }),
        { abortSignal: AbortSignal.timeout(this.operationTimeoutMs) },
      );
    } catch (error) {
      return providerError(error);
    }
  }

  async createSignedUrl(input: MediaSignedUrlInput) {
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
      return await this.signer(this.client as S3Client, command, { expiresIn: input.expiresInSeconds });
    } catch (error) {
      return providerError(error);
    }
  }
}
