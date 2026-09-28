import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const preloadPath = fileURLToPath(
  new URL("../../scripts/diagnostics/railway-linux-memory-preload.cjs", import.meta.url),
);
const logPrefix = "[railway-linux-memory] ";

type DiagnosticEvent = Readonly<Record<string, unknown>>;

async function runProbe(
  optIn: string | undefined,
  code = "void 0",
) {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    RAILWAY_LINUX_MEMORY_DIAGNOSTICS_TEST_MODE: "true",
    DATABASE_URL: "PRIVATE_DATABASE_SENTINEL_MUST_NOT_APPEAR",
    AUTH_SECRET: "PRIVATE_AUTH_SENTINEL_MUST_NOT_APPEAR",
  };
  if (optIn !== undefined) environment.RAILWAY_LINUX_MEMORY_DIAGNOSTICS = optIn;

  return execFileAsync(
    process.execPath,
    ["--require", preloadPath, "-e", code],
    {
      cwd: repositoryRoot,
      env: environment,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 5_000,
    },
  );
}

function parseDiagnosticEvents(output: string) {
  return output
    .split("\n")
    .filter((line) => line.startsWith(logPrefix))
    .map((line) => JSON.parse(line.slice(logPrefix.length)) as DiagnosticEvent);
}

test("the Railway Linux probe is disabled unless the exact opt-in is present", async () => {
  for (const optIn of [undefined, "", "true", "observe", "OBSERVE-V1"]) {
    const { stdout, stderr } = await runProbe(optIn);
    assert.equal(parseDiagnosticEvents(stdout).length, 0);
    assert.equal(stderr, "");
  }
});

test("the enabled probe emits bounded sanitized snapshots and stops automatically", async () => {
  const childCode = `
    const hook = globalThis[Symbol.for("lnxbeats.railway-linux-memory.v1")];
    const client = {};
    hook.registerPrismaClient(client);
    hook.registerPrismaClient(client);
    const { Pool } = require("pg");
    const pool = new Pool({ host: "127.0.0.1", port: 1, connectionTimeoutMillis: 10 });
    pool.query("SELECT 1").catch(() => {});
    require("pdfkit");
    setTimeout(() => { pool.end().catch(() => {}); }, 100);
    setTimeout(() => {}, 240);
  `;
  const { stdout, stderr } = await runProbe("observe-v1", childCode);
  const events = parseDiagnosticEvents(stdout);
  const snapshots = events.filter((event) => event.event === "railway.linux_memory.snapshot");
  const startup = snapshots.find((event) => event.reason === "startup");
  const warmup = snapshots.find((event) => event.reason === "warmup");
  const stopped = events.find((event) => event.event === "railway.linux_memory.stopped");

  assert.ok(startup);
  assert.ok(warmup);
  assert.ok(stopped);
  assert.equal(stderr, "");
  assert.equal(JSON.stringify(events).includes("PRIVATE_DATABASE_SENTINEL_MUST_NOT_APPEAR"), false);
  assert.equal(JSON.stringify(events).includes("PRIVATE_AUTH_SENTINEL_MUST_NOT_APPEAR"), false);

  assert.deepEqual(Object.keys(startup.memoryBytes as object).sort(), [
    "arrayBuffers",
    "external",
    "heapTotal",
    "heapUsed",
    "rss",
  ]);
  assert.deepEqual(Object.keys(startup.process as object).sort(), [
    "arch",
    "pid",
    "platform",
    "ppid",
    "uptimeSeconds",
    "version",
  ]);
  assert.equal((warmup.loadedHeavyModules as Record<string, boolean>).pdfkit, true);
  assert.deepEqual((warmup.database as Record<string, unknown>).prisma, {
    instancesCreated: 1,
    instancesAlive: 1,
  });
  assert.equal(
    ((warmup.database as Record<string, unknown>).pgPools as Record<string, number>)
      .instancesObserved,
    1,
  );

  for (const processRow of startup.containerProcesses as Array<Record<string, unknown>>) {
    assert.deepEqual(Object.keys(processRow).sort(), ["comm", "pid", "ppid", "rssKiB"]);
  }
});

test("the probe source cannot enumerate environment values, command lines or request data", async () => {
  const source = await readFile(preloadPath, "utf8");

  assert.doesNotMatch(source, /Object\.(?:entries|keys|values)\(process\.env/);
  assert.doesNotMatch(source, /JSON\.stringify\(process\.env/);
  assert.doesNotMatch(source, /process\.argv|\/proc\/[^"'`]*cmdline/);
  assert.doesNotMatch(source, /DATABASE_URL|AUTH_SECRET|cookie|authorization/i);
  assert.doesNotMatch(source, /query\.text|args\[0\]/);
  assert.doesNotMatch(source, /route\.ts|NextRequest|NextResponse/);
  assert.match(source, /intervalMs = testMode \? 50 : 5 \* 60_000/);
  assert.match(source, /Math\.min\(60, Math\.max\(30/);
  assert.match(source, /clearInterval\(intervalTimer\)/);
  for (const key of [
    "VmPeak", "VmSize", "VmRSS", "RssAnon", "RssFile", "RssShmem",
    "VmData", "VmStk", "VmExe", "VmLib", "VmPTE", "VmSwap", "Threads",
  ]) {
    assert.match(source, new RegExp(`"${key}"`));
  }
  for (const file of ["memory.current", "memory.stat", "memory.events", "memory.max"]) {
    assert.match(source, new RegExp(`/sys/fs/cgroup/${file.replace(".", "\\.")}`));
  }
});

test("Prisma registration is optional and cannot break client initialization", async () => {
  const source = await readFile(
    new URL("../../lib/prisma.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /new PrismaClient\(\{ adapter \}\)/);
  assert.match(source, /registerPrismaClientForRailwayMemoryDiagnostic\(client\)/);
  assert.match(source, /diagnosticHook\?\.registerPrismaClient\?\.\(client\)/);
  assert.match(source, /catch \{/);
});
