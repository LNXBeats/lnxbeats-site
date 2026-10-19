import { spawn, execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { DigitalError } from "./domain";

const exec = promisify(execFile);
export class RssProcessExited extends Error {}
export function parseLinuxRss(status: string) {
  if (/^State:\s+Z\b/m.test(status)) throw new RssProcessExited();
  const match = status.match(/^VmRSS:\s+([0-9]+)\s+kB\s*$/m);
  const bytes = match ? Number(match[1]) * 1024 : NaN;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new DigitalError("WORKER_MONITOR_UNAVAILABLE");
  return bytes;
}
/**
 * Linux sets PF_EXITING before exit_mm(), while task state can still be R.
 * procfs then omits VmRSS because mm is already gone. Require the kernel exit
 * flag AND a last thread with no address space; zero RSS alone is never exit.
 * See Linux v6.18 include/linux/sched.h, kernel/exit.c and fs/proc/array.c.
 */
export function linuxAddressSpaceReleased(stat: string, pid: number) {
  if (stat.length > 8192 || !Number.isSafeInteger(pid) || pid <= 0) return false;
  // comm is parenthesized and can itself contain spaces and parentheses.
  const end = stat.lastIndexOf(") ");
  if (end < 0 || stat.slice(0, stat.indexOf(" (")) !== String(pid)) return false;
  const fields = stat.slice(end + 2).trim().split(/\s+/);
  if (fields.length < 22 || !/^[RSDTtXZPI]$/.test(fields[0]) || !/^\d+$/.test(fields[6])) return false;
  const flags = Number(fields[6]);
  return Number.isSafeInteger(flags) && (flags & 0x4) !== 0 && fields[17] === "1"
    && fields[20] === "0" && fields[21] === "0";
}
type LinuxRssDependencies = {
  readProc?: (path: string, signal: AbortSignal) => Promise<string>;
  probeProcess?: (pid: number) => void;
};
export async function readLinuxProcessRss(pid: number, dependencies: LinuxRssDependencies = {}): Promise<number> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new DigitalError("WORKER_MONITOR_UNAVAILABLE");
  const readProc = dependencies.readProc ?? ((path, signal) => readFile(path, { encoding: "utf8", signal }));
  const probeProcess = dependencies.probeProcess ?? (processId => { process.kill(processId, 0); });
  // Both reads share one existing deadline. No grace, polling or timeout increase.
  const signal = AbortSignal.timeout(1000);
  const assertGone = () => {
    try { probeProcess(pid); } catch (gone) {
      if ((gone as NodeJS.ErrnoException).code === "ESRCH") throw new RssProcessExited();
    }
  };
  try {
    const status = await readProc(`/proc/${pid}/status`, signal);
    try { return parseLinuxRss(status); } catch (error) {
      if (error instanceof RssProcessExited) throw error;
      // A malformed/zero measurement must not enter the exit-proof path.
      if (/^Vm[A-Za-z]+:/m.test(status) || !new RegExp(`^Pid:\\s+${pid}\\s*$`, "m").test(status)
        || !/^Threads:\s+1\s*$/m.test(status) || !/^Kthread:\s+0\s*$/m.test(status)) throw error;
      assertGone();
      if (linuxAddressSpaceReleased(await readProc(`/proc/${pid}/stat`, signal), pid)) throw new RssProcessExited();
      throw error;
    }
  } catch (error) {
    if (error instanceof RssProcessExited) throw error;
    // procfs can report either ENOENT or ESRCH during reaping. Neither alone
    // proves exit (procfs itself could be missing); the kernel probe must agree.
    if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) assertGone();
    throw new DigitalError("WORKER_MONITOR_UNAVAILABLE");
  }
}
/** BSD ps reports zero RSS for zombies; the kernel state, never zero alone, proves exit. */
export function parseDarwinRss(statusAndRss: string) {
  const match = statusAndRss.match(/^\s*([EIRSTUWZ][A-Za-z+<>-]*)\s+([0-9]+)\s*$/);
  if (!match) throw new DigitalError("WORKER_MONITOR_UNAVAILABLE");
  if (match[1].startsWith("Z")) throw new RssProcessExited();
  const bytes = Number(match[2]) * 1024;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new DigitalError("WORKER_MONITOR_UNAVAILABLE");
  return bytes;
}
export function darwinExitPending(statusAndRss: string) {
  return /^\s*\?E\s+0\s*$/.test(statusAndRss);
}
function assertDarwinProcessPresent(pid: number) {
  try { process.kill(pid, 0); } catch (gone) {
    if ((gone as NodeJS.ErrnoException).code === "ESRCH") throw new RssProcessExited();
    throw new DigitalError("WORKER_MONITOR_UNAVAILABLE");
  }
}
/** Linux needs no external executable; Darwin retains its native ps implementation. */
export async function readProcessRss(pid: number, platform = process.platform): Promise<number> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new DigitalError("WORKER_MONITOR_UNAVAILABLE");
  if (platform === "linux") return readLinuxProcessRss(pid);
  if (platform !== "darwin") throw new DigitalError("WORKER_MONITOR_UNAVAILABLE");
  let exiting = false;
  try {
    const result = await exec("ps", ["-o", "stat=", "-o", "rss=", "-p", String(pid)], { timeout: 1000, maxBuffer: 1024 });
    exiting = darwinExitPending(result.stdout);
    return parseDarwinRss(result.stdout);
  } catch (error) {
    if (error instanceof RssProcessExited) throw error;
    // Darwin can briefly expose "?E 0" while exiting, before Node reaps the child.
    // Only that exact kernel state gets at most one sampler interval to settle.
    // This async timer never blocks timeout/abort handlers or accepts zero RSS.
    assertDarwinProcessPresent(pid);
    if (exiting) {
      await new Promise<void>(resolve => setTimeout(resolve, 25));
      assertDarwinProcessPresent(pid);
    }
    // ESRCH or Node-observed close is still required. Live S/R zero, malformed
    // output, missing ps and permissions fail closed without any grace period.
    throw new DigitalError("WORKER_MONITOR_UNAVAILABLE");
  }
}

