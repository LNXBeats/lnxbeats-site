import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { setImmediate as waitForImmediate, setTimeout as wait } from "node:timers/promises";

import {
  assertOnlyArguments,
  dimensionsForTargetPixels,
  durationSummary,
  FULL_IDLE_CHECKPOINTS_MS,
  isSharpScenarioName,
  MAX_FULL_IMAGE_CYCLES,
  MAX_IMAGE_PIXELS,
  MEMORY_SAMPLE_INTERVAL_MS,
  memoryMiB,
  MIN_FULL_IMAGE_CYCLES,
  MIB,
  normalizeSharpCacheStats,
  parseArgumentMap,
  parseSafeInteger,
  PHASE2_PROTOCOL_VERSION,
  round,
  RSS_SAFETY_CUTOFF_BYTES,
  RSS_SAFETY_CUTOFF_MIB,
  SAFETY_EXIT_CODE,
  SHARP_SCENARIOS,
  type MemoryMiB,
  type MemoryStage,
  type SharpCacheStats,
  type WorkerEnvelope,
  type WorkerKind,
} from "@/scripts/memory-hardening-phase2-shared";

const TEMP_ROOT_PREFIX = "/private/tmp/lnxbeats-memory-hardening-phase2-";
const SYNTHETIC_BOUNDARY = "lnxbeats-memory-hardening-phase2-boundary";
const STREAM_CHUNK_BYTES = 64 * 1024;
const MAX_MULTIPART_FILES = 10;
const MAX_MULTIPART_FILE_BYTES = 10 * MIB;
const MAX_SAV_FILES = 5;
const MAX_SAV_FILE_BYTES = 5 * MIB;

type SharpModule = typeof import("sharp").default;

type StageRecorder = Readonly<{
  capture: (sharp?: SharpModule) => MemoryStage;
  peak: () => MemoryMiB;
  sampleCount: () => number;
  stop: () => void;
}>;

function runtimeEnvironmentPresence() {
  return {
    mallocArenaMax: Object.hasOwn(process.env, "MALLOC_ARENA_MAX"),
    ldPreload: Object.hasOwn(process.env, "LD_PRELOAD"),
    uvThreadpoolSize: Object.hasOwn(process.env, "UV_THREADPOOL_SIZE"),
    vipsConcurrency: Object.hasOwn(process.env, "VIPS_CONCURRENCY"),
  } as const;
}

function workerKind(value: string | undefined): WorkerKind {
  if (value === "fixture" || value === "sharp" || value === "multipart" || value === "sav") return value;
  throw new Error("--kind must be fixture, sharp, multipart, or sav.");
}

