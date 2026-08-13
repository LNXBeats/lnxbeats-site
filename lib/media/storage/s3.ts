import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
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
};

function providerError(error: unknown): never {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "NoSuchKey" || name === "NotFound") throw new MediaStorageError("NOT_FOUND", "Media object not found.");
  throw new MediaStorageError("PROVIDER", "The object storage provider rejected the media operation.");
}

export class S3MediaStorage implements MediaStorage {
  readonly backend = "OBJECT" as const;
  readonly provider: string;
  private readonly buckets: Record<MediaScope, string>;
  private readonly client: S3LikeClient;
  private readonly signer: typeof getSignedUrl;

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
  }

  private bucket(scope: MediaScope, key: string) {
    assertMediaStorageKey(scope, key);
    return this.buckets[scope];
  }

  async put(input: MediaStoragePutInput): Promise<MediaObjectMetadata> {
    const bucket = this.bucket(input.scope, input.key);
    let uploaded = false;
    try {
      const result = await this.client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        Body: input.body,
        ContentLength: input.contentLength,
        ContentType: input.contentType,
        CacheControl: input.scope === "public" ? "public, max-age=31536000, immutable" : "private, no-store",
        ...(input.contentDisposition ? { ContentDisposition: input.contentDisposition } : {}),
        Metadata: { "sha256": input.checksumSha256 },
      }));
      uploaded = true;
      const verified = await this.head({ scope: input.scope, key: input.key });
      if (verified.contentLength !== input.contentLength) {
        throw new MediaStorageError("INTEGRITY", "The stored media size does not match its metadata.");
      }
      return { ...verified, etag: result.ETag ?? verified.etag, checksumSha256: input.checksumSha256 };
    } catch (error) {
      if (uploaded) {
        await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: input.key })).catch(() => undefined);
      }
      if (error instanceof MediaStorageError) throw error;
      return providerError(error);
    }
  }

  async head(input: { scope: MediaScope; key: string }): Promise<MediaObjectMetadata> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket(input.scope, input.key), Key: input.key }));
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
      }));
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
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(input.scope, input.key), Key: input.key }));
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
