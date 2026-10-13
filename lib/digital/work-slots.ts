import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, statfs } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { DigitalError, requireDigitalEnvironment } from "./domain";
// The 12-track benchmark peaks around 391 MiB for ZIP under tsx; 512 MiB is
// a measured local per-job ceiling, not a Railway resource/plan change.
export const DIGITAL_WORK_LIMITS = Object.freeze({ audioConcurrency: 2, zipConcurrency: 1, nodeRssBytes: 512 * 1024 * 1024,
  ffmpegRssBytes: 256 * 1024 * 1024, tempReserveBytes: 1024 * 1024 * 1024, masterBytes: 512 * 1024 * 1024, durationMs: 30 * 60000, leaseMs: 5 * 60000 });
export function digitalWorkRoot() {
  const root = path.resolve(process.env.DCN_WORK_ROOT ?? path.join(process.cwd(), ".private/dcn-work"));
  if (!root.startsWith(`${path.resolve(".private")}${path.sep}`) && !root.startsWith("/private/tmp/lnx-dcn-")) throw new DigitalError("INVALID_WORK_ROOT");
  return root;
}
export async function checkDigitalDisk(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 4294967295) throw new DigitalError("DISK_LIMIT");
  const root = digitalWorkRoot(); await mkdir(root, { recursive: true, mode: 0o700 });
  const fs = await statfs(root, { bigint: true });
  if (fs.bavail * fs.bsize < BigInt(bytes + DIGITAL_WORK_LIMITS.tempReserveBytes)) throw new DigitalError("INSUFFICIENT_TEMP_DISK", 503);
  if (process.memoryUsage().rss > DIGITAL_WORK_LIMITS.nodeRssBytes) throw new DigitalError("WORKER_MEMORY_LIMIT", 503);
  return root;
}
export async function claimDigitalSlot(kind: "audio" | "zip", jobId: string) {
  requireDigitalEnvironment();
  for (let i = 0; i < (kind === "audio" ? DIGITAL_WORK_LIMITS.audioConcurrency : DIGITAL_WORK_LIMITS.zipConcurrency); i++) {
    const id = `${kind}-${i}`, leaseToken = randomUUID();
    const c = await prisma.digitalWorkSlot.updateMany({ where: { id, OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, data: { jobId, leaseToken, leaseUntil: new Date(Date.now() + DIGITAL_WORK_LIMITS.leaseMs) } });
    if (c.count) return { id, jobId, leaseToken };
  }
  return null;
}
export async function renewDigitalSlot(slot: { id: string; leaseToken: string }) {
  return !!(await prisma.digitalWorkSlot.updateMany({ where: { id: slot.id, leaseToken: slot.leaseToken, leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + DIGITAL_WORK_LIMITS.leaseMs) } })).count;
}
export async function releaseDigitalSlot(slot: { id: string; leaseToken: string }) {
  await prisma.digitalWorkSlot.updateMany({ where: { id: slot.id, leaseToken: slot.leaseToken }, data: { jobId: null, leaseToken: null, leaseUntil: null } });
}