function assertTemporaryPath(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is required.`);
  const resolved = path.resolve(value);
  if (!resolved.startsWith(TEMP_ROOT_PREFIX) || resolved.includes("\u0000")) {
    throw new Error(`${name} must stay inside the Phase 2 /private/tmp root.`);
  }
  return resolved;
}

function parseIdleCheckpoints(value: string | undefined) {
  const source = value ?? FULL_IDLE_CHECKPOINTS_MS.join(",");
  const parsed = source.split(",").map((entry) => Number(entry));
  if (
    parsed.length !== 3
    || parsed.some((entry) => !Number.isSafeInteger(entry) || entry < 1 || entry > 15_000)
    || parsed.some((entry, index) => index > 0 && entry <= parsed[index - 1]!)
  ) throw new Error("--idle-ms must contain three increasing checkpoints no greater than 15000 ms.");
  return parsed as [number, number, number];
}

function selectedSharpVersions(versions: Record<string, string | undefined>) {
  return Object.fromEntries(
    ["sharp", "vips", "mozjpeg", "webp", "aom", "heif", "lcms", "glib", "xml2", "zlib"]
      .flatMap((name) => versions[name] ? [[name, versions[name]]] : []),
  );
}

function startStageRecorder(startedAt: number, onCutoff: (observedMiB: number) => never): StageRecorder {
  let samples = 0;
  let stopped = false;
  let peak: MemoryMiB = memoryMiB();

  const update = () => {
    const usage = process.memoryUsage();
    const current = {
      rss: round(usage.rss / MIB, 1),
      heapUsed: round(usage.heapUsed / MIB, 1),
      external: round(usage.external / MIB, 1),
      arrayBuffers: round(usage.arrayBuffers / MIB, 1),
    };
    samples += 1;
    peak = {
      rss: Math.max(peak.rss, current.rss),
      heapUsed: Math.max(peak.heapUsed, current.heapUsed),
      external: Math.max(peak.external, current.external),
      arrayBuffers: Math.max(peak.arrayBuffers, current.arrayBuffers),
    };
    if (usage.rss >= RSS_SAFETY_CUTOFF_BYTES) onCutoff(current.rss);
    return current;
  };

  const timer = setInterval(update, MEMORY_SAMPLE_INTERVAL_MS);
  timer.unref();
  return {
    capture: (sharp) => ({
      elapsedMs: round(performance.now() - startedAt),
      memoryMiB: update(),
      ...(sharp ? { sharpCache: normalizeSharpCacheStats(sharp.cache() as SharpCacheStats) } : {}),
    }),
    peak: () => ({ ...peak }),
    sampleCount: () => samples,
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      update();
    },
  };
}

async function sha256File(filename: string) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filename)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

async function idleStages(
  checkpoints: readonly [number, number, number],
  recorder: StageRecorder,
  sharp?: SharpModule,
) {
  const stages: Record<string, MemoryStage> = {};
  let previous = 0;
  for (const checkpoint of checkpoints) {
    await wait(checkpoint - previous);
    await waitForImmediate();
    stages[`idle${checkpoint}ms`] = recorder.capture(sharp);
    previous = checkpoint;
  }
  return stages;
}

async function fixtureWorker(values: ReadonlyMap<string, string>, recorder: StageRecorder) {
  assertOnlyArguments(values, ["kind", "fixture-path", "pixels"]);
  const fixturePath = assertTemporaryPath(values.get("fixture-path"), "--fixture-path");
  const dimensions = dimensionsForTargetPixels(parseSafeInteger(
    values.get("pixels"),
    "--pixels",
    10_000,
    MAX_IMAGE_PIXELS,
  ));
  await mkdir(path.dirname(fixturePath), { recursive: true, mode: 0o700 });
  const temporary = `${fixturePath}.tmp`;
  const sharp = (await import("sharp")).default;
  const configured = recorder.capture(sharp);
  try {
    await sharp({
      create: {
        width: dimensions.width,
        height: dimensions.height,
        channels: 3,
        background: { r: 18, g: 36, b: 54 },
      },
    }).jpeg({ quality: 62, progressive: true }).toFile(temporary);
    await rename(temporary, fixturePath);
    const metadata = await sharp(fixturePath).metadata();
    assert.equal(metadata.width, dimensions.width);
    assert.equal(metadata.height, dimensions.height);
    assert.equal(metadata.isProgressive, true);
    const file = await stat(fixturePath);
    return {
      workload: "synthetic-progressive-jpeg-fixture",
      configured,
      fixture: {
        ...dimensions,
        bytes: file.size,
        sha256: await sha256File(fixturePath),
        progressive: true,
      },
      sharp: {
        versions: selectedSharpVersions(sharp.versions),
        concurrency: sharp.concurrency(),
        simd: sharp.simd(),
        cache: normalizeSharpCacheStats(sharp.cache() as SharpCacheStats),
      },
    } as const;
  } finally {
    await rm(temporary, { force: true });
  }
}

async function sharpWorker(values: ReadonlyMap<string, string>, recorder: StageRecorder) {
  assertOnlyArguments(values, [
    "kind",
    "scenario",
    "fixture-path",
    "fixture-sha256",
    "warmup-path",
    "warmup-sha256",
    "cycles",
    "idle-ms",
  ]);
  const scenarioValue = values.get("scenario") ?? "";
  if (!isSharpScenarioName(scenarioValue)) throw new Error("--scenario must be A, B, C, D, E8, or F16.");
  const scenario = SHARP_SCENARIOS[scenarioValue];
  const fixturePath = assertTemporaryPath(values.get("fixture-path"), "--fixture-path");
  const warmupPath = assertTemporaryPath(values.get("warmup-path"), "--warmup-path");
  const expectedFixtureSha256 = values.get("fixture-sha256");
  const expectedWarmupSha256 = values.get("warmup-sha256");
  if (!expectedFixtureSha256 || !expectedWarmupSha256) throw new Error("Fixture digests are required.");
  const cycles = parseSafeInteger(values.get("cycles"), "--cycles", 1, MAX_FULL_IMAGE_CYCLES);
  const idleCheckpoints = parseIdleCheckpoints(values.get("idle-ms"));

  Reflect.set(process.env, "NODE_ENV", "test");
  Reflect.set(process.env, "MEMORY_DIAGNOSTICS_ENABLED", "false");
  const startup = recorder.capture();
  const sharpModule = await import("sharp");
  const sharp = sharpModule.default;
  const defaults = {
    cache: normalizeSharpCacheStats(sharp.cache() as SharpCacheStats),
    concurrency: sharp.concurrency(),
    simd: sharp.simd(),
  } as const;
  const rawDefaultsCaptured = recorder.capture(sharp);

  const [uploadModule, diagnosticsModule, applicationSharpModule] = await Promise.all([
    import("@/lib/orders/upload"),
    import("@/lib/memory-diagnostics"),
    import("@/lib/media/sharp"),
  ]);
  assert.strictEqual(applicationSharpModule.default, sharp);
  const applicationConfigurationBeforeScenarioReset = applicationSharpModule.getApplicationSharpState();
  assert.deepEqual(applicationConfigurationBeforeScenarioReset, {
    configurationApplications: 1,
    cache: { memoryMiB: 0, files: 0, items: 0 },
    concurrency: 1,
  });
  const applicationConfigurationApplied = recorder.capture(sharp);

  if (scenario.cache === "default") {
    sharp.cache({
      memory: defaults.cache.memory.max,
      files: defaults.cache.files.max,
      items: defaults.cache.items.max,
    });
  }
  if (scenario.cache === "off") sharp.cache(false);
  if (scenario.cache === "bounded") {
    sharp.cache({
      memory: scenario.cacheMemoryMiB,
      files: scenario.cacheFiles,
      items: scenario.cacheItems,
    });
  }
  sharp.concurrency(scenario.concurrency === "default" ? defaults.concurrency : scenario.concurrency);
  const configured = {
    cache: normalizeSharpCacheStats(sharp.cache() as SharpCacheStats),
    concurrency: sharp.concurrency(),
    simd: sharp.simd(),
  } as const;
  const configuredCacheLimits = {
    memoryMiB: configured.cache.memory.max,
    files: configured.cache.files.max,
    items: configured.cache.items.max,
  } as const;
  if (scenario.cache === "default") {
    assert.deepEqual(configuredCacheLimits, {
      memoryMiB: defaults.cache.memory.max,
      files: defaults.cache.files.max,
      items: defaults.cache.items.max,
    });
  }
  if (scenario.cache === "off") {
    assert.deepEqual(configuredCacheLimits, { memoryMiB: 0, files: 0, items: 0 });
  }
  if (scenario.cache === "bounded") {
    assert.deepEqual(
      configuredCacheLimits,
      {
        memoryMiB: scenario.cacheMemoryMiB,
        files: scenario.cacheFiles,
        items: scenario.cacheItems,
      },
    );
  }
  assert.equal(
    configured.concurrency,
    scenario.concurrency === "default" ? defaults.concurrency : scenario.concurrency,
  );
  if (scenarioValue === "D") {
    assert.deepEqual(
      { cache: configuredCacheLimits, concurrency: configured.concurrency },
      {
        cache: applicationConfigurationBeforeScenarioReset.cache,
        concurrency: applicationConfigurationBeforeScenarioReset.concurrency,
      },
    );
  }
  const afterConfiguration = recorder.capture(sharp);

  let warmupBuffer: Buffer | null = await readFile(warmupPath);
  let fixtureBuffer: Buffer | null = await readFile(fixturePath);
  assert.equal(createHash("sha256").update(warmupBuffer).digest("hex"), expectedWarmupSha256);
  assert.equal(createHash("sha256").update(fixtureBuffer).digest("hex"), expectedFixtureSha256);
  const fixtureMetadata = await sharp(fixtureBuffer).metadata();
  assert.ok(fixtureMetadata.width && fixtureMetadata.height);
  assert.ok(fixtureMetadata.width * fixtureMetadata.height <= MAX_IMAGE_PIXELS);
  assert.equal(fixtureMetadata.isProgressive, true);
  const fixtureReady = recorder.capture(sharp);

  const warmupStartedAt = performance.now();
  const warmup = await uploadModule.normalizeOrderImage({
    buffer: warmupBuffer,
    originalFilename: "warmup.jpg",
    declaredMimeType: "image/jpeg",
  });
  const warmupDurationMs = performance.now() - warmupStartedAt;
  assert.ok(warmup.width > 0 && warmup.height > 0 && warmup.buffer.length > 0);
  warmupBuffer = null;
  const afterWarmup = recorder.capture(sharp);

  const durations: number[] = [];
  const cycleEnd: MemoryStage[] = [];
  let outputBytes = 0;
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    assert.ok(fixtureBuffer);
    const operationStartedAt = performance.now();
    const output = await uploadModule.normalizeOrderImage({
      buffer: fixtureBuffer,
      originalFilename: "pixel-scaling.jpg",
      declaredMimeType: "image/jpeg",
    });
    durations.push(performance.now() - operationStartedAt);
    assert.deepEqual([output.width, output.height], [fixtureMetadata.width, fixtureMetadata.height]);
    outputBytes += output.sizeBytes;
    cycleEnd.push(recorder.capture(sharp));
  }
  fixtureBuffer = null;
  await waitForImmediate();
  const post = recorder.capture(sharp);
  const idle = await idleStages(idleCheckpoints, recorder, sharp);
  const finalSharpCounters = sharp.counters();
  assert.deepEqual(finalSharpCounters, { queue: 0, process: 0 });
  assert.deepEqual(uploadModule.getOrderPhotoTransformState(), {
    active: 0,
    queued: 0,
    concurrency: 1,
    queueLimit: 1,
  });
  assert.deepEqual(diagnosticsModule.getMemoryDiagnosticCounters(), {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  });

  return {
    workload: "order-photo-normalize",
    measurementValid: cycles >= MIN_FULL_IMAGE_CYCLES && idleCheckpoints[2] === 15_000,
    scenario: scenarioValue,
    configuration: scenario,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      allocatorEnvironmentPresent: runtimeEnvironmentPresence(),
      sharpVersions: selectedSharpVersions(sharp.versions),
      defaultsCapturedBeforeApplicationImport: true,
      defaults,
      applicationConfigurationBeforeScenarioReset,
      configured,
    },
    fixture: {
      width: fixtureMetadata.width,
      height: fixtureMetadata.height,
      pixels: fixtureMetadata.width * fixtureMetadata.height,
      bytes: (await stat(fixturePath)).size,
      sha256: expectedFixtureSha256,
      progressive: true,
    },
    cycles,
    durationsMs: {
      warmup: round(warmupDurationMs),
      measured: durationSummary(durations),
    },
    outputBytes,
    stages: {
      startup,
      rawDefaultsCaptured,
      applicationConfigurationApplied,
      afterConfiguration,
      fixtureReady,
      afterWarmup,
      cycleEnd,
      post,
      ...idle,
    },
    final: {
      sharpCache: normalizeSharpCacheStats(sharp.cache() as SharpCacheStats),
      sharpCounters: finalSharpCounters,
      semaphore: uploadModule.getOrderPhotoTransformState(),
      diagnosticCounters: diagnosticsModule.getMemoryDiagnosticCounters(),
    },
  } as const;
}

async function writeRepeatedBytes(handle: Awaited<ReturnType<typeof open>>, byteLength: number) {
  assert.ok(byteLength >= 12);
  let remaining = byteLength;
  let first = true;
  while (remaining > 0) {
    const length = Math.min(remaining, STREAM_CHUNK_BYTES);
    const chunk = Buffer.alloc(length, 0x5a);
    if (first) {
      chunk[0] = 0xff;
      chunk[1] = 0xd8;
      chunk[2] = 0xff;
      first = false;
    }
    await handle.write(chunk);
    remaining -= length;
  }
}

async function createMultipartFixture(input: {
  filename: string;
  fileCount: number;
  bytesPerFile: number;
  fieldName: "files" | "evidence";
}) {
  const handle = await open(input.filename, "wx", 0o600);
  try {
    await handle.write(Buffer.from(
      `--${SYNTHETIC_BOUNDARY}\r\nContent-Disposition: form-data; name="marker"\r\n\r\ntrue\r\n`,
    ));
    for (let index = 0; index < input.fileCount; index += 1) {
      await handle.write(Buffer.from(
        `--${SYNTHETIC_BOUNDARY}\r\nContent-Disposition: form-data; name="${input.fieldName}"; filename="fixture-${index}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ));
      await writeRepeatedBytes(handle, input.bytesPerFile);
      await handle.write(Buffer.from("\r\n"));
    }
    await handle.write(Buffer.from(`--${SYNTHETIC_BOUNDARY}--\r\n`));
  } finally {
    await handle.close();
  }
  return (await stat(input.filename)).size;
}

