import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inspect } from "node:util";
import test from "node:test";

import {
  createMemoryDiagnostics,
  memoryDiagnosticsEnabled,
  type MemoryDiagnosticSnapshot,
} from "@/lib/memory-diagnostics";

const MIB = 1024 * 1024;

function fixedMemoryUsage() {
  return {
    rss: 128 * MIB,
    heapTotal: 64 * MIB,
    heapUsed: 32.5 * MIB,
    external: 8.25 * MIB,
    arrayBuffers: 4.125 * MIB,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

test("memory diagnostics use a strict opt-in and remain disabled by default", () => {
  assert.equal(memoryDiagnosticsEnabled({}), false);
  assert.equal(memoryDiagnosticsEnabled({ MEMORY_DIAGNOSTICS_ENABLED: "false" }), false);
  assert.equal(memoryDiagnosticsEnabled({ MEMORY_DIAGNOSTICS_ENABLED: "TRUE" }), false);
  assert.equal(memoryDiagnosticsEnabled({ MEMORY_DIAGNOSTICS_ENABLED: "1" }), false);
  assert.equal(memoryDiagnosticsEnabled({ MEMORY_DIAGNOSTICS_ENABLED: "true" }), true);
});

test("disabled diagnostics read no memory, emit no log and add no active state", async () => {
  let reads = 0;
  let logs = 0;
  const diagnostics = createMemoryDiagnostics({
    environment: {},
    readMemoryUsage() { reads += 1; return fixedMemoryUsage(); },
    logger() { logs += 1; },
  });

  assert.equal(diagnostics.captureSnapshot("memory.startup"), null);
  assert.equal(await diagnostics.withOperation("upload", () => "business-result"), "business-result");
  assert.equal(reads, 0);
  assert.equal(logs, 0);
  assert.deepEqual(diagnostics.counters(), {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  });
});

test("enabled diagnostics expose compact finite MiB metrics with stable fields", async () => {
  const snapshots: MemoryDiagnosticSnapshot[] = [];
  const times = [10, 12.3456];
  const diagnostics = createMemoryDiagnostics({
    environment: { MEMORY_DIAGNOSTICS_ENABLED: "true" },
    readMemoryUsage: fixedMemoryUsage,
    logger(snapshot) { snapshots.push(snapshot); },
    now() { return times.shift() ?? 12.3456; },
  });

  assert.equal(await diagnostics.withOperation("s3Operation", () => "stored"), "stored");
  assert.deepEqual(snapshots, [
    {
      event: "memory.storage.before",
      rssMiB: 128,
      heapTotalMiB: 64,
      heapUsedMiB: 32.5,
      externalMiB: 8.3,
      arrayBuffersMiB: 4.1,
      activeUploads: 0,
      activeImageTransforms: 0,
      activeS3Operations: 1,
    },
    {
      event: "memory.storage.after",
      rssMiB: 128,
      heapTotalMiB: 64,
      heapUsedMiB: 32.5,
      externalMiB: 8.3,
      arrayBuffersMiB: 4.1,
      activeUploads: 0,
      activeImageTransforms: 0,
      activeS3Operations: 0,
      outcome: "completed",
      durationMs: 2.346,
    },
  ]);
  for (const snapshot of snapshots) {
    for (const value of Object.values(snapshot)) {
      if (typeof value === "number") assert.equal(Number.isFinite(value), true);
    }
  }
});

test("the fixed diagnostic schema cannot serialize environment secrets or PII", () => {
  const sentinel = "PRIVATE_EMAIL_TOKEN_ADDRESS_AND_SIGNED_URL";
  const logs: string[] = [];
  const environment = {
    MEMORY_DIAGNOSTICS_ENABLED: "true",
    DATABASE_URL: sentinel,
    AUTH_SECRET: sentinel,
    USER_EMAIL: sentinel,
  };
  const diagnostics = createMemoryDiagnostics({
    environment,
    readMemoryUsage: fixedMemoryUsage,
    logger(snapshot) { logs.push(JSON.stringify(snapshot)); },
  });

  diagnostics.captureSnapshot("memory.startup");
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], new RegExp(sentinel));
  assert.deepEqual(Object.keys(JSON.parse(logs[0])).sort(), [
    "activeImageTransforms",
    "activeS3Operations",
    "activeUploads",
    "arrayBuffersMiB",
    "event",
    "externalMiB",
    "heapTotalMiB",
    "heapUsedMiB",
    "rssMiB",
  ]);
});

