import "server-only";

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function storageRoot() {
  const configured = process.env.MEDIA_STORAGE_ROOT;
  if (!configured || !path.isAbsolute(configured)) throw new Error("MEDIA_STORAGE_ROOT must be an absolute private directory.");
  return path.resolve(configured);
}

function resolveStorageKey(storageKey: string) {
  if (!/^catalog\/covers\/[a-f0-9-]+\.webp$/.test(storageKey)) throw new Error("Invalid catalogue storage key.");
  const root = storageRoot();
  const target = path.resolve(root, storageKey);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Invalid catalogue storage path.");
  return target;
}

export async function writeCatalogCover(storageKey: string, bytes: Buffer) {
  const target = resolveStorageKey(storageKey);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
}

export async function readCatalogCover(storageKey: string) {
  return readFile(resolveStorageKey(storageKey));
}

export async function removeCatalogCover(storageKey: string) {
  await rm(resolveStorageKey(storageKey), { force: true });
}