function streamedMultipartRequest(filename: string, contentLength: number) {
  const source = createReadStream(filename, { highWaterMark: STREAM_CHUNK_BYTES });
  return new Request("http://127.0.0.1/memory-hardening", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${SYNTHETIC_BOUNDARY}`,
      "content-length": String(contentLength),
    },
    body: Readable.toWeb(source) as never,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

type MultipartConcurrencyMode = "phase1-concurrent" | "early-admission";

class PrototypeImageProcessingBusyError extends Error {
  readonly code = "IMAGE_PROCESSING_BUSY";
  readonly status = 503;

  constructor() {
    super("Synthetic image-processing admission is saturated.");
    this.name = "PrototypeImageProcessingBusyError";
  }
}

type PrototypeWaiter = Readonly<{ resolve: () => void }>;

class PrototypeAdmissionLimiter {
  private active = 0;
  private readonly waiters: PrototypeWaiter[] = [];

  snapshot() {
    return { active: this.active, queued: this.waiters.length, concurrency: 1, queueLimit: 1 } as const;
  }

  private acquire() {
    if (this.active === 0) {
      this.active = 1;
      return Promise.resolve();
    }
    if (this.waiters.length === 1) return Promise.reject(new PrototypeImageProcessingBusyError());
    return new Promise<void>((resolve) => this.waiters.push({ resolve }));
  }

  private release() {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve();
      return;
    }
    this.active = 0;
  }

  async run<T>(operation: () => Promise<T>) {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject } as const;
}

function multipartRequestProbe(filename: string, contentLength: number) {
  const readGate = deferred();
  let fileSource: ReturnType<typeof createReadStream> | null = null;
  let bytesRead = 0;
  let canceled = false;
  const source = Readable.from((async function* () {
    await readGate.promise;
    if (canceled) return;
    fileSource = createReadStream(filename, { highWaterMark: STREAM_CHUNK_BYTES });
    for await (const chunk of fileSource) {
      bytesRead += (chunk as Buffer).byteLength;
      yield chunk;
    }
  })());
  let request: Request | null = new Request("http://127.0.0.1/memory-hardening", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${SYNTHETIC_BOUNDARY}`,
      "content-length": String(contentLength),
    },
    body: Readable.toWeb(source) as never,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  let formDataCalls = 0;
  const parseDurationsMs: number[] = [];

  return {
    async formData() {
      assert.ok(request);
      formDataCalls += 1;
      readGate.resolve();
      const startedAt = performance.now();
      const parsed = await request.formData();
      parseDurationsMs.push(performance.now() - startedAt);
      return parsed;
    },
    async cancelUnusedBody() {
      if (request && !request.bodyUsed) {
        canceled = true;
        readGate.resolve();
        await request.body?.cancel();
      }
    },
    dropRequest() {
      request = null;
    },
    snapshot() {
      return {
        formDataCalls,
        bytesRead,
        bodyUsed: request?.bodyUsed ?? null,
        sourceOpened: fileSource !== null,
        sourceDestroyed: fileSource?.destroyed ?? source.destroyed,
        sourceClosed: fileSource?.closed ?? false,
        parseDurationsMs: parseDurationsMs.map((duration) => round(duration)),
      } as const;
    },
  } as const;
}

