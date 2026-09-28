"use strict";

/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preload. */

/*
 * Temporary, opt-in Railway/Linux memory probe.
 *
 * Load with Node's --require flag. It exposes no HTTP route, never reads the
 * environment as data, never records process arguments or SQL, and stops
 * automatically. The exact opt-in value prevents an existing diagnostic flag
 * from enabling this probe accidentally.
 */

(() => {
  const OPT_IN_VALUE = "observe-v1";
  if (process.env.RAILWAY_LINUX_MEMORY_DIAGNOSTICS !== OPT_IN_VALUE) return;

  const fs = require("node:fs");
  const path = require("node:path");
  const Module = require("node:module");

  const LOG_PREFIX = "[railway-linux-memory] ";
  const DIAGNOSTIC_SYMBOL = Symbol.for("lnxbeats.railway-linux-memory.v1");
  const STATUS_KEYS = Object.freeze([
    "VmPeak",
    "VmSize",
    "VmRSS",
    "RssAnon",
    "RssFile",
    "RssShmem",
    "VmData",
    "VmStk",
    "VmExe",
    "VmLib",
    "VmPTE",
    "VmSwap",
    "Threads",
  ]);
  const HEAVY_MODULES = Object.freeze([
    "pdfkit",
    "crypto-js",
    "jpeg-exif",
    "ffmpeg-static",
    "sharp",
  ]);
  const CGROUP_FILES = Object.freeze({
    current: "/sys/fs/cgroup/memory.current",
    stat: "/sys/fs/cgroup/memory.stat",
    events: "/sys/fs/cgroup/memory.events",
    max: "/sys/fs/cgroup/memory.max",
  });

  const testMode = process.env.NODE_ENV === "test"
    && process.env.RAILWAY_LINUX_MEMORY_DIAGNOSTICS_TEST_MODE === "true";
  const requestedDurationMinutes = Number(
    process.env.RAILWAY_LINUX_MEMORY_DIAGNOSTICS_DURATION_MINUTES ?? "30",
  );
  const durationMinutes = Number.isFinite(requestedDurationMinutes)
    ? Math.min(60, Math.max(30, Math.trunc(requestedDurationMinutes)))
    : 30;
  const warmupMs = testMode ? 25 : 60_000;
  const intervalMs = testMode ? 50 : 5 * 60_000;
  const durationMs = testMode ? 180 : durationMinutes * 60_000;

  const loadedHeavyModules = new Set();
  const trackedPoolObjects = new WeakSet();
  const trackedPoolReferences = new Set();
  const trackedPrismaObjects = new WeakSet();
  const trackedPrismaReferences = new Set();
  const pgRestorers = [];
  let prismaInstancesCreated = 0;
  let stopped = false;

  function safeLog(payload) {
    try {
      console.info(`${LOG_PREFIX}${JSON.stringify(payload)}`);
    } catch {
      // Diagnostics must never affect the application process.
    }
  }

  function safeRead(filePath) {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  }

  function parseStatus(status) {
    if (typeof status !== "string") return null;
    const result = {};
    for (const key of STATUS_KEYS) {
      const value = status.match(new RegExp(`^${key}:\\s+(.+)$`, "m"))?.[1] ?? null;
      result[key] = value;
    }
    return result;
  }

  function parseNumericMap(content) {
    if (typeof content !== "string") return null;
    const result = {};
    for (const line of content.trim().split("\n")) {
      const match = line.match(/^([A-Za-z0-9_.-]+)\s+([0-9]+)$/);
      if (match) result[match[1]] = match[2];
    }
    return result;
  }

  function readLinuxStatus() {
    if (process.platform !== "linux") return null;
    return parseStatus(safeRead("/proc/self/status"));
  }

  function readCgroupMemory() {
    if (process.platform !== "linux") return null;
    const current = safeRead(CGROUP_FILES.current)?.trim() ?? null;
    const maximum = safeRead(CGROUP_FILES.max)?.trim() ?? null;
    const stat = parseNumericMap(safeRead(CGROUP_FILES.stat));
    const events = parseNumericMap(safeRead(CGROUP_FILES.events));
    if (current === null && maximum === null && stat === null && events === null) return null;
    return { current, max: maximum, stat, events };
  }

  function readContainerProcesses() {
    if (process.platform !== "linux") {
      return [{
        pid: process.pid,
        ppid: process.ppid,
        comm: path.basename(process.execPath),
        rssKiB: Math.round(process.memoryUsage().rss / 1024),
      }];
    }

    let entries;
    try {
      entries = fs.readdirSync("/proc", { withFileTypes: true });
    } catch {
      return [];
    }

    const processes = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const status = safeRead(`/proc/${entry.name}/status`);
      if (status === null) continue;
      const name = status.match(/^Name:\s+(.+)$/m)?.[1]?.trim() ?? "unknown";
      const ppid = Number(status.match(/^PPid:\s+(\d+)$/m)?.[1] ?? 0);
      const rssKiB = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] ?? 0);
      processes.push({ pid: Number(entry.name), ppid, comm: name, rssKiB });
    }
    return processes.sort((left, right) => left.pid - right.pid);
  }

  function packageName(request) {
    if (typeof request !== "string") return null;
    if (request.startsWith("@")) return request.split("/").slice(0, 2).join("/");
    return request.split("/")[0];
  }

  function scanRequireCache() {
    const cachedPaths = Object.keys(require.cache);
    for (const moduleName of HEAVY_MODULES) {
      const segment = `${path.sep}node_modules${path.sep}${moduleName}${path.sep}`;
      if (cachedPaths.some((cachedPath) => cachedPath.includes(segment))) {
        loadedHeavyModules.add(moduleName);
      }
    }
  }

  function trackPool(pool) {
    if (!pool || typeof pool !== "object" || trackedPoolObjects.has(pool)) return;
    trackedPoolObjects.add(pool);
    trackedPoolReferences.add(new WeakRef(pool));
  }

  function instrumentPg(pg) {
    const Pool = pg?.Pool;
    if (!Pool?.prototype) return;
    const patchSymbol = Symbol.for("lnxbeats.railway-linux-memory.pg-patched.v1");
    if (Pool.prototype[patchSymbol]) return;

    Object.defineProperty(Pool.prototype, patchSymbol, {
      configurable: true,
      value: true,
    });

    for (const methodName of ["connect", "query"]) {
      const original = Pool.prototype[methodName];
      if (typeof original !== "function") continue;
      const wrapped = function railwayMemoryTrackedPoolMethod(...args) {
        trackPool(this);
        return original.apply(this, args);
      };
      Pool.prototype[methodName] = wrapped;
      pgRestorers.push(() => {
        if (Pool.prototype[methodName] === wrapped) Pool.prototype[methodName] = original;
      });
    }

    pgRestorers.push(() => {
      try {
        delete Pool.prototype[patchSymbol];
      } catch {
        // A non-configurable third-party prototype must not break shutdown.
      }
    });
  }

  function compactWeakReferences(references) {
    const values = [];
    for (const reference of references) {
      const value = reference.deref();
      if (value) values.push(value);
      else references.delete(reference);
    }
    return values;
  }

  function poolSnapshot() {
    const pools = compactWeakReferences(trackedPoolReferences);
    return {
      instancesObserved: pools.length,
      totalCount: pools.reduce((total, pool) => total + Number(pool.totalCount ?? 0), 0),
      idleCount: pools.reduce((total, pool) => total + Number(pool.idleCount ?? 0), 0),
      waitingCount: pools.reduce((total, pool) => total + Number(pool.waitingCount ?? 0), 0),
    };
  }

  function prismaSnapshot() {
    return {
      instancesCreated: prismaInstancesCreated,
      instancesAlive: compactWeakReferences(trackedPrismaReferences).length,
    };
  }

  function registerPrismaClient(client) {
    if (!client || typeof client !== "object" || trackedPrismaObjects.has(client)) return;
    trackedPrismaObjects.add(client);
    trackedPrismaReferences.add(new WeakRef(client));
    prismaInstancesCreated += 1;
  }

  function countsByConstructor(values) {
    const result = {};
    for (const value of values) {
      const name = value?.constructor?.name ?? "Unknown";
      result[name] = (result[name] ?? 0) + 1;
    }
    return result;
  }

  function loadedModuleSnapshot() {
    scanRequireCache();
    return Object.fromEntries(
      HEAVY_MODULES.map((moduleName) => [moduleName, loadedHeavyModules.has(moduleName)]),
    );
  }

  function captureSnapshot(reason) {
    if (stopped) return;
    try {
      const memory = process.memoryUsage();
      safeLog({
        event: "railway.linux_memory.snapshot",
        schemaVersion: 1,
        reason,
        timestamp: new Date().toISOString(),
        process: {
          pid: process.pid,
          ppid: process.ppid,
          platform: process.platform,
          arch: process.arch,
          version: process.version,
          uptimeSeconds: Math.round(process.uptime() * 1_000) / 1_000,
        },
        memoryBytes: {
          rss: memory.rss,
          heapTotal: memory.heapTotal,
          heapUsed: memory.heapUsed,
          external: memory.external,
          arrayBuffers: memory.arrayBuffers,
        },
        linuxProcStatus: readLinuxStatus(),
        cgroupMemory: readCgroupMemory(),
        containerProcesses: readContainerProcesses(),
        database: {
          prisma: prismaSnapshot(),
          pgPools: poolSnapshot(),
        },
        loadedHeavyModules: loadedModuleSnapshot(),
        activeHandlesByType: countsByConstructor(process._getActiveHandles()),
        activeRequestsByType: countsByConstructor(process._getActiveRequests()),
      });
    } catch {
      safeLog({
        event: "railway.linux_memory.snapshot_failed",
        reason,
        timestamp: new Date().toISOString(),
      });
    }
  }

  const originalModuleLoad = Module._load;
  function diagnosticModuleLoad(request, parent, isMain) {
    const result = originalModuleLoad.call(this, request, parent, isMain);
    const name = packageName(request);
    if (HEAVY_MODULES.includes(name)) loadedHeavyModules.add(name);
    if (name === "pg") instrumentPg(result);
    return result;
  }
  Module._load = diagnosticModuleLoad;

  const diagnosticsHook = Object.freeze({ registerPrismaClient });
  globalThis[DIAGNOSTIC_SYMBOL] = diagnosticsHook;

  const warningListener = (warning) => {
    if (!/client\.query\(\).*already executing a query/i.test(String(warning?.message ?? ""))) {
      return;
    }
    safeLog({
      event: "railway.pg.client_query_while_busy",
      name: String(warning.name ?? "Warning"),
      code: typeof warning.code === "string" ? warning.code : null,
      stack: String(warning.stack ?? "")
        .split("\n")
        .slice(0, 20)
        .map((line) => line.trim())
        .filter(Boolean),
    });
  };
  process.on("warning", warningListener);

  let intervalTimer;
  let warmupTimer;
  let stopTimer;

  function stopProbe() {
    if (stopped) return;
    stopped = true;
    if (intervalTimer) clearInterval(intervalTimer);
    if (warmupTimer) clearTimeout(warmupTimer);
    if (stopTimer) clearTimeout(stopTimer);
    if (Module._load === diagnosticModuleLoad) Module._load = originalModuleLoad;
    for (const restore of pgRestorers.reverse()) {
      try {
        restore();
      } catch {
        // Best-effort diagnostic teardown only.
      }
    }
    if (globalThis[DIAGNOSTIC_SYMBOL] === diagnosticsHook) {
      delete globalThis[DIAGNOSTIC_SYMBOL];
    }
    process.off("warning", warningListener);
    trackedPoolReferences.clear();
    trackedPrismaReferences.clear();
    safeLog({
      event: "railway.linux_memory.stopped",
      timestamp: new Date().toISOString(),
      elapsedSeconds: Math.round(process.uptime() * 1_000) / 1_000,
    });
  }

  captureSnapshot("startup");
  warmupTimer = setTimeout(() => captureSnapshot("warmup"), warmupMs);
  warmupTimer.unref();
  intervalTimer = setInterval(() => captureSnapshot("interval"), intervalMs);
  intervalTimer.unref();
  stopTimer = setTimeout(stopProbe, durationMs);
  stopTimer.unref();
})();
