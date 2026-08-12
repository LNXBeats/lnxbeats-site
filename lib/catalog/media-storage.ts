import "server-only";

import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

function storageRoot() {
  const configured = process.env.MEDIA_STORAGE_ROOT;
  if (!configured || !path.isAbsolute(configured)) throw new Error("MEDIA_STORAGE_ROOT must be an absolute private directory.");
  return path.resolve(configured);
}

function resolveStorageKey(storageKey: string, kind: "cover" | "audio") {
  const accepted = kind === "cover"
    ? /^catalog\/covers\/[a-f0-9-]+\.webp$/
    : /^catalog\/audio-previews\/[a-f0-9-]+\.mp3$/;
  if (!accepted.test(storageKey)) throw new Error("Invalid catalogue storage key.");
  const root = storageRoot();
  const target = path.resolve(root, storageKey);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Invalid catalogue storage path.");
  return target;
}

export async function writeCatalogCover(storageKey: string, bytes: Buffer) {
  const target = resolveStorageKey(storageKey, "cover");
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
}

export async function readCatalogCover(storageKey: string) {
  return readFile(resolveStorageKey(storageKey, "cover"));
}

export async function removeCatalogCover(storageKey: string) {
  await rm(resolveStorageKey(storageKey, "cover"), { force: true });
}

export async function writeCatalogAudioPreview(storageKey: string, bytes: Buffer) {
  const target = resolveStorageKey(storageKey, "audio");
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
}

export async function readCatalogAudioPreview(storageKey: string) {
  return readFile(resolveStorageKey(storageKey, "audio"));
}

export async function statCatalogAudioPreview(storageKey: string) {
  return stat(resolveStorageKey(storageKey, "audio"));
}

export function streamCatalogAudioPreview(storageKey: string, start?: number, end?: number) {
  return createReadStream(resolveStorageKey(storageKey, "audio"), start === undefined ? undefined : { start, end });
}

export async function removeCatalogAudioPreview(storageKey: string) {
  await rm(resolveStorageKey(storageKey, "audio"), { force: true });
}