function assertConcurrencyMode(value: string | undefined): MultipartConcurrencyMode {
  if (value === "phase1-concurrent" || value === "early-admission") return value;
  throw new Error("--mode must be phase1-concurrent or early-admission for a concurrency worker.");
}

async function phase1ConcurrentMultipartScenario(input: {
  probes: ReturnType<typeof multipartRequestProbe>[];
  recorder: StageRecorder;
}) {
  const limiter = new PrototypeAdmissionLimiter();
  const holders: Array<FormData | null> = [null, null, null];
  const twoParsed = deferred();
  const firstEntered = deferred();
  const thirdRejected = deferred<PrototypeImageProcessingBusyError>();
  const releaseFirst = deferred();
  let parsedCount = 0;
  let enteredCount = 0;
  let activeParses = 0;
  let peakActiveParses = 0;

  const parse = async (index: number) => {
    activeParses += 1;
    peakActiveParses = Math.max(peakActiveParses, activeParses);
    try {
      return await input.probes[index]!.formData();
    } finally {
      activeParses -= 1;
    }
  };

  const parseThenEnterPhase1Slot = async (index: number) => {
    const parsed = await parse(index);
    holders[index] = parsed;
    parsedCount += 1;
    if (parsedCount === 2) twoParsed.resolve();
    try {
      return await limiter.run(async () => {
        enteredCount += 1;
        if (enteredCount === 1) {
          firstEntered.resolve();
          await releaseFirst.promise;
        }
        holders[index] = null;
      });
    } catch (error) {
      if (index === 2 && error instanceof PrototypeImageProcessingBusyError) thirdRejected.resolve(error);
      throw error;
    }
  };

  const firstTwo = [parseThenEnterPhase1Slot(0), parseThenEnterPhase1Slot(1)];
  await Promise.all([twoParsed.promise, firstEntered.promise]);
  await waitForImmediate();
  assert.deepEqual(limiter.snapshot(), { active: 1, queued: 1, concurrency: 1, queueLimit: 1 });
  const afterTwoFormData = input.recorder.capture();

  const third = parseThenEnterPhase1Slot(2);
  const settledPromise = Promise.allSettled([...firstTwo, third]);
  const busyError = await thirdRejected.promise;
  assert.equal(busyError.status, 503);
  assert.equal(busyError.code, "IMAGE_PROCESSING_BUSY");
  assert.equal(input.probes[2]!.snapshot().formDataCalls, 1);
  assert.equal(input.probes[2]!.snapshot().bytesRead > 0, true);
  assert.equal(input.probes[2]!.snapshot().sourceOpened, true);
  assert.equal(activeParses, 0);
  assert.equal(peakActiveParses, 2);
  const limiterAtThirdDecision = limiter.snapshot();
  const afterThirdFormDataRejected = input.recorder.capture();

  holders[2] = null;
  releaseFirst.resolve();
  const settled = await settledPromise;
  assert.deepEqual(settled.map(({ status }) => status), ["fulfilled", "fulfilled", "rejected"]);
  assert.equal(settled[2]?.status === "rejected" && settled[2].reason instanceof PrototypeImageProcessingBusyError, true);
  assert.deepEqual(limiter.snapshot(), { active: 0, queued: 0, concurrency: 1, queueLimit: 1 });
  holders.fill(null);
  const afterProcessing = input.recorder.capture();

  return {
    scenario: "phase1-slot-after-formdata",
    stages: { afterTwoFormData, afterThirdFormDataRejected, afterProcessing },
    limiterFinal: limiter.snapshot(),
    limiterAtThirdDecision,
    formDataConcurrency: { activeFinal: activeParses, peak: peakActiveParses },
    formDataCalls: input.probes.map((probe) => probe.snapshot().formDataCalls),
    bytesRead: input.probes.map((probe) => probe.snapshot().bytesRead),
    thirdRequest: {
      status: busyError.status,
      code: busyError.code,
      rejectedBeforeFormData: false,
      materializedBeforeRejection: true,
    },
  } as const;
}

