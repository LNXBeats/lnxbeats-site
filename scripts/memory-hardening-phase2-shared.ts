import assert from "node:assert/strict";

export const PHASE2_PROTOCOL_VERSION = 1;
export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;
export const RSS_SAFETY_CUTOFF_BYTES = Math.floor(1.6 * GIB);
export const RSS_SAFETY_CUTOFF_MIB = RSS_SAFETY_CUTOFF_BYTES / MIB;
export const MEMORY_SAMPLE_INTERVAL_MS = 25;
export const SAFETY_EXIT_CODE = 86;
export const TIMEOUT_EXIT_CODE = 87;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const FULL_IMAGE_CYCLES = 5;
export const MIN_FULL_IMAGE_CYCLES = 5;
export const MAX_FULL_IMAGE_CYCLES = 10;
export const FULL_PIXEL_TARGETS = Object.freeze([
  250_000,
  1_000_000,
  4_000_000,
  12_000_000,
  24_000_000,
  39_500_000,
]);
export const SMOKE_PIXEL_TARGETS = Object.freeze([250_000]);
export const FULL_IDLE_CHECKPOINTS_MS = Object.freeze([1_000, 5_000, 15_000] as const);
export const SMOKE_IDLE_CHECKPOINTS_MS = Object.freeze([50, 100, 200] as const);

export const SHARP_SCENARIOS = Object.freeze({
  A: Object.freeze({ cache: "default" as const, concurrency: "default" as const }),
  B: Object.freeze({ cache: "off" as const, concurrency: "default" as const }),
  C: Object.freeze({ cache: "default" as const, concurrency: 1 as const }),
  D: Object.freeze({ cache: "off" as const, concurrency: 1 as const }),
  E8: Object.freeze({
    cache: "bounded" as const,
    cacheMemoryMiB: 8 as const,
    cacheFiles: 0 as const,
    cacheItems: 16 as const,
    concurrency: 1 as const,
  }),
  F16: Object.freeze({
    cache: "bounded" as const,
    cacheMemoryMiB: 16 as const,
    cacheFiles: 4 as const,
    cacheItems: 32 as const,
    concurrency: 1 as const,
  }),
});

export type SharpScenarioName = keyof typeof SHARP_SCENARIOS;
export type WorkerKind = "fixture" | "sharp" | "multipart" | "sav";

export type MemoryMiB = Readonly<{
  rss: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}>;

export type SharpCacheStats = Readonly<{
  memory: Readonly<{ current: number; high: number; max: number }>;
  files: Readonly<{ current: number; max: number }>;
  items: Readonly<{ current: number; max: number }>;
}>;

export type MemoryStage = Readonly<{
  elapsedMs: number;
  memoryMiB: MemoryMiB;
  sharpCache?: SharpCacheStats;
}>;

export type WorkerEnvelope = Readonly<{
  protocolVersion: typeof PHASE2_PROTOCOL_VERSION;
  type: "result" | "cutoff";
  kind: WorkerKind;
  status: "pass" | "cutoff";
  result?: unknown;
  cutoff?: Readonly<{
    thresholdMiB: number;
    observedMiB: number;
    elapsedMs: number;
  }>;
}>;

export function round(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function memoryMiB(): MemoryMiB {
  const usage = process.memoryUsage();
  return {
    rss: round(usage.rss / MIB, 1),
    heapUsed: round(usage.heapUsed / MIB, 1),
    external: round(usage.external / MIB, 1),
    arrayBuffers: round(usage.arrayBuffers / MIB, 1),
  };
}

export function normalizeSharpCacheStats(value: SharpCacheStats): SharpCacheStats {
  return {
    memory: {
      current: value.memory.current,
      high: value.memory.high,
      max: value.memory.max,
    },
    files: { current: value.files.current, max: value.files.max },
    items: { current: value.items.current, max: value.items.max },
  };
}

export function dimensionsForTargetPixels(targetPixels: number) {
  assert.ok(Number.isSafeInteger(targetPixels) && targetPixels >= 10_000 && targetPixels <= MAX_IMAGE_PIXELS);
  // A constant 4:3 aspect ratio makes pixel count the principal scaling input.
  const width = Math.max(1, Math.floor(Math.sqrt(targetPixels * 4 / 3)));
  const height = Math.max(1, Math.floor(targetPixels / width));
  const pixels = width * height;
  assert.ok(width <= 12_000 && height <= 12_000 && pixels <= MAX_IMAGE_PIXELS);
  return { targetPixels, width, height, pixels } as const;
}

export function parseSafeInteger(value: string | undefined, name: string, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function parseArgumentMap(arguments_: readonly string[]) {
  const values = new Map<string, string>();
  for (const argument of arguments_) {
    if (!argument.startsWith("--") || !argument.includes("=")) throw new Error(`Invalid argument: ${argument}`);
    const separator = argument.indexOf("=");
    const name = argument.slice(2, separator);
    const value = argument.slice(separator + 1);
    if (!name || !value || values.has(name)) throw new Error(`Invalid or duplicate argument: ${argument}`);
    values.set(name, value);
  }
  return values;
}

export function assertOnlyArguments(values: ReadonlyMap<string, string>, allowed: readonly string[]) {
  const accepted = new Set(allowed);
  for (const name of values.keys()) {
    if (!accepted.has(name)) throw new Error(`Unknown argument: --${name}`);
  }
}

export function isSharpScenarioName(value: string): value is SharpScenarioName {
  return Object.hasOwn(SHARP_SCENARIOS, value);
}

export function durationSummary(values: readonly number[]) {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (ratio: number) => sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]!;
  return {
    total: round(values.reduce((total, value) => total + value, 0)),
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    max: round(sorted.at(-1)!),
  } as const;
}
