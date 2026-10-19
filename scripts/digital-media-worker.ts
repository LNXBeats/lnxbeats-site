import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prisma } from "@/lib/prisma";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { processDigitalDocuments } from "@/lib/digital/documents";
import { processDigitalNotifications } from "@/lib/digital/notifications";
import { createDigitalWorkerCycle, digitalWorkerMode, digitalMediaWorkerEnvironment } from "@/lib/digital/worker-cycle";
import { digitalReconciliationDependencies } from "./digital-reconcile";
import { digitalAudioUploadHoldFilter } from "@/lib/digital/audio-upload-holds";
import { studioEnabled } from "@/lib/digital/studio-policy";

async function mediaChild(kind: "audio" | "zip", signal: AbortSignal) {
  if (signal.aborted) return;
  const mode = requireDigitalEnvironment(), now = new Date();
  const studio = studioEnabled();
  const pending = kind === "audio" ? await prisma.digitalUpload.count({ where: { ...digitalAudioUploadHoldFilter(), ...(!studio ? { processingProfile: "LEGACY" } : {}), OR: [
    { status: "QUARANTINE", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
    { status: { in: ["VALIDATING", "COMPLETING"] }, leaseUntil: { lte: now } },
  ] } }) + (studio ? await prisma.digitalStudioJob.count({ where: { uploadId: null, preparationKey: { not: null }, binding: null, decision: "PENDING",
    OR: [{ status: "QUEUED" }, { status: "PROCESSING", leaseUntil: { lte: now } }] } }) : 0) : await prisma.digitalArchive.count({ where: { line: { order: { mode } }, OR: [
    { status: "PENDING" }, { status: "PROCESSING", leaseUntil: { lte: now } },
  ] } });
  if (!pending || signal.aborted) return;
  // Preserve process isolation and existing media leases/memory ceilings. Never
  // collect source audio, child stdout, signed payloads or provider secrets.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/digital-worker-once.ts", kind],
      { env: digitalMediaWorkerEnvironment(), stdio: ["ignore", "ignore", "ignore"] });
    let finished = false, force: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (finished) return;
      child.kill("SIGTERM");
      force ??= setTimeout(() => child.kill("SIGKILL"), 8_000);
    };
    const timeout = setTimeout(stop, 20 * 60_000);
    signal.addEventListener("abort", stop, { once: true });
    child.once("error", done);
    child.once("exit", (code, stoppedBy) => done(code === 0 || signal.aborted && stoppedBy === "SIGTERM"
      ? undefined : new Error("DIGITAL_MEDIA_CHILD_FAILED")));
    function done(error?: Error) {
      if (finished) return;
      finished = true; clearTimeout(timeout); if (force) clearTimeout(force);
      signal.removeEventListener("abort", stop);
      if (error) reject(new Error("DIGITAL_MEDIA_CHILD_FAILED")); else resolve();
    }
    if (signal.aborted) stop();
  });
}

/** May also be imported dynamically by the existing creations worker. Importing
 * this module never starts a poll loop or opens a database connection. */
export const runDigitalWorkerCycle = createDigitalWorkerCycle({ ...digitalReconciliationDependencies,
  documents: limit => processDigitalDocuments(limit), notifications: limit => processDigitalNotifications(limit), media: mediaChild });

function wait(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>(resolve => {
    const timer = setTimeout(done, 3_000);
    function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
    signal.addEventListener("abort", done, { once: true });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!digitalWorkerMode()) throw new Error("An authorized DCN runtime and DCN_WORKER_ENABLED=true are required.");
  const shutdown = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => shutdown.abort());
  try {
    while (!shutdown.signal.aborted) {
      const result = await runDigitalWorkerCycle(shutdown.signal);
      if (result.failures) console.error("[digital-worker] Bounded cycle failed; durable leases remain retryable.");
      await wait(shutdown.signal);
    }
  } finally { await prisma.$disconnect(); }
}