async function earlyAdmissionMultipartScenario(input: {
  probes: ReturnType<typeof multipartRequestProbe>[];
  recorder: StageRecorder;
}) {
  const limiter = new PrototypeAdmissionLimiter();
  const holders: Array<FormData | null> = [null, null, null];
  const firstParsed = deferred();
  const secondParsed = deferred();
  const releaseFirst = deferred();
  const releaseSecond = deferred();
  let activeParses = 0;
  let peakActiveParses = 0;

  const parse = async (index: number) => {
    activeParses += 1;
    peakActiveParses = Math.max(peakActiveParses, activeParses);
    try {
      return await input.probes[index]!.formData();
    } finally {
      activeParses -= 1;
    }
  };

  const admittedParse = (index: number) => limiter.run(async () => {
    holders[index] = await parse(index);
    if (index === 0) {
      firstParsed.resolve();
      await releaseFirst.promise;
    } else if (index === 1) {
      secondParsed.resolve();
      await releaseSecond.promise;
    }
    holders[index] = null;
  });

  const first = admittedParse(0);
  await firstParsed.promise;
  await waitForImmediate();
  const second = admittedParse(1);
  await waitForImmediate();
  assert.deepEqual(limiter.snapshot(), { active: 1, queued: 1, concurrency: 1, queueLimit: 1 });
  assert.deepEqual(input.probes.map((probe) => probe.snapshot().formDataCalls), [1, 0, 0]);
  assert.deepEqual(input.probes.slice(1).map((probe) => probe.snapshot().bytesRead), [0, 0]);
  assert.equal(input.probes[2]!.snapshot().sourceOpened, false);

  const third = admittedParse(2);
  const settledPromise = Promise.allSettled([first, second, third]);
  await waitForImmediate();
  const limiterAtThirdDecision = limiter.snapshot();
  const afterThirdRejectedBeforeFormData = input.recorder.capture();
  assert.deepEqual(input.probes.map((probe) => probe.snapshot().formDataCalls), [1, 0, 0]);
  assert.deepEqual(input.probes.slice(1).map((probe) => probe.snapshot().bytesRead), [0, 0]);

  releaseFirst.resolve();
  await secondParsed.promise;
  await waitForImmediate();
  assert.deepEqual(limiter.snapshot(), { active: 1, queued: 0, concurrency: 1, queueLimit: 1 });
  const afterSecondFormData = input.recorder.capture();
  releaseSecond.resolve();

  const settled = await settledPromise;
  assert.deepEqual(settled.map(({ status }) => status), ["fulfilled", "fulfilled", "rejected"]);
  const rejection = settled[2]?.status === "rejected" ? settled[2].reason : null;
  assert.ok(rejection instanceof PrototypeImageProcessingBusyError);
  assert.equal(rejection.status, 503);
  assert.equal(rejection.code, "IMAGE_PROCESSING_BUSY");
  assert.equal(input.probes[2]!.snapshot().formDataCalls, 0);
  assert.equal(input.probes[2]!.snapshot().bytesRead, 0);
  assert.equal(input.probes[2]!.snapshot().sourceOpened, false);
  assert.equal(activeParses, 0);
  assert.equal(peakActiveParses, 1);
  await input.probes[2]!.cancelUnusedBody();
  holders.fill(null);
  assert.deepEqual(limiter.snapshot(), { active: 0, queued: 0, concurrency: 1, queueLimit: 1 });
  const afterProcessing = input.recorder.capture();

  return {
    scenario: "prototype-admission-before-formdata",
    stages: { afterThirdRejectedBeforeFormData, afterSecondFormData, afterProcessing },
    limiterFinal: limiter.snapshot(),
    limiterAtThirdDecision,
    formDataConcurrency: { activeFinal: activeParses, peak: peakActiveParses },
    formDataCalls: input.probes.map((probe) => probe.snapshot().formDataCalls),
    bytesRead: input.probes.map((probe) => probe.snapshot().bytesRead),
    thirdRequest: {
      status: rejection.status,
      code: rejection.code,
      rejectedBeforeFormData: true,
      materializedBeforeRejection: false,
    },
  } as const;
}

