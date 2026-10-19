import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { catalogFfmpegPath } from "@/lib/catalog/ffmpeg";
import { darwinExitPending, linuxAddressSpaceReleased, parseDarwinRss, parseLinuxRss, readLinuxProcessRss, readProcessRss, RssProcessExited, runMonitoredFfmpeg } from "@/lib/digital/ffmpeg-monitor";
import { DIGITAL_WORK_LIMITS } from "@/lib/digital/work-slots";

const audioArgs = (seconds: string) => ["-v", "error", "-re", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", seconds, "-f", "null", "-"];
const args = audioArgs("2");
const signal = () => new AbortController().signal;
const run = (dependencies = {}, limit = DIGITAL_WORK_LIMITS, timeout = 5000, abort = signal()) =>
  runMonitoredFfmpeg(catalogFfmpegPath(), args, abort, timeout, limit, false, undefined, dependencies);

test("procfs KiB parsing is strict, positive and never substitutes unavailable RSS with zero", () => {
  assert.equal(parseLinuxRss("Name:\tffmpeg\nVmRSS:\t 12345 kB\nThreads:\t1\n"), 12345 * 1024);
  for (const value of ["", "VmRSS: 0 kB", "VmRSS: -1 kB", "VmRSS: NaN kB", "VmRSS: 1 MB", "VmRSS: 9007199254740992 kB"])
    assert.throws(() => parseLinuxRss(value), { code: "WORKER_MONITOR_UNAVAILABLE" });
  assert.throws(() => parseLinuxRss("State:\tZ (zombie)\n"), RssProcessExited);
});
const releasedStatus = "Name:\tffmpeg\nState:\tR (running)\nPid:\t477\nThreads:\t1\nKthread:\t0\n";
// Captured from the synthetic Linux qualification before the fix, not invented
// zero RSS: PF_EXITING is set and the last task has already released its mm.
const releasedStat = "477 (ffmpeg) R 1 1 1 0 -1 4194316 2460 0 0 0 4 0 0 0 20 0 1 0 8139 0 0 18446744073709551615 0 0 0 0 0 0 0 4096 8406034 0 0 0 17 0 0 0 0 0 0 0 0 0 0 0 0 0 0";
const codedError = (code: string) => Object.assign(new Error(code), { code });
test("Linux exit proof requires PF_EXITING, the exact PID, one thread and a released address space", () => {
  assert.equal(linuxAddressSpaceReleased(releasedStat, 477), true);
  assert.equal(linuxAddressSpaceReleased(releasedStat.replace("(ffmpeg)", "(a ) name (x))"), 477), true);
  for (const stat of ["", "477 (ffmpeg) R", releasedStat.replace("4194316", "4194312"),
    releasedStat.replace("20 0 1 0", "20 0 2 0"), releasedStat.replace("8139 0 0", "8139 4096 0"),
    releasedStat.replace("8139 0 0", "8139 0 1"), releasedStat.replace("4194316", "NaN"),
    releasedStat.replace("4194316", "9007199254740992"), releasedStat.replace(") R ", ") ? "),
    releasedStat + " ".repeat(8193)]) assert.equal(linuxAddressSpaceReleased(stat, 477), false);
  assert.equal(linuxAddressSpaceReleased(releasedStat, 478), false);
  assert.equal(linuxAddressSpaceReleased(releasedStat, -1), false);
});
test("Linux positive RSS uses status alone and never probes exit or returns zero", async () => {
  let reads = 0;
  assert.equal(await readLinuxProcessRss(477, {
    readProc: async path => { reads++; assert.equal(path, "/proc/477/status"); return "VmRSS:\t1234 kB\n"; },
    probeProcess: () => assert.fail("valid measurement must not probe exit"),
  }), 1234 * 1024);
  assert.equal(reads, 1);
});
test("Linux State:R without VmRSS is accepted only with the captured kernel exit proof", async () => {
  let firstSignal: AbortSignal | undefined, reads = 0;
  await assert.rejects(readLinuxProcessRss(477, {
    readProc: async (path, signal) => {
      reads++; firstSignal ??= signal; assert.equal(signal, firstSignal);
      return path.endsWith("/status") ? releasedStatus : releasedStat;
    }, probeProcess: () => {},
  }), RssProcessExited);
  assert.equal(reads, 2);
});
test("Linux live/malformed/zero RSS and multithreaded or retained memory states still fail closed", async () => {
  for (const status of [releasedStatus + "VmRSS:\t0 kB\n", releasedStatus + "VmRSS:\tNaN kB\n",
    releasedStatus + "VmSize:\t4096 kB\n", releasedStatus.replace("Threads:\t1", "Threads:\t2"),
    releasedStatus.replace("Kthread:\t0", "Kthread:\t1"), releasedStatus.replace("Pid:\t477", "Pid:\t478"), ""]) {
    let reads = 0;
    await assert.rejects(readLinuxProcessRss(477, { readProc: async () => { reads++; return status; }, probeProcess: () => {} }),
      { code: "WORKER_MONITOR_UNAVAILABLE" });
    assert.equal(reads, 1);
  }
  for (const stat of [releasedStat.replace("4194316", "4194312"), releasedStat.replace("20 0 1 0", "20 0 2 0"),
    releasedStat.replace("8139 0 0", "8139 4096 1"), "unreadable stat"]) {
    await assert.rejects(readLinuxProcessRss(477, {
      readProc: async path => path.endsWith("/status") ? releasedStatus : stat, probeProcess: () => {},
    }), { code: "WORKER_MONITOR_UNAVAILABLE" });
  }
});
test("Linux disappearance needs agreement from procfs and ESRCH, never missing procfs alone", async () => {
  for (const code of ["ENOENT", "ESRCH"]) {
    await assert.rejects(readLinuxProcessRss(477, {
      readProc: async () => { throw codedError(code); }, probeProcess: () => { throw codedError("ESRCH"); },
    }), RssProcessExited);
    await assert.rejects(readLinuxProcessRss(477, {
      readProc: async () => { throw codedError(code); }, probeProcess: () => {},
    }), { code: "WORKER_MONITOR_UNAVAILABLE" });
    await assert.rejects(readLinuxProcessRss(477, {
      readProc: async path => { if (path.endsWith("/status")) return releasedStatus; throw codedError(code); },
      probeProcess: (() => { let probes = 0; return () => { if (++probes === 2) throw codedError("ESRCH"); }; })(),
    }), RssProcessExited);
  }
});
test("Linux permission/read errors are not disguised as exit, even if the PID subsequently disappears", async () => {
  for (const code of ["EACCES", "EPERM", "EIO", "ABORT_ERR"]) {
    await assert.rejects(readLinuxProcessRss(477, {
      readProc: async () => { throw codedError(code); }, probeProcess: () => assert.fail("do not disguise read error"),
    }), { code: "WORKER_MONITOR_UNAVAILABLE" });
    await assert.rejects(readLinuxProcessRss(477, {
      readProc: async path => { if (path.endsWith("/status")) return releasedStatus; throw codedError(code); }, probeProcess: () => {},
    }), { code: "WORKER_MONITOR_UNAVAILABLE" });
  }
});
test("Darwin RSS parsing distinguishes a kernel zombie from unavailable or zero live RSS", () => {
  assert.equal(parseDarwinRss("  S+ 12345\n"), 12345 * 1024);
  assert.equal(parseDarwinRss("R 512"), 512 * 1024);
  for (const status of ["Z 0", "Z+ 0", "Z 123"]) assert.throws(() => parseDarwinRss(status), RssProcessExited);
  for (const status of ["", "S 0", "R -1", "R NaN", "R 1 MB", "unknown 123", "R 9007199254740992", "R 1\nS 2"])
    assert.throws(() => parseDarwinRss(status), { code: "WORKER_MONITOR_UNAVAILABLE" });
});
test("only exact Darwin exiting ?E zero may wait; sleeping/running zero and malformed data fail synchronously", () => {
  assert.equal(darwinExitPending("?E 0\n"), true);
  assert.throws(() => parseDarwinRss("?E 0"), { code: "WORKER_MONITOR_UNAVAILABLE" });
  for (const status of ["S 0", "R 0", "E 0", "? 0", "?E 1", "", "?E 0\nR 1", "permission denied"]) {
    assert.equal(darwinExitPending(status), false);
    if (status !== "?E 1") assert.throws(() => parseDarwinRss(status), { code: "WORKER_MONITOR_UNAVAILABLE" });
  }
});
test("native RSS reader measures this real process without requiring ps on Linux", async () => {
  assert.ok(await readProcessRss(process.pid) > 0);
  await assert.rejects(readProcessRss(-1), { code: "WORKER_MONITOR_UNAVAILABLE" });
  await assert.rejects(readProcessRss(process.pid, "win32"), { code: "WORKER_MONITOR_UNAVAILABLE" });
});
test("Darwin reader recognizes an exited real child rather than inventing zero RSS", { skip: process.platform !== "darwin" }, async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  assert.ok(child.pid); await once(child, "close");
  await assert.rejects(readProcessRss(child.pid), RssProcessExited);
});
test("short real Darwin FFmpeg jobs survive exit/sample races with only positive memory samples", { skip: process.platform !== "darwin", timeout: 10000 }, async () => {
  const stats = { rssPeak: 0, samples: 0 };
  for (let index = 0; index < 20; index++) {
    await runMonitoredFfmpeg(catalogFfmpegPath(), audioArgs(String(.05 + index % 3 * .005)), signal(), 5000, DIGITAL_WORK_LIMITS, false, stats);
  }
  assert.ok(stats.samples > 0); assert.ok(stats.rssPeak > 0 && stats.rssPeak < DIGITAL_WORK_LIMITS.ffmpegRssBytes);
  console.log(JSON.stringify({ platform: process.platform, shortFfmpegJobs: 20, realFfmpegRssPeakBytes: stats.rssPeak, samples: stats.samples }));
});
test("short real Linux FFmpeg jobs retain positive RSS and only kernel-proven exit exceptions", { skip: process.platform !== "linux", timeout: 15000 }, async () => {
  const stats = { rssPeak: 0, samples: 0 };
  let kernelExitProofs = 0;
  for (let index = 0; index < 20; index++) {
    await runMonitoredFfmpeg(catalogFfmpegPath(), audioArgs(String(.05 + index % 3 * .005)), signal(), 5000, DIGITAL_WORK_LIMITS, false, stats, {
      readRss: pid => readLinuxProcessRss(pid, { readProc: async (path, signal) => {
        const content = await readFile(path, { encoding: "utf8", signal });
        if (path.endsWith("/stat") && linuxAddressSpaceReleased(content, pid)) kernelExitProofs++;
        return content;
      } }),
    });
  }
  assert.ok(stats.samples > 0); assert.ok(stats.rssPeak > 0 && stats.rssPeak < DIGITAL_WORK_LIMITS.ffmpegRssBytes);
  console.log(JSON.stringify({ platform: process.platform, shortFfmpegJobs: 20, realFfmpegRssPeakBytes: stats.rssPeak, samples: stats.samples, kernelExitProofs }));
});
test("real FFmpeg finishes normally with positive RSS samples", async () => {
  const stats = { rssPeak: 0, samples: 0 };
  await runMonitoredFfmpeg(catalogFfmpegPath(), args, signal(), 5000, DIGITAL_WORK_LIMITS, false, stats);
  assert.ok(stats.samples > 0); assert.ok(stats.rssPeak > 0); assert.ok(stats.rssPeak < DIGITAL_WORK_LIMITS.ffmpegRssBytes);
  console.log(JSON.stringify({ platform: process.platform, realFfmpegRssPeakBytes: stats.rssPeak, samples: stats.samples }));
});
test("FFmpeg and Node RSS ceilings independently kill a running child", async () => {
  await assert.rejects(run({ readRss: async () => DIGITAL_WORK_LIMITS.ffmpegRssBytes + 1 }), { code: "WORKER_MEMORY_LIMIT" });
  let reads = 0;
  await assert.rejects(run({ nodeRss: () => ++reads > 2 ? DIGITAL_WORK_LIMITS.nodeRssBytes + 1 : 1, readRss: async () => 1024 }), { code: "WORKER_MEMORY_LIMIT" });
});
test("read errors and malformed RSS fail closed while a child is alive", async () => {
  await assert.rejects(run({ readRss: async () => { throw new Error("synthetic denied procfs"); } }), { code: "WORKER_MONITOR_UNAVAILABLE" });
  for (const rss of [0, NaN, -1, Infinity]) await assert.rejects(run({ readRss: async () => rss }), { code: "WORKER_MONITOR_UNAVAILABLE" });
});
test("termination during async sampling drains reads without a false monitor failure or late stats", async () => {
  let reads = 0, finishedRead = false;
  const stats = { rssPeak: 0, samples: 0 };
  await runMonitoredFfmpeg(catalogFfmpegPath(), audioArgs("0.1"), signal(), 5000, DIGITAL_WORK_LIMITS, false, stats, {
    readRss: async () => { reads++; await delay(800); finishedRead = true; throw new Error("process disappeared after normal exit"); },
  });
  assert.equal(reads, 1); assert.equal(finishedRead, true); assert.equal(stats.samples, 0);
});
test("kernel-proven zombie/disappearance is not treated as zero or monitor outage", async () => {
  await runMonitoredFfmpeg(catalogFfmpegPath(), audioArgs("0.1"), signal(), 5000, DIGITAL_WORK_LIMITS, false, undefined,
    { readRss: async () => { await delay(450); throw new RssProcessExited(); } });
});
test("cancellation, timeout, startup failure and decoder failure remain distinct", async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(run({}, DIGITAL_WORK_LIMITS, 5000, abort.signal), { code: "LEASE_LOST" });
  const during = new AbortController(); setTimeout(() => during.abort(), 50);
  await assert.rejects(run({ readRss: async () => { await delay(150); throw new Error("late read"); } }, DIGITAL_WORK_LIMITS, 5000, during.signal), { code: "LEASE_LOST" });
  await assert.rejects(run({ readRss: async () => { await delay(150); throw new Error("late read"); } }, DIGITAL_WORK_LIMITS, 50), { code: "FFMPEG_TIMEOUT" });
  await assert.rejects(runMonitoredFfmpeg("/nonexistent/lnx-ffmpeg", [], signal(), 1000, DIGITAL_WORK_LIMITS), { code: "FFMPEG_UNAVAILABLE" });
  await assert.rejects(runMonitoredFfmpeg(catalogFfmpegPath(), ["-not-a-valid-option"], signal(), 5000, DIGITAL_WORK_LIMITS), { code: "INVALID_AUDIO" });
});
