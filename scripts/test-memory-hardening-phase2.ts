import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  assertOnlyArguments,
  FULL_IDLE_CHECKPOINTS_MS,
  FULL_IMAGE_CYCLES,
  FULL_PIXEL_TARGETS,
  isSharpScenarioName,
  MAX_FULL_IMAGE_CYCLES,
  MAX_IMAGE_PIXELS,
  MIN_FULL_IMAGE_CYCLES,
  MIB,
  parseArgumentMap,
  parseSafeInteger,
  PHASE2_PROTOCOL_VERSION,
  round,
  RSS_SAFETY_CUTOFF_MIB,
  SAFETY_EXIT_CODE,
  SHARP_SCENARIOS,
  SMOKE_IDLE_CHECKPOINTS_MS,
  SMOKE_PIXEL_TARGETS,
  type SharpScenarioName,
  type WorkerEnvelope,
  type WorkerKind,
} from "@/scripts/memory-hardening-phase2-shared";

const DEFAULT_FULL_REPORT = "/private/tmp/lnxbeats-memory-hardening-phase2-report.json";
const DEFAULT_SMOKE_REPORT = "/private/tmp/lnxbeats-memory-hardening-phase2-smoke-report.json";
const TEMP_ROOT_TEMPLATE = "/private/tmp/lnxbeats-memory-hardening-phase2-";
const MAX_CAPTURE_BYTES = 1024 * 1024;
const FULL_WORKER_TIMEOUT_MS = 90_000;
const SMOKE_WORKER_TIMEOUT_MS = 20_000;
const WORKER_TERMINATION_GRACE_MS = 500;

type Profile = "smoke" | "full";
type WorkloadSelection = "all" | "sharp" | "multipart" | "sav";

type ParentOptions = Readonly<{
  profile: Profile;
  reportPath: string;
  cycles: number;
  scenarios: readonly SharpScenarioName[];
  pixelTargets: readonly number[];
  idleCheckpointsMs: readonly [number, number, number];
  workerTimeoutMs: number;
  only: WorkloadSelection;
}>;

type WorkerRun = Readonly<{
  status: "pass" | "cutoff" | "timeout" | "failed";
  kind: WorkerKind;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  envelope?: WorkerEnvelope;
  errorCode?: "INVALID_PROTOCOL" | "OUTPUT_LIMIT" | "WORKER_FAILED" | "WORKER_TIMEOUT";
}>;

type FixtureManifest = Readonly<{
  label: string;
  targetPixels: number;
  width: number;
  height: number;
  pixels: number;
  bytes: number;
  sha256: string;
  progressive: true;
  filename: string;
}>;

function parseProfile(value: string | undefined): Profile {
  if (value === undefined || value === "smoke") return "smoke";
  if (value === "full") return "full";
  throw new Error("--profile must be smoke or full.");
}

function parseOnly(value: string | undefined): WorkloadSelection {
  if (value === undefined || value === "all" || value === "sharp" || value === "multipart" || value === "sav") {
    return value ?? "all";
  }
  throw new Error("--only must be all, sharp, multipart, or sav.");
}

function parseScenarios(value: string | undefined) {
  const parsed = (value ?? "A,B,C,D").split(",");
  if (!parsed.length || parsed.some((entry) => !isSharpScenarioName(entry)) || new Set(parsed).size !== parsed.length) {
    throw new Error("--scenarios must be a unique comma-separated subset of A,B,C,D,E8,F16.");
  }
  return parsed as SharpScenarioName[];
}

function parsePixelTargets(value: string | undefined, profile: Profile) {
  if (value === undefined) return profile === "full" ? [...FULL_PIXEL_TARGETS] : [...SMOKE_PIXEL_TARGETS];
  const parsed = value.split(",").map((entry) => Number(entry));
  if (
    !parsed.length
    || parsed.some((entry) => !Number.isSafeInteger(entry) || entry < 10_000 || entry > MAX_IMAGE_PIXELS)
    || new Set(parsed).size !== parsed.length
  ) throw new Error(`--pixels must contain unique integers between 10000 and ${MAX_IMAGE_PIXELS}.`);
  return parsed;
}

function assertReportPath(value: string) {
  const resolved = path.resolve(value);
  if (!resolved.startsWith("/private/tmp/lnxbeats-memory-hardening-phase2-") || !resolved.endsWith(".json")) {
    throw new Error("--report must be a Phase 2 JSON path directly under /private/tmp.");
  }
  return resolved;
}