async function multipartConcurrencyWorker(
  values: ReadonlyMap<string, string>,
  recorder: StageRecorder,
) {
  assertOnlyArguments(values, ["kind", "mode", "temp-root", "files", "bytes-per-file", "idle-ms"]);
  const mode = assertConcurrencyMode(values.get("mode"));
  const temporaryRoot = assertTemporaryPath(values.get("temp-root"), "--temp-root");
  const fileCount = parseSafeInteger(values.get("files"), "--files", 1, MAX_MULTIPART_FILES);
  const bytesPerFile = parseSafeInteger(values.get("bytes-per-file"), "--bytes-per-file", 12, MAX_MULTIPART_FILE_BYTES);
  const idleCheckpoints = parseIdleCheckpoints(values.get("idle-ms"));
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const fixturePath = path.join(temporaryRoot, `${mode}.multipart`);
  const multipartBytes = await createMultipartFixture({
    filename: fixturePath,
    fileCount,
    bytesPerFile,
    fieldName: "files",
  });
  const fixtureReady = recorder.capture();
  const beforeRequests = recorder.capture();
  const probes = Array.from({ length: 3 }, () => multipartRequestProbe(fixturePath, multipartBytes));
  await waitForImmediate();
  assert.deepEqual(probes.map((probe) => probe.snapshot().bytesRead), [0, 0, 0]);
  const afterRequestConstruction = recorder.capture();

  const result = mode === "phase1-concurrent"
    ? await phase1ConcurrentMultipartScenario({ probes, recorder })
    : await earlyAdmissionMultipartScenario({ probes, recorder });
  const probeStateBeforeDrop = probes.map((probe) => probe.snapshot());
  for (const probe of probes) probe.dropRequest();
  await waitForImmediate();
  const post = recorder.capture();
  const idle = await idleStages(idleCheckpoints, recorder);

  assert.deepEqual(result.limiterFinal, { active: 0, queued: 0, concurrency: 1, queueLimit: 1 });
  assert.deepEqual(result.limiterAtThirdDecision, { active: 1, queued: 1, concurrency: 1, queueLimit: 1 });
  assert.deepEqual(result.formDataConcurrency, {
    activeFinal: 0,
    peak: mode === "phase1-concurrent" ? 2 : 1,
  });
  assert.equal(result.formDataCalls[0], 1);
  assert.equal(result.formDataCalls[1], 1);
  assert.equal(result.formDataCalls[2], mode === "phase1-concurrent" ? 1 : 0);
  assert.equal(result.bytesRead[0], multipartBytes);
  assert.equal(result.bytesRead[1], multipartBytes);
  assert.equal(result.bytesRead[2], mode === "phase1-concurrent" ? multipartBytes : 0);

  return {
    workload: "same-process-multipart-concurrency-no-sharp",
    measurementValid: fileCount === 10 && bytesPerFile === 10 * MIB && idleCheckpoints[2] === 15_000,
    sharpLoaded: false,
    mode,
    fixture: { fileCount, bytesPerFile, multipartBytes },
    requestCount: probes.length,
    stages: { fixtureReady, beforeRequests, afterRequestConstruction, ...result.stages, post, ...idle },
    limiterFinal: result.limiterFinal,
    limiterAtThirdDecision: result.limiterAtThirdDecision,
    formDataConcurrency: result.formDataConcurrency,
    formDataCalls: result.formDataCalls,
    bytesRead: result.bytesRead,
    thirdRequest: result.thirdRequest,
    probes: probeStateBeforeDrop,
    safeguards: { databaseCalls: 0, networkRequests: 0, portsOpened: 0, globalGcCalls: 0 },
  } as const;
}

