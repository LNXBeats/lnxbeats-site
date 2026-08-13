import "server-only";

import { rm } from "node:fs/promises";
import path from "node:path";

import {
  deleteMediaObject,
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

type PrivateOrderReference = Pick<MediaStorageReference, "storageKey" | "storageBackend" | "storageProvider" | "visibility">;

function legacyReference(storageKey: string): PrivateOrderReference {
  return { storageKey, storageBackend: "LOCAL", storageProvider: "local", visibility: "PRIVATE" };
}

function reference(value: string | PrivateOrderReference) {
  return typeof value === "string" ? legacyReference(value) : value;
}

export async function writePrivateOrderFile(storageKey: string, buffer: Buffer, checksumSha256: string) {
  const stored = await putMediaObject({
    scope: "private",
    key: storageKey,
    body: buffer,
    contentLength: buffer.length,
    contentType: "image/webp",
    checksumSha256,
  });
  return { ...stored, checksumSha256, visibility: "PRIVATE" as const };
}

export async function readPrivateOrderFile(input: string | PrivateOrderReference) {
  return Buffer.from(await readMediaObjectBytes(reference(input), 12 * 1024 * 1024));
}

export function deletePrivateOrderFile(input: string | PrivateOrderReference) {
  return deleteMediaObject(reference(input));
}

export async function clearQaOrderStorage() {
  if (process.env.ORDER_UPLOAD_MODE !== "local-qa" || !process.env.LNX_DATABASE_TARGET?.endsWith("-test")) {
    throw new OrderStorageError("Nettoyage refusé hors QA.");
  }
  const root = path.resolve(process.env.MEDIA_LOCAL_PRIVATE_ROOT ?? process.env.ORDER_UPLOAD_DIR ?? "");
  if (!root.startsWith("/private/tmp/")) throw new OrderStorageError("Le stockage QA doit rester dans /private/tmp.");
  await rm(root, { recursive: true, force: true });
}