type Stats = { rssPeak: number; samples: number };
type Limits = { ffmpegRssBytes: number; nodeRssBytes: number };
type Dependencies = { readRss?: (pid: number) => Promise<number>; nodeRss?: () => number };
/** No shell/network, bounded output, single sampler, first failure wins, no late kill after close. */
export async function runMonitoredFfmpeg(binary: string, args: string[], signal: AbortSignal, timeoutMs: number,
  limits: Limits, parseOnly = false, stats?: Stats, dependencies: Dependencies = {}) {
  if (signal.aborted) throw new DigitalError("LEASE_LOST");
  const nodeRss = dependencies.nodeRss ?? (() => process.memoryUsage().rss);
  const readRss = dependencies.readRss ?? readProcessRss;
  if (nodeRss() > limits.nodeRssBytes) throw new DigitalError("WORKER_MEMORY_LIMIT");
  return new Promise<string>((resolve, reject) => {
    let stderr = "", failure: Error | null = null, closed = false, pending: Promise<void> | null = null;
    const child = spawn(binary, ["-nostdin", "-hide_banner", "-max_alloc", "67108864", "-threads", "1", "-filter_threads", "1", "-protocol_whitelist", "file,pipe", ...args],
      { shell: false, stdio: ["ignore", "ignore", "pipe"], env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV, AV_LOG_FORCE_NOCOLOR: "1" } });
    const running = () => !closed && child.exitCode === null && child.signalCode === null;
    const fail = (code: string) => {
      if (closed) return;
      failure ??= new DigitalError(code);
      if (running()) child.kill("SIGKILL");
    };
    const abort = () => fail("LEASE_LOST");
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timeout = setTimeout(() => fail("FFMPEG_TIMEOUT"), timeoutMs);
    const sample = () => {
      if (!running()) return;
      if (nodeRss() > limits.nodeRssBytes) { fail("WORKER_MEMORY_LIMIT"); return; }
      if (pending || !child.pid || failure) return;
      pending = (async () => {
        try {
          const rss = await readRss(child.pid!);
          if (!running()) return;
          if (!Number.isSafeInteger(rss) || rss <= 0) throw new DigitalError("WORKER_MONITOR_UNAVAILABLE");
          if (stats) { stats.samples++; stats.rssPeak = Math.max(stats.rssPeak, rss); }
          if (rss > limits.ffmpegRssBytes || nodeRss() > limits.nodeRssBytes) fail("WORKER_MEMORY_LIMIT");
        } catch (error) {
          // A kernel-proven exited/zombie child has no remaining RSS to police.
          // Other failures are ignored only after Node has observed its termination.
          if (!(error instanceof RssProcessExited) && running()) fail("WORKER_MONITOR_UNAVAILABLE");
        }
      })().finally(() => { pending = null; });
    };
    const monitor = setInterval(sample, 25);
    child.once("spawn", sample);
    child.stderr.on("data", chunk => { if (stderr.length < 65536) stderr += String(chunk).slice(0, 65536 - stderr.length); });
    child.once("error", () => { failure ??= new DigitalError("FFMPEG_UNAVAILABLE"); });
    child.once("close", code => {
      closed = true; clearTimeout(timeout); clearInterval(monitor); signal.removeEventListener("abort", abort);
      // Drain the in-flight read: it cannot mutate stats/failure or kill a finished child.
      void Promise.resolve(pending).then(() => {
        if (failure) reject(failure);
        else if (code !== 0 && (!parseOnly || code !== 1 || !/At least one output file must be specified/.test(stderr))) reject(new DigitalError("INVALID_AUDIO"));
        else resolve(stderr);
      });
    });
  });
}