async function multipartWorker(
  values: ReadonlyMap<string, string>,
  recorder: StageRecorder,
  mode: "multipart" | "sav",
) {
  assertOnlyArguments(values, ["kind", "temp-root", "files", "bytes-per-file", "iterations", "idle-ms"]);
  const temporaryRoot = assertTemporaryPath(values.get("temp-root"), "--temp-root");
  const maximumFiles = mode === "sav" ? MAX_SAV_FILES : MAX_MULTIPART_FILES;
  const maximumBytes = mode === "sav" ? MAX_SAV_FILE_BYTES : MAX_MULTIPART_FILE_BYTES;
  const fileCount = parseSafeInteger(values.get("files"), "--files", 1, maximumFiles);
  const bytesPerFile = parseSafeInteger(values.get("bytes-per-file"), "--bytes-per-file", 12, maximumBytes);
  const iterations = parseSafeInteger(values.get("iterations"), "--iterations", 1, 5);
  const idleCheckpoints = parseIdleCheckpoints(values.get("idle-ms"));
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const fixturePath = path.join(temporaryRoot, `${mode}.multipart`);
  const multipartBytes = await createMultipartFixture({
    filename: fixturePath,
    fileCount,
    bytesPerFile,
    fieldName: mode === "sav" ? "evidence" : "files",
  });
  const fixtureReady = recorder.capture();
  const parseDurations: number[] = [];
  const actionDurations: number[] = [];
  const inputReady: MemoryStage[] = [];
  const cycleEnd: MemoryStage[] = [];
  let validatedFiles = 0;
  let validatedBytes = 0;
  const evidenceDomain = mode === "sav" ? await import("@/lib/shop/evidence-domain") : null;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const parseStartedAt = performance.now();
    let formData: FormData | null = await streamedMultipartRequest(fixturePath, multipartBytes).formData();
    parseDurations.push(performance.now() - parseStartedAt);
    const fieldName = mode === "sav" ? "evidence" : "files";
    const files = formData.getAll(fieldName).filter((value): value is File => value instanceof File);
    assert.equal(files.length, fileCount);
    assert.ok(files.every((file) => file.size === bytesPerFile));
    inputReady.push(recorder.capture());

    if (mode === "sav") {
      assert.ok(evidenceDomain);
      const actionStartedAt = performance.now();
      const inputs = await Promise.all(files.map(async (file) => ({
        name: file.name,
        type: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })));
      evidenceDomain.assertShopEvidenceCount(0, inputs.length);
      const validated = inputs.map((input) => evidenceDomain.validateShopEvidenceUpload(input));
      actionDurations.push(performance.now() - actionStartedAt);
      validatedFiles += validated.length;
      validatedBytes += validated.reduce((total, entry) => total + entry.byteSize, 0);
    } else {
      validatedFiles += files.length;
      validatedBytes += files.reduce((total, file) => total + file.size, 0);
    }
    formData = null;
    cycleEnd.push(recorder.capture());
  }

  await waitForImmediate();
  const post = recorder.capture();
  const idle = await idleStages(idleCheckpoints, recorder);
  return {
    workload: mode === "sav" ? "sav-formdata-promise-all-arraybuffer" : "request-formdata-no-sharp",
    measurementValid: idleCheckpoints[2] === 15_000,
    sharpLoaded: false,
    fixture: { fileCount, bytesPerFile, multipartBytes },
    iterations,
    durationsMs: {
      parse: durationSummary(parseDurations),
      ...(actionDurations.length ? { actionProjection: durationSummary(actionDurations) } : {}),
    },
    validatedFiles,
    validatedBytes,
    stages: { fixtureReady, inputReady, cycleEnd, post, ...idle },
    safeguards: { databaseCalls: 0, networkRequests: 0, portsOpened: 0, globalGcCalls: 0 },
  } as const;
}

