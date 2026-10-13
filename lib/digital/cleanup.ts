import "server-only";
import { lstat, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { deleteMediaObject } from "@/lib/media/storage";
import { DigitalError, assertDigitalUuid, requireDigitalEnvironment } from "./domain";
import { digitalWorkRoot } from "./work-slots";
/** Deliberately LOCAL disposable-run only. Persistent review/old versions are not cleanup targets. */
export async function cleanupDigitalRun(runId: string, uploadIds: string[], apply = false, now = new Date()) {
  requireDigitalEnvironment(); assertDigitalUuid(runId);
  const url = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "");
  if (!/^\/lnx_dcn11_[a-z0-9_]+$/.test(url.pathname) || process.env.MEDIA_STORAGE_DRIVER !== "local" || uploadIds.length > 50) throw new DigitalError("CLEANUP_TARGET_REFUSED");
  for (const id of uploadIds) assertDigitalUuid(id);
  const result: Array<{ uploadId: string; storageKey: string; parts: string | null }> = [];
  for (const id of uploadIds) {
    const s = await prisma.digitalUpload.findUnique({ where: { id }, include: { track: { include: { project: true } } } });
    if (!s || s.track.project.slug !== `dcn11-${runId}` || s.cleanupAt || !["REJECTED", "ABORTED", "EXPIRED"].includes(s.status)
      || s.updatedAt > new Date(now.getTime() - 3600000) || s.leaseUntil && s.leaseUntil > now
      || await prisma.asset.findFirst({ where: { storageKey: s.storageKey } })) continue;
    const partsRoot = path.resolve(process.env.DCN_LOCAL_UPLOAD_ROOT ?? "");
    if (!partsRoot.startsWith("/private/tmp/lnx-dcn-")) throw new DigitalError("CLEANUP_TARGET_REFUSED");
    const parts = path.join(partsRoot, id); let present = false;
    try { const st = await lstat(parts); if (st.isSymbolicLink() || !st.isDirectory() || await realpath(parts) !== parts) throw new DigitalError("CLEANUP_TARGET_REFUSED"); present = true; }
    catch (e) { if (!(e instanceof Error) || !("code" in e) || e.code !== "ENOENT") throw e; }
    result.push({ uploadId: id, storageKey: s.storageKey, parts: present ? parts : null });
    if (apply) await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${s.trackId}`})) IS NULL AS locked`;
      const fresh = await tx.digitalUpload.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== s.status || fresh.cleanupAt || fresh.leaseUntil && fresh.leaseUntil > now || await tx.asset.findFirst({ where: { storageKey: s.storageKey } })) throw new DigitalError("CLEANUP_STATE_CHANGED");
      await deleteMediaObject({ storageKey: s.storageKey, storageBackend: "LOCAL", storageProvider: "local", visibility: "PRIVATE" }).catch(e => { if (!(e instanceof Error) || !("code" in e) || e.code !== "NOT_FOUND") throw e; });
      if (present) await rm(parts, { recursive: true });
      await tx.digitalUpload.update({ where: { id }, data: { cleanupAt: now } });
      await tx.digitalEvent.create({ data: { actorId: s.actorId, kind: "QA_UPLOAD_CLEANED", details: { runId, uploadId: id, mode: "LOCAL_ONLY" } } });
    });
  }
  return { dryRun: !apply, objects: result };
}
export async function cleanupStaleDigitalWork(apply = false, now = new Date()) {
  requireDigitalEnvironment(); const root = digitalWorkRoot();
  const names = await readdir(root).catch(() => []), candidates: string[] = [];
  for (const name of names) {
    if (!/^[0-9a-f-]{36}\.[0-9a-f-]{36}$/i.test(name)) continue;
    const [id, token] = name.split("."), target = path.join(root, name), st = await lstat(target);
    if (!st.isDirectory() || st.isSymbolicLink() || st.mtimeMs > now.getTime() - 3600000) continue;
    if (await prisma.digitalWorkSlot.findFirst({ where: { jobId: id, leaseToken: token, leaseUntil: { gt: now } } })) continue;
    // Only disposable run databases may apply. Never recursively sweep a workspace or media root.
    candidates.push(target);
    if (apply) { const u = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? ""); if (!/^\/lnx_dcn11_[a-z0-9_]+$/.test(u.pathname)) throw new DigitalError("CLEANUP_TARGET_REFUSED"); await rm(target, { recursive: true }); }
  }
  return { dryRun: !apply, directories: candidates };
}
