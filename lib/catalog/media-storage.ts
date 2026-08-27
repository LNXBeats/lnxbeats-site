import "server-only";

import {
  deleteMediaObject,
  getMediaObject,
  headMediaObject,
  putMediaObject,
  readMediaObjectBytes,
  sha256Hex,
  type MediaStorageReference,
} from "@/lib/media/storage";

type CatalogReference = Pick<MediaStorageReference, "storageKey" | "storageBackend" | "storageProvider" | "visibility">;

function legacyReference(storageKey: string, visibility: "PUBLIC" | "PRIVATE" = "PUBLIC"): CatalogReference {
  return { storageKey, storageBackend: "LOCAL", storageProvider: "local", visibility };
}

function reference(value: string | CatalogReference) {
  return typeof value === "string" ? legacyReference(value) : value;
}

export type { CatalogReference };

async function writePublic(key: string, bytes: Buffer, contentType: string) {
  const checksumSha256 = sha256Hex(bytes);
  const stored = await putMediaObject({
    scope: "public",
    key,
    body: bytes,
    contentLength: bytes.length,
    contentType,
    checksumSha256,
  });
  return { ...stored, checksumSha256, visibility: "PUBLIC" as const };
}

export function writeCatalogCover(storageKey: string, bytes: Buffer) {
  return writePublic(storageKey, bytes, "image/webp");
}

export async function readCatalogCover(input: string | CatalogReference) {
  return Buffer.from(await readMediaObjectBytes(reference(input), 12 * 1024 * 1024));
}

export function removeCatalogCover(input: string | CatalogReference) {
  return deleteMediaObject(reference(input));
}

export function writeCatalogImage(storageKey: string, bytes: Buffer) {
  return writePublic(storageKey, bytes, "image/webp");
}

export async function readCatalogImage(input: string | CatalogReference) {
  return Buffer.from(await readMediaObjectBytes(reference(input), 12 * 1024 * 1024));
}

export function removeCatalogImage(input: string | CatalogReference) {
  return deleteMediaObject(reference(input));
}

export function writeCatalogAudioPreview(storageKey: string, bytes: Buffer) {
  return writePublic(storageKey, bytes, "audio/mpeg");
}

export async function readCatalogAudioPreview(input: string | CatalogReference) {
  return Buffer.from(await readMediaObjectBytes(reference(input), 4 * 1024 * 1024));
}

export function statCatalogAudioPreview(input: string | CatalogReference) {
  return headMediaObject(reference(input));
}

export async function streamCatalogAudioPreview(input: string | CatalogReference, start?: number, end?: number) {
  return getMediaObject(reference(input), start === undefined || end === undefined ? undefined : { start, end });
}

export function removeCatalogAudioPreview(input: string | CatalogReference) {
  return deleteMediaObject(reference(input));
}
