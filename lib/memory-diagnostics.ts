import "server-only";

import { performance } from "node:perf_hooks";

const BYTES_PER_MIB = 1024 * 1024;

export type MemoryOperationKind = "upload" | "imageTransform" | "s3Operation";

export type MemoryDiagnosticEvent =
  | "memory.startup"
  | "memory.upload.before"
  | "memory.upload.after"
  | "memory.image.before"
  | "memory.image.after"
  | "memory.storage.before"
  | "memory.storage.after";

export type MemoryDiagnosticCounters = Readonly<{
  activeUploads: number;
  activeImageTransforms: number;
  activeS3Operations: number;
}>;

export type MemoryDiagnosticSnapshot = MemoryDiagnosticCounters & Readonly<{
  event: MemoryDiagnosticEvent;
  rssMiB: number;
  heapTotalMiB: number;
  heapUsedMiB: number;
  externalMiB: number;
  arrayBuffersMiB: number;
  outcome?: "completed" | "failed";
  durationMs?: number;
}>;

type MemoryDiagnosticsEnvironment = Readonly<{
  [name: string]: string | undefined;
  MEMORY_DIAGNOSTICS_ENABLED?: string;
}>;

type MemoryUsageReader = () => Pick<
  NodeJS.MemoryUsage,
  "rss" | "heapTotal" | "heapUsed" | "external" | "arrayBuffers"
>;

type MemoryDiagnosticLogger = (snapshot: MemoryDiagnosticSnapshot) => void;

type MemoryDiagnosticsOptions = Readonly<{
  environment?: MemoryDiagnosticsEnvironment;
  readMemoryUsage?: MemoryUsageReader;
  logger?: MemoryDiagnosticLogger;
  now?: () => number;
}>;

export type MemoryDiagnostics = Readonly<{
  enabled: boolean;
  captureSnapshot: (
    event: MemoryDiagnosticEvent,
    details?: Readonly<{
      outcome?: "completed" | "failed";
      durationMs?: number;
    }>,
  ) => MemoryDiagnosticSnapshot | null;
  counters: () => MemoryDiagnosticCounters;
  withOperation: <T>(
    kind: MemoryOperationKind,
    operation: () => T | Promise<T>,
  ) => Promise<T>;
  withCounter: <T>(
    kind: MemoryOperationKind,
    operation: () => T | Promise<T>,
  ) => Promise<T>;
}>;

const counterKeyByOperation = {
  upload: "activeUploads",
  imageTransform: "activeImageTransforms",
  s3Operation: "activeS3Operations",
} as const satisfies Record<MemoryOperationKind, keyof MemoryDiagnosticCounters>;

const eventsByOperation = {
  upload: ["memory.upload.before", "memory.upload.after"],
  imageTransform: ["memory.image.before", "memory.image.after"],
  s3Operation: ["memory.storage.before", "memory.storage.after"],
} as const satisfies Record<
  MemoryOperationKind,
  readonly [MemoryDiagnosticEvent, MemoryDiagnosticEvent]
>;

export function memoryDiagnosticsEnabled(
  environment: MemoryDiagnosticsEnvironment = process.env,
) {
  return environment.MEMORY_DIAGNOSTICS_ENABLED === "true";
}

function toMiB(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  return Math.round((bytes / BYTES_PER_MIB) * 10) / 10;
}

function finiteDuration(value: number | undefined) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 1_000) / 1_000;
}

function logToConsole(snapshot: MemoryDiagnosticSnapshot) {
  console.info(JSON.stringify(snapshot));
}

/**
 * Creates bounded, event-driven process memory diagnostics. The API deliberately
 * accepts no free-form context so request payloads, identifiers and credentials
 * cannot be attached to its logs. It owns only three numeric active-operation
 * counters and never retains snapshots.
 */
export function createMemoryDiagnostics(
  options: MemoryDiagnosticsOptions = {},
): MemoryDiagnostics {
  const enabled = memoryDiagnosticsEnabled(options.environment);
  const readMemoryUsage = options.readMemoryUsage ?? process.memoryUsage;
  const logger = options.logger ?? logToConsole;
  const now = options.now ?? performance.now.bind(performance);
  const activeCounters = {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  };

  const counters = (): MemoryDiagnosticCounters => ({ ...activeCounters });

  const captureSnapshot: MemoryDiagnostics["captureSnapshot"] = (event, details = {}) => {
    if (!enabled) return null;

    try {
      const memory = readMemoryUsage();
      const rssMiB = toMiB(memory.rss);
      const heapTotalMiB = toMiB(memory.heapTotal);
      const heapUsedMiB = toMiB(memory.heapUsed);
      const externalMiB = toMiB(memory.external);
      const arrayBuffersMiB = toMiB(memory.arrayBuffers);
      if (
        rssMiB === null
        || heapTotalMiB === null
        || heapUsedMiB === null
        || externalMiB === null
        || arrayBuffersMiB === null
      ) return null;

      const durationMs = finiteDuration(details.durationMs);
      const snapshot: MemoryDiagnosticSnapshot = {
        event,
        rssMiB,
        heapTotalMiB,
        heapUsedMiB,
        externalMiB,
        arrayBuffersMiB,
        ...counters(),
        ...(details.outcome ? { outcome: details.outcome } : {}),
        ...(durationMs === undefined ? {} : { durationMs }),
      };

      try {
        logger(snapshot);
      } catch {
        // Diagnostics are auxiliary and must never affect the business workflow.
      }
      return snapshot;
    } catch {
      return null;
    }
  };

  const runOperation = async <T>(
    kind: MemoryOperationKind,
    operation: () => T | Promise<T>,
    captureEvents: boolean,
  ): Promise<T> => {
    if (!enabled) return await operation();

    const counterKey = counterKeyByOperation[kind];
    activeCounters[counterKey] = Math.min(
      Number.MAX_SAFE_INTEGER,
      activeCounters[counterKey] + 1,
    );
    const [beforeEvent, afterEvent] = eventsByOperation[kind];
    let startedAt: number | null = null;
    let outcome: "completed" | "failed" = "failed";
    try {
      if (captureEvents) {
        try {
          const value = now();
          startedAt = Number.isFinite(value) ? value : null;
        } catch {
          startedAt = null;
        }
        captureSnapshot(beforeEvent);
      }
      const result = await operation();
      outcome = "completed";
      return result;
    } finally {
      activeCounters[counterKey] = Math.max(0, activeCounters[counterKey] - 1);
      if (captureEvents) {
        let durationMs: number | undefined;
        try {
          durationMs = startedAt === null ? undefined : now() - startedAt;
        } catch {
          durationMs = undefined;
        }
        captureSnapshot(afterEvent, { outcome, durationMs });
      }
    }
  };

  const withOperation: MemoryDiagnostics["withOperation"] = (kind, operation) => (
    runOperation(kind, operation, true)
  );
  const withCounter: MemoryDiagnostics["withCounter"] = (kind, operation) => (
    runOperation(kind, operation, false)
  );

  return Object.freeze({ enabled, captureSnapshot, counters, withOperation, withCounter });
}

const processMemoryDiagnostics = createMemoryDiagnostics();

export const captureMemorySnapshot = processMemoryDiagnostics.captureSnapshot;
export const getMemoryDiagnosticCounters = processMemoryDiagnostics.counters;
export const withMemoryDiagnosticOperation = processMemoryDiagnostics.withOperation;
export const withMemoryDiagnosticCounter = processMemoryDiagnostics.withCounter;
