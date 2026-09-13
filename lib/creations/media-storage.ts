import "server-only";

import { createReadStream } from "node:fs";

import type { CreationMediaUpload } from "@/lib/creations/media-request";
import {
  deleteMediaObject,
  putMediaObject,
  safeContentDisposition,
  type MediaStorageReference,
} from "@/lib/media/storage";

export type CreationMediaReference = Pick<
  MediaStorageReference,
  "storageKey" | "storageBackend" | "storageProvider" | "visibility"
>;

/**
 * Streams an already validated temporary file into the existing public media
 * store. The stream is intentionally not buffered in the Railway process;
 * the S3/R2 driver uses bounded multipart chunks for large videos.
 */
export async function writeCreationMedia(storageKey: string, upload: CreationMediaUpload) {
  const stored = await putMediaObject({
    scope: "public",
    key: storageKey,
    body: createReadStream(upload.path),
    contentLength: upload.sizeBytes,
    contentType: upload.mimeType,
    checksumSha256: upload.checksumSha256,
    contentDisposition: safeContentDisposition("inline", upload.originalFilename),
  });
  return {
    ...stored,
    checksumSha256: upload.checksumSha256,
    visibility: "PUBLIC" as const,
  };
}

export function removeCreationMedia(reference: CreationMediaReference) {
  return deleteMediaObject(reference);
}