function parseOptions(arguments_: readonly string[]): ParentOptions {
  const values = parseArgumentMap(arguments_);
  assertOnlyArguments(values, ["profile", "report", "cycles", "scenarios", "pixels", "worker-timeout-ms", "only"]);
  const profile = parseProfile(values.get("profile"));
  const cycles = values.has("cycles")
    ? parseSafeInteger(values.get("cycles"), "--cycles", MIN_FULL_IMAGE_CYCLES, MAX_FULL_IMAGE_CYCLES)
    : profile === "full" ? FULL_IMAGE_CYCLES : 1;
  if (profile === "smoke" && values.has("cycles")) {
    throw new Error("Custom measured cycles require --profile=full; smoke intentionally performs one non-comparable cycle.");
  }
  const defaultTimeout = profile === "full" ? FULL_WORKER_TIMEOUT_MS : SMOKE_WORKER_TIMEOUT_MS;
  const workerTimeoutMs = values.has("worker-timeout-ms")
    ? parseSafeInteger(values.get("worker-timeout-ms"), "--worker-timeout-ms", 5_000, 120_000)
    : defaultTimeout;
  return {
    profile,
    reportPath: assertReportPath(values.get("report") ?? (
      profile === "full" ? DEFAULT_FULL_REPORT : DEFAULT_SMOKE_REPORT
    )),
    cycles,
    scenarios: parseScenarios(values.get("scenarios")),
    pixelTargets: parsePixelTargets(values.get("pixels"), profile),
    idleCheckpointsMs: profile === "full" ? FULL_IDLE_CHECKPOINTS_MS : SMOKE_IDLE_CHECKPOINTS_MS,
    workerTimeoutMs,
    only: parseOnly(values.get("only")),
  };
}

function sanitizedWorkerEnvironment() {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (
      /^(?:DATABASE_URL|DIRECT_URL|AUTH_SECRET|BETTER_AUTH_SECRET|AWS_|MEDIA_S3_|STRIPE_|PAYPAL_|RESEND_|SMTP_|EMAIL_|NOTIFICATION_|SHOP_SAV_PRIVATE_STORAGE_ROOT)/.test(name)
    ) Reflect.deleteProperty(environment, name);
  }
  Reflect.deleteProperty(environment, "NODE_OPTIONS");
  environment.NODE_ENV = "test";
  environment.MEMORY_DIAGNOSTICS_ENABLED = "false";
  return environment;
}

function workerEnvelope(value: unknown): WorkerEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WorkerEnvelope>;
  if (
    candidate.protocolVersion !== PHASE2_PROTOCOL_VERSION
    || (candidate.type !== "result" && candidate.type !== "cutoff")
    || (candidate.kind !== "fixture" && candidate.kind !== "sharp" && candidate.kind !== "multipart" && candidate.kind !== "sav")
    || (candidate.status !== "pass" && candidate.status !== "cutoff")
  ) return null;
  return candidate as WorkerEnvelope;
}

async function runWorker(input: {
  repositoryRoot: string;
  workerPath: string;
  tsxLoader: string;
  arguments: readonly string[];
  kind: WorkerKind;
  timeoutMs: number;
}): Promise<WorkerRun> {
  const startedAt = performance.now();
  const child = spawn(process.execPath, [
    "--conditions=react-server",
    "--import",
    input.tsxLoader,
    input.workerPath,
    ...input.arguments,
  ], {
    cwd: input.repositoryRoot,
    env: sanitizedWorkerEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderrBytes = 0;
  let outputLimitExceeded = false;
  let timedOut = false;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (stdout.length + chunk.length > MAX_CAPTURE_BYTES) {
      outputLimitExceeded = true;
      child.kill("SIGTERM");
      return;
    }
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes > MAX_CAPTURE_BYTES) {
      outputLimitExceeded = true;
      child.kill("SIGTERM");
    }
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, WORKER_TERMINATION_GRACE_MS).unref();
  }, input.timeoutMs);
  timeout.unref();

  const closed = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  const base = {
    kind: input.kind,
    durationMs: round(performance.now() - startedAt),
    exitCode: closed.code,
    signal: closed.signal,
  } as const;
  if (timedOut) return { ...base, status: "timeout", errorCode: "WORKER_TIMEOUT" };
  if (outputLimitExceeded) return { ...base, status: "failed", errorCode: "OUTPUT_LIMIT" };
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  let parsed: unknown = null;
  try {
    parsed = lines.length ? JSON.parse(lines.at(-1)!) : null;
  } catch {
    return { ...base, status: "failed", errorCode: "INVALID_PROTOCOL" };
  }
  const envelope = workerEnvelope(parsed);
  if (!envelope || envelope.kind !== input.kind) {
    return { ...base, status: "failed", errorCode: "INVALID_PROTOCOL" };
  }
  if (closed.code === SAFETY_EXIT_CODE && envelope.type === "cutoff") {
    return { ...base, status: "cutoff", envelope };
  }
  if (closed.code !== 0 || envelope.type !== "result" || envelope.status !== "pass") {
    return { ...base, status: "failed", envelope, errorCode: "WORKER_FAILED" };
  }
  return { ...base, status: "pass", envelope };
}

