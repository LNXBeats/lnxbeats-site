import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SOURCE_TTL_MS = 60 * 60 * 1_000;

function temporaryRoot() {
  const configured = process.env.AUDIO_TEMP_ROOT?.trim() || os.tmpdir();
  if (!path.isAbsolute(configured)) throw new Error("AUDIO_TEMP_ROOT must be absolute.");
  return path.join(path.resolve(configured), "lnx-studio", "catalog", "audio-sources-temp");
}

export async function cleanupExpiredAudioSources(now = Date.now()) {
  const root = temporaryRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const entries = await readdir(root, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9-]+\.(?:mp3|wav|preview\.mp3)$/.test(entry.name)) continue;
    const target = path.join(root, entry.name);
    const metadata = await stat(target).catch(() => null);
    if (metadata && now - metadata.mtimeMs > SOURCE_TTL_MS) {
      await rm(target, { force: true });
      removed += 1;
    }
  }
  return removed;
}

export async function createAudioSourceTempPath(extension: ".mp3" | ".wav") {
  const root = temporaryRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  return path.join(root, `${randomUUID()}${extension}`);
}

export async function createGeneratedPreviewTempPath() {
  const root = temporaryRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  return path.join(root, `${randomUUID()}.preview.mp3`);
}

export async function removeAudioTempFile(target: string | null | undefined) {
  if (!target) return;
  const root = temporaryRoot();
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Invalid audio temporary path.");
  await rm(resolved, { force: true });
}