test("one thousand snapshots retain no history and leave counters at zero", () => {
  let logs = 0;
  const diagnostics = createMemoryDiagnostics({
    environment: { MEMORY_DIAGNOSTICS_ENABLED: "true" },
    readMemoryUsage: fixedMemoryUsage,
    logger() { logs += 1; },
  });

  for (let index = 0; index < 1_000; index += 1) {
    diagnostics.captureSnapshot("memory.startup");
  }

  assert.equal(logs, 1_000);
  assert.deepEqual(Object.keys(diagnostics).sort(), [
    "captureSnapshot",
    "counters",
    "enabled",
    "withCounter",
    "withOperation",
  ]);
  assert.deepEqual(diagnostics.counters(), {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  });
});

test("active counters track deterministic concurrency and all return to zero", async () => {
  const uploadGate = deferred();
  const transformGate = deferred();
  const s3Gate = deferred();
  const diagnostics = createMemoryDiagnostics({
    environment: { MEMORY_DIAGNOSTICS_ENABLED: "true" },
    readMemoryUsage: fixedMemoryUsage,
    logger() {},
  });

  const operations = [
    diagnostics.withOperation("upload", async () => { await uploadGate.promise; }),
    diagnostics.withOperation("imageTransform", async () => { await transformGate.promise; }),
    diagnostics.withOperation("s3Operation", async () => { await s3Gate.promise; }),
  ];
  assert.deepEqual(diagnostics.counters(), {
    activeUploads: 1,
    activeImageTransforms: 1,
    activeS3Operations: 1,
  });

  uploadGate.resolve();
  transformGate.resolve();
  s3Gate.resolve();
  await Promise.all(operations);
  assert.deepEqual(diagnostics.counters(), {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  });
});

test("a maximum upload can count every transform while emitting only request-level logs", async () => {
  let logs = 0;
  const diagnostics = createMemoryDiagnostics({
    environment: { MEMORY_DIAGNOSTICS_ENABLED: "true" },
    readMemoryUsage: fixedMemoryUsage,
    logger() { logs += 1; },
  });

  await diagnostics.withOperation("upload", async () => {
    for (let index = 0; index < 10; index += 1) {
      await diagnostics.withCounter("imageTransform", () => index);
    }
  });

  assert.equal(logs, 2);
  assert.deepEqual(diagnostics.counters(), {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  });
});

test("failed upload, image and S3 operations keep their error while counters return to zero", async () => {
  const sentinel = new Error("synthetic operation failure");
  const snapshots: MemoryDiagnosticSnapshot[] = [];
  const diagnostics = createMemoryDiagnostics({
    environment: { MEMORY_DIAGNOSTICS_ENABLED: "true" },
    readMemoryUsage: fixedMemoryUsage,
    logger(snapshot) { snapshots.push(snapshot); },
    now: () => 42,
  });

  for (const kind of ["upload", "imageTransform", "s3Operation"] as const) {
    await assert.rejects(
      diagnostics.withOperation(kind, () => { throw sentinel; }),
      (error) => error === sentinel,
    );
  }
  assert.equal(snapshots.at(-1)?.outcome, "failed");
  assert.equal(snapshots.length, 6);
  assert.deepEqual(diagnostics.counters(), {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  });
});

test("logger and memory-reader failures never break the wrapped workflow", async () => {
  const loggerFailure = createMemoryDiagnostics({
    environment: { MEMORY_DIAGNOSTICS_ENABLED: "true" },
    readMemoryUsage: fixedMemoryUsage,
    logger() { throw new Error("logger unavailable"); },
  });
  assert.equal(
    await loggerFailure.withOperation("upload", () => "still-completed"),
    "still-completed",
  );
  assert.deepEqual(loggerFailure.counters(), {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  });

  const readerFailure = createMemoryDiagnostics({
    environment: { MEMORY_DIAGNOSTICS_ENABLED: "true" },
    readMemoryUsage() { throw new Error("memory reader unavailable"); },
    logger() { throw new Error("must not be reached"); },
  });
  assert.equal(await readerFailure.withOperation("s3Operation", () => 42), 42);
  assert.equal(readerFailure.captureSnapshot("memory.startup"), null);
  assert.deepEqual(readerFailure.counters(), {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  });
});

test("the implementation remains server-only, event-driven and history-free", async () => {
  const source = await readFile(
    new URL("../../lib/memory-diagnostics.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /^import "server-only";/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
  assert.doesNotMatch(source, /JSON\.stringify\(process\.env|Object\.(entries|keys|values)\(process\.env/);
  assert.doesNotMatch(source, /\.push\(|memorySamples|history/i);
  assert.doesNotMatch(inspect(createMemoryDiagnostics), /DATABASE_URL|AUTH_SECRET/);
});
