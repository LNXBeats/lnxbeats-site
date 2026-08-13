import { createReadStream, createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { assertMediaStorageKey } from "@/lib/media/storage/policy";
import {
  MediaStorageError,
  type MediaObject,
  type MediaObjectMetadata,
  type MediaSignedUrlInput,
  type MediaStorage,
  type MediaStorageGetInput,
  type MediaStoragePutInput,
  type MediaScope,
} from "@/lib/media/storage/types";

export type LocalMediaStorageOptions = {
  publicRoot: string;
  privateRoot: string;
};

function resolvedRoot(root: string, label: string) {
  if (!path.isAbsolute(root)) throw new MediaStorageError("CONFIGURATION", `${label} must be an absolute directory.`);
  return path.resolve(root);
}

export class LocalMediaStorage implements MediaStorage {
  readonly backend = "LOCAL" as const;
  readonly provider = "local";
  private readonly roots: Record<MediaScope, string>;

  constructor(options: LocalMediaStorageOptions) {
    this.roots = {
      public: resolvedRoot(options.publicRoot, "The public local media root"),
      private: resolvedRoot(options.privateRoot, "The private local media root"),
    };
    const repositoryPublic = path.resolve(process.cwd(), "public");
    if (this.roots.private === repositoryPublic || this.roots.private.startsWith(`${repositoryPublic}${path.sep}`)) {
      throw new MediaStorageError("CONFIGURATION", "Private media cannot be stored below public/.");
    }
  }

  private resolve(scope: MediaScope, key: string) {
    assertMediaStorageKey(scope, key);
    const root = this.roots[scope];
    const target = path.resolve(root, key);
    if (!target.startsWith(`${root}${path.sep}`)) throw new MediaStorageError("INVALID_KEY", "Invalid media storage path.");
    return target;
  }

  async put(input: MediaStoragePutInput): Promise<MediaObjectMetadata> {
    const target = this.resolve(input.scope, input.key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    try {
      const source = input.body instanceof Uint8Array ? Readable.from([input.body]) : input.body;
      await pipeline(source, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      const written = await stat(temporary);
      if (!written.isFile() || written.size !== input.contentLength) {
        throw new MediaStorageError("INTEGRITY", "The stored media size does not match its metadata.");
      }
      await rename(temporary, target);
      return {
        contentLength: written.size,
        contentType: input.contentType,
        etag: `\"local-${written.size}-${Math.trunc(written.mtimeMs)}\"`,
        checksumSha256: input.checksumSha256,
        lastModified: written.mtime,
      };
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async head(input: { scope: MediaScope; key: string }): Promise<MediaObjectMetadata> {
    try {
      const metadata = await stat(this.resolve(input.scope, input.key));
      if (!metadata.isFile()) throw new MediaStorageError("NOT_FOUND", "Media object not found.");
      return {
        contentLength: metadata.size,
        contentType: null,
        etag: `\"local-${metadata.size}-${Math.trunc(metadata.mtimeMs)}\"`,
        checksumSha256: null,
        lastModified: metadata.mtime,
      };
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new MediaStorageError("NOT_FOUND", "Media object not found.");
      throw error;
    }
  }

  async get(input: MediaStorageGetInput): Promise<MediaObject> {
    const metadata = await this.head(input);
    const options = input.range ? { start: input.range.start, end: input.range.end } : undefined;
    const body = createReadStream(this.resolve(input.scope, input.key), options);
    const contentLength = input.range ? input.range.end - input.range.start + 1 : metadata.contentLength;
    return { ...metadata, contentLength, body: Readable.toWeb(body) as ReadableStream<Uint8Array> };
  }

  async delete(input: { scope: MediaScope; key: string }) {
    await rm(this.resolve(input.scope, input.key), { force: true });
  }

  async createSignedUrl(input: MediaSignedUrlInput) {
    void input;
    return null;
  }
}