function fixtureResult(run: WorkerRun, filename: string, label: string): FixtureManifest {
  assert.equal(run.status, "pass");
  assert.ok(run.envelope?.result && typeof run.envelope.result === "object");
  const result = run.envelope.result as {
    fixture?: Partial<Omit<FixtureManifest, "filename" | "label">>;
  };
  const fixture = result.fixture;
  assert.ok(
    fixture
    && Number.isSafeInteger(fixture.targetPixels)
    && Number.isSafeInteger(fixture.width)
    && Number.isSafeInteger(fixture.height)
    && Number.isSafeInteger(fixture.pixels)
    && Number.isSafeInteger(fixture.bytes)
    && typeof fixture.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(fixture.sha256)
    && fixture.progressive === true,
  );
  return {
    label,
    targetPixels: fixture.targetPixels!,
    width: fixture.width!,
    height: fixture.height!,
    pixels: fixture.pixels!,
    bytes: fixture.bytes!,
    sha256: fixture.sha256!,
    progressive: true,
    filename,
  };
}

function publicFixture(fixture: FixtureManifest) {
  return {
    label: fixture.label,
    targetPixels: fixture.targetPixels,
    width: fixture.width,
    height: fixture.height,
    pixels: fixture.pixels,
    bytes: fixture.bytes,
    sha256: fixture.sha256,
    progressive: fixture.progressive,
  } as const;
}

function safeWorkerResult(run: WorkerRun) {
  return {
    status: run.status,
    kind: run.kind,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    signal: run.signal,
    ...(run.envelope ? { envelope: run.envelope } : {}),
    ...(run.errorCode ? { errorCode: run.errorCode } : {}),
  } as const;
}

