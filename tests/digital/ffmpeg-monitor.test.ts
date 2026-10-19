import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { catalogFfmpegPath } from "@/lib/catalog/ffmpeg";
import { darwinExitPending, parseDarwinRss, parseLinuxRss, readProcessRss, RssProcessExited, runMonitoredFfmpeg } from "@/lib/digital/ffmpeg-monitor";
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