async function main() {
  const startedAt = performance.now();
  const values = parseArgumentMap(process.argv.slice(2));
  const kind = workerKind(values.get("kind"));
  let cutoffSent = false;
  let recorder: StageRecorder | null = null;

  const cutoff = (observedMiB: number): never => {
    if (cutoffSent) process.exit(SAFETY_EXIT_CODE);
    cutoffSent = true;
    const envelope: WorkerEnvelope = {
      protocolVersion: PHASE2_PROTOCOL_VERSION,
      type: "cutoff",
      kind,
      status: "cutoff",
      cutoff: {
        thresholdMiB: round(RSS_SAFETY_CUTOFF_MIB, 1),
        observedMiB,
        elapsedMs: round(performance.now() - startedAt),
      },
    };
    process.stdout.write(`${JSON.stringify(envelope)}\n`, () => process.exit(SAFETY_EXIT_CODE));
    setTimeout(() => process.exit(SAFETY_EXIT_CODE), 100);
    throw new Error("RSS safety cutoff reached.");
  };

  recorder = startStageRecorder(startedAt, cutoff);
  const startup = recorder.capture();
  const result = kind === "fixture"
    ? await fixtureWorker(values, recorder)
    : kind === "sharp"
      ? await sharpWorker(values, recorder)
      : kind === "multipart" && values.has("mode")
        ? await multipartConcurrencyWorker(values, recorder)
        : await multipartWorker(values, recorder, kind);
  recorder.stop();
  const envelope: WorkerEnvelope = {
    protocolVersion: PHASE2_PROTOCOL_VERSION,
    type: "result",
    kind,
    status: "pass",
    result: {
      ...result,
      memory: {
        startup,
        peakMiB: recorder.peak(),
        samples: recorder.sampleCount(),
        sampleIntervalMs: MEMORY_SAMPLE_INTERVAL_MS,
      },
      safety: {
        rssCutoffMiB: round(RSS_SAFETY_CUTOFF_MIB, 1),
        cutoffTriggered: false,
        timeoutTriggered: false,
      },
    },
  };
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Phase 2 worker failure.";
  process.stderr.write(`Phase 2 memory worker failed: ${message}\n`);
  process.exitCode = 1;
});