async function writeReport(reportPath: string, report: unknown) {
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /(?:\/Users\/|DATABASE_URL|access.?key|secret|credential|password|authorization|@)/i);
  const temporary = `${reportPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${serialized}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, reportPath);
  } finally {
    await rm(temporary, { force: true });
  }
  return serialized;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const startedAt = performance.now();
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workerPath = path.join(repositoryRoot, "scripts/test-memory-hardening-phase2-worker.ts");
  const tsxLoader = import.meta.resolve("tsx");
  const temporaryRoot = await mkdtemp(TEMP_ROOT_TEMPLATE);
  const fixtureRoot = path.join(temporaryRoot, "fixtures");
  const warmupTargetPixels = 10_000;
  const fixtureRuns: WorkerRun[] = [];
  const sharpRuns: Array<Readonly<{ scenario: SharpScenarioName; fixture: string; run: WorkerRun }>> = [];
  const multipartRuns: Array<Readonly<{ label: string; run: WorkerRun }>> = [];
  const savRuns: Array<Readonly<{ label: string; run: WorkerRun }>> = [];
  const fixtures: FixtureManifest[] = [];
  let terminalStatus: "pass" | "cutoff" | "timeout" | "failed" = "pass";

  const run = (kind: WorkerKind, arguments_: readonly string[]) => runWorker({
    repositoryRoot,
    workerPath,
    tsxLoader,
    arguments: [`--kind=${kind}`, ...arguments_],
    kind,
    timeoutMs: options.workerTimeoutMs,
  });
  const registerTerminalStatus = (worker: WorkerRun) => {
    if (worker.status !== "pass" && terminalStatus === "pass") terminalStatus = worker.status;
  };

  try {
    if (options.only === "all" || options.only === "sharp") {
      const targets = [warmupTargetPixels, ...options.pixelTargets.filter((pixels) => pixels !== warmupTargetPixels)];
      for (const [index, pixels] of targets.entries()) {
        const filename = path.join(fixtureRoot, `fixture-${index}.jpg`);
        const fixtureRun = await run("fixture", [`--fixture-path=${filename}`, `--pixels=${pixels}`]);
        fixtureRuns.push(fixtureRun);
        registerTerminalStatus(fixtureRun);
        if (fixtureRun.status !== "pass") break;
        fixtures.push(fixtureResult(fixtureRun, filename, pixels === warmupTargetPixels ? "warmup" : `pixels-${pixels}`));
      }

      const warmupFixture = fixtures.find((fixture) => fixture.targetPixels === warmupTargetPixels);
      if (terminalStatus === "pass") assert.ok(warmupFixture);
      for (const targetPixels of options.pixelTargets) {
        const fixture = fixtures.find((candidate) => candidate.targetPixels === targetPixels);
        if (terminalStatus !== "pass") break;
        assert.ok(fixture && warmupFixture);
        for (const scenario of options.scenarios) {
          const worker = await run("sharp", [
            `--scenario=${scenario}`,
            `--fixture-path=${fixture.filename}`,
            `--fixture-sha256=${fixture.sha256}`,
            `--warmup-path=${warmupFixture.filename}`,
            `--warmup-sha256=${warmupFixture.sha256}`,
            `--cycles=${options.cycles}`,
            `--idle-ms=${options.idleCheckpointsMs.join(",")}`,
          ]);
          sharpRuns.push({ scenario, fixture: fixture.label, run: worker });
          registerTerminalStatus(worker);
          if (worker.status !== "pass") break;
        }
      }
    }

    const multipartPlan = options.profile === "full"
      ? [
          { label: "one-by-5mib", files: 1, bytesPerFile: 5 * MIB },
          { label: "five-by-5mib", files: 5, bytesPerFile: 5 * MIB },
          { label: "ten-by-10mib", files: 10, bytesPerFile: 10 * MIB },
        ]
      : [{ label: "smoke-two-by-64kib", files: 2, bytesPerFile: 64 * 1024 }];
    if (terminalStatus === "pass" && (options.only === "all" || options.only === "multipart")) {
      for (const [index, entry] of multipartPlan.entries()) {
        const jobRoot = path.join(temporaryRoot, `multipart-${index}`);
        const worker = await run("multipart", [
          `--temp-root=${jobRoot}`,
          `--files=${entry.files}`,
          `--bytes-per-file=${entry.bytesPerFile}`,
          "--iterations=1",
          `--idle-ms=${options.idleCheckpointsMs.join(",")}`,
        ]);
        await rm(jobRoot, { recursive: true, force: true });
        multipartRuns.push({ label: entry.label, run: worker });
        registerTerminalStatus(worker);
        if (worker.status !== "pass") break;
      }

      const concurrencyPlan = options.profile === "full"
        ? { files: 10, bytesPerFile: 10 * MIB }
        : { files: 2, bytesPerFile: 64 * 1024 };
      for (const [index, mode] of (["phase1-concurrent", "early-admission"] as const).entries()) {
        if (terminalStatus !== "pass") break;
        const jobRoot = path.join(temporaryRoot, `multipart-concurrency-${index}`);
        const worker = await run("multipart", [
          `--mode=${mode}`,
          `--temp-root=${jobRoot}`,
          `--files=${concurrencyPlan.files}`,
          `--bytes-per-file=${concurrencyPlan.bytesPerFile}`,
          `--idle-ms=${options.idleCheckpointsMs.join(",")}`,
        ]);
        await rm(jobRoot, { recursive: true, force: true });
        multipartRuns.push({ label: mode, run: worker });
        registerTerminalStatus(worker);
      }
    }

    const savPlan = options.profile === "full"
      ? [
          { label: "one-by-5mib", files: 1, bytesPerFile: 5 * MIB },
          { label: "five-by-5mib", files: 5, bytesPerFile: 5 * MIB },
        ]
      : [{ label: "smoke-two-by-64kib", files: 2, bytesPerFile: 64 * 1024 }];
    if (terminalStatus === "pass" && (options.only === "all" || options.only === "sav")) {
      for (const [index, entry] of savPlan.entries()) {
        const jobRoot = path.join(temporaryRoot, `sav-${index}`);
        const worker = await run("sav", [
          `--temp-root=${jobRoot}`,
          `--files=${entry.files}`,
          `--bytes-per-file=${entry.bytesPerFile}`,
          "--iterations=1",
          `--idle-ms=${options.idleCheckpointsMs.join(",")}`,
        ]);
        await rm(jobRoot, { recursive: true, force: true });
        savRuns.push({ label: entry.label, run: worker });
        registerTerminalStatus(worker);
        if (worker.status !== "pass") break;
      }
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  const report = {
    schemaVersion: 1,
    result: terminalStatus,
    measurementClass: options.profile === "full" && terminalStatus === "pass" ? "MEASUREMENT" : "SMOKE_ONLY",
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      profile: options.profile,
      durationMs: round(performance.now() - startedAt),
    },
    methodology: {
      freshNodeProcessPerMatrixCell: true,
      sequentialWorkers: true,
      sharedImmutableSyntheticFixtures: true,
      sharpWorkload: "order-photo-normalize",
      multipartWorkload: "request-formdata-no-sharp",
      multipartConcurrencyWorkloads: [
        "phase1 slot after three same-process formData materializations",
        "prototype admission before formData with one active, one queued and one refused",
      ],
      savWorkload: "formdata-plus-promise-all-arraybuffer-validation-no-db",
      globalGcUsed: false,
      idleCheckpointsMs: options.idleCheckpointsMs,
      memoryMetrics: ["rss", "heapUsed", "external", "arrayBuffers"],
      sharpCacheStatsCaptured: true,
      defaultScenarios: ["A", "B", "C", "D"],
      boundedCacheScenariosOptIn: {
        E8: "memory 8 MiB, files 0, items 16, concurrency 1",
        F16: "memory 16 MiB, files 4, items 32, concurrency 1",
      },
    },
    auditedRuntimeContext: {
      sharpVersionInCheckout: "0.35.3",
      sharpLinuxAllocatorGuard: "On Linux glibc without jemalloc and without MALLOC_ARENA_MAX, Sharp 0.35.3 forces its effective concurrency to 1.",
      nextImageProductionBehavior: "Next's production getSharp singleton halves an effective Sharp concurrency above 1; a separate local audit observed 10 becoming 5.",
      coveredByThisMatrix: "Direct order-photo Sharp workload only; every worker records its own effective defaults and allocator-environment presence.",
    },
    matrix: {
      scenarios: Object.fromEntries(options.scenarios.map((name) => [name, SHARP_SCENARIOS[name]])),
      pixelTargets: options.pixelTargets,
      imageCycles: options.cycles,
      fixturePreparation: fixtureRuns.map(safeWorkerResult),
      fixtures: fixtures.filter((fixture) => fixture.label !== "warmup").map(publicFixture),
      sharp: sharpRuns.map((entry) => ({
        scenario: entry.scenario,
        fixture: entry.fixture,
        ...safeWorkerResult(entry.run),
      })),
      multipart: multipartRuns.map((entry) => ({ label: entry.label, ...safeWorkerResult(entry.run) })),
      sav: savRuns.map((entry) => ({ label: entry.label, ...safeWorkerResult(entry.run) })),
    },
    safety: {
      rssCutoffGiB: 1.6,
      rssCutoffMiB: round(RSS_SAFETY_CUTOFF_MIB, 1),
      workerTimeoutMs: options.workerTimeoutMs,
      workerOutputLimitBytes: MAX_CAPTURE_BYTES,
      stopMatrixOnFirstCutoffTimeoutOrFailure: true,
      networkRequests: 0,
      databaseCalls: 0,
      portsOpened: 0,
      temporaryArtifactsRemaining: 0,
    },
    interpretationLimits: [
      "Smoke results are protocol validation only and are not comparable measurements.",
      "Local allocator retention is not proof of an application memory leak.",
      "The worker imports the order-photo Sharp path, not the Next/Image production optimizer.",
      "Effective defaults are recorded per fresh process and must not be extrapolated from macOS to Railway Linux.",
    ],
  } as const;

  const serialized = await writeReport(options.reportPath, report);
  process.stdout.write(`${serialized}\n`);
  if (terminalStatus !== "pass") process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Phase 2 benchmark failure.";
  process.stderr.write(`Phase 2 memory benchmark failed: ${message}\n`);
  process.exitCode = 1;
});
