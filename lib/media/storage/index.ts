import "server-only";

import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

import { activeMediaStorage, mediaStorageForReference } from "@/lib/media/storage/config";
import { mediaScopeForVisibility } from "@/lib/media/storage/policy";
import type {
  MediaObject,
  MediaObjectMetadata,
  MediaScope,
  MediaSignedUrlInput,
  MediaStorageReference,
} from "@/lib/media/storage/types";

export * from "@/lib/media/storage/policy";
export * from "@/lib/media/storage/types";

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function putMediaObject(input: {
  scope: MediaScope;
  key: string;
  body: Uint8Array | Readable;
  contentLength: number;
  contentType: string;
  checksumSha256: string;
  contentDisposition?: string;
}) {
  const storage = activeMediaStorage();
  const metadata = await storage.put(input);
  return { storageBackend: storage.backend, storageProvider: storage.provider, metadata };
}

export function mediaReference(input: MediaStorageReference) {
  return input;
}

export function getMediaObject(reference: MediaStorageReference, range?: { start: number; end: number }): Promise<MediaObject> {
  const scope = mediaScopeForVisibility(reference.visibility);
  return mediaStorageForReference(reference).get({ scope, key: reference.storageKey, ...(range ? { range } : {}) });
}

export async function readMediaObjectBytes(reference: MediaStorageReference, maximumBytes = 16 * 1024 * 1024) {
  const object = await getMediaObject(reference);
  if (object.contentLength < 0 || object.contentLength > maximumBytes) throw new Error("Media object exceeds the buffered read limit.");
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  if (bytes.byteLength !== object.contentLength) throw new Error("Media object length changed while reading.");
  return bytes;
}

export function headMediaObject(reference: MediaStorageReference): Promise<MediaObjectMetadata> {
  const scope = mediaScopeForVisibility(reference.visibility);
  return mediaStorageForReference(reference).head({ scope, key: reference.storageKey });
}

export function deleteMediaObject(reference: MediaStorageReference) {
  const scope = mediaScopeForVisibility(reference.visibility);
  return mediaStorageForReference(reference).delete({ scope, key: reference.storageKey });
}

export function createPrivateMediaSignedUrl(reference: MediaStorageReference, input: Omit<MediaSignedUrlInput, "scope" | "key">) {
  if (reference.visibility !== "PRIVATE") throw new Error("Signed application URLs are reserved for private media.");
  return mediaStorageForReference(reference).createSignedUrl({ ...input, scope: "private", key: reference.storageKey });
}
