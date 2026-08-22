import "server-only";

import { rm } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

import {
  createPrivateMediaSignedUrl,
  deleteMediaObject,
  getMediaObject,
  headMediaObject,
  putMediaObject,
  readMediaObjectBytes,
  type MediaStorageReference,
} from "@/lib/media/storage";

export class OrderStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderStorageError";
  }
}

export function createPrivateOrderDownloadUrl(
  input: PrivateOrderReference,
  options: { expiresInSeconds: number; downloadFilename?: string },
) {
  return createPrivateMediaSignedUrl(input, {
    operation: "get",
    expiresInSeconds: options.expiresInSeconds,
    ...(options.downloadFilename ? { downloadFilename: options.downloadFilename } : {}),
  });
}

type PrivateOrderReference = Pick<MediaStorageReference, "storageKey" | "storageBackend" | "storageProvider" | "visibility">;

function legacyReference(storageKey: string): PrivateOrderReference {
  return { storageKey, storageBackend: "LOCAL", storageProvider: "local", visibility: "PRIVATE" };
}

function reference(value: string | PrivateOrderReference) {
  return typeof value === "string" ? legacyReference(value) : value;
}

export async function writePrivateOrderFile(storageKey: string, buffer: Buffer, checksumSha256: string) {
  return writePrivateOrderMedia({
    storageKey,
    body: buffer,
    contentLength: buffer.length,
    contentType: "image/webp",
    checksumSha256,
  });
}

export async function writePrivateOrderMedia(input: {
  storageKey: string;
  body: Uint8Array | Readable;
  contentLength: number;
  contentType: string;
  checksumSha256: string;
}) {
  const stored = await putMediaObject({
    scope: "private",
    key: input.storageKey,
    body: input.body,
    contentLength: input.contentLength,
    contentType: input.contentType,
    checksumSha256: input.checksumSha256,
  });
  return { ...stored, checksumSha256: input.checksumSha256, visibility: "PRIVATE" as const };
}

export async function readPrivateOrderFile(input: string | PrivateOrderReference) {
  return Buffer.from(await readMediaObjectBytes(reference(input), 12 * 1024 * 1024));
}

export function deletePrivateOrderFile(input: string | PrivateOrderReference) {
  return deleteMediaObject(reference(input));
}

export function statPrivateOrderFile(input: string | PrivateOrderReference) {
  return headMediaObject(reference(input));
}

export function streamPrivateOrderFile(
  input: string | PrivateOrderReference,
  range?: { start: number; end: number },
) {
  return getMediaObject(reference(input), range);
}

export async function clearQaOrderStorage() {
  if (process.env.ORDER_UPLOAD_MODE !== "local-qa" || !process.env.LNX_DATABASE_TARGET?.endsWith("-test")) {
    throw new OrderStorageError("Nettoyage refusé hors QA.");
  }
  const root = path.resolve(process.env.MEDIA_LOCAL_PRIVATE_ROOT ?? process.env.ORDER_UPLOAD_DIR ?? "");
  if (!root.startsWith("/private/tmp/")) throw new OrderStorageError("Le stockage QA doit rester dans /private/tmp.");
  await rm(root, { recursive: true, force: true });
}
