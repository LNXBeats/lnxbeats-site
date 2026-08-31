import assert from "node:assert/strict";
import { rename, rm, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setImmediate as waitForImmediate, setTimeout as wait } from "node:timers/promises";

import { S3Client } from "@aws-sdk/client-s3";

const REPORT_PATH = "/private/tmp/lnxbeats-memory-hardening-report.json";
const FACTORY_LOOKUPS = 1_000;
const MOCK_STORAGE_OPERATIONS = 100;
const HEALTH_CALLS = 500;
const DEFAULT_UPLOAD_CYCLES = 8;
const SHORT_UPLOAD_CYCLES = 5;
const MIN_UPLOAD_CYCLES = 5;
const MAX_UPLOAD_CYCLES = 20;
const MEMORY_SAMPLE_INTERVAL_MS = 10;
const DEFAULT_IDLE_MS = 1_500;
const SHORT_IDLE_MS = 500;
const DEFAULT_RUNTIME_LIMIT_MS = 115_000;
const BYTES_PER_MIB = 1024 * 1024;

type MemorySample = Readonly<{
  rss: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}>;

type DiagnosticCounters = Readonly<{
  activeUploads: number;
  activeImageTransforms: number;
  activeS3Operations: number;
}>;

type BenchmarkOptions = Readonly<{
  profile: "default" | "short" | "custom";
  uploadCycles: number;
  idleMs: number;
}>;

const round = (value: number, digits = 3) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

function memorySample(): MemorySample {
  const value = process.memoryUsage();
  return {
    rss: round(value.rss / BYTES_PER_MIB, 1),
    heapUsed: round(value.heapUsed / BYTES_PER_MIB, 1),
    external: round(value.external / BYTES_PER_MIB, 1),
    arrayBuffers: round(value.arrayBuffers / BYTES_PER_MIB, 1),
  };
}

function memoryDelta(after: MemorySample, before: MemorySample): MemorySample {
  return {
    rss: round(after.rss - before.rss, 1),
    heapUsed: round(after.heapUsed - before.heapUsed, 1),
    external: round(after.external - before.external, 1),
    arrayBuffers: round(after.arrayBuffers - before.arrayBuffers, 1),
  };
}

function durationSummary(values: readonly number[]) {
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

function parseOptions(arguments_: readonly string[]): BenchmarkOptions {
  let profile: BenchmarkOptions["profile"] = "default";
  let uploadCycles = DEFAULT_UPLOAD_CYCLES;
  let idleMs = DEFAULT_IDLE_MS;

  for (const argument of arguments_) {
    if (argument === "--short") {
      profile = "short";
      uploadCycles = SHORT_UPLOAD_CYCLES;
      idleMs = SHORT_IDLE_MS;
      continue;
    }
    if (argument.startsWith("--cycles=")) {
      const value = Number(argument.slice("--cycles=".length));
      if (!Number.isSafeInteger(value) || value < MIN_UPLOAD_CYCLES || value > MAX_UPLOAD_CYCLES) {
        throw new Error(`--cycles must be an integer between ${MIN_UPLOAD_CYCLES} and ${MAX_UPLOAD_CYCLES}.`);
      }
      profile = "custom";
      uploadCycles = value;
      continue;
    }
    throw new Error(`Unknown benchmark option: ${argument}`);
  }

  return { profile, uploadCycles, idleMs };
}

const isolatedEnvironmentPattern = /^(?:NODE_ENV$|MEMORY_DIAGNOSTICS_ENABLED$|MEDIA_|PAYMENTS?(?:_|$)|STRIPE_|PAYPAL_|LIVE_REFUNDS_|NOTIFICATION_|EMAIL_|SMS_|RESEND_|SHOP_|MUSIC_PRICING_|RAILWAY_)/;

function installIsolatedEnvironment() {
  const names = new Set([
    ...Object.keys(process.env).filter((name) => isolatedEnvironmentPattern.test(name)),
    "NODE_ENV",
    "MEMORY_DIAGNOSTICS_ENABLED",
  ]);
  const previous = new Map([...names].map((name) => [name, process.env[name]]));
  for (const name of names) Reflect.deleteProperty(process.env, name);

  Object.assign(process.env, {
    NODE_ENV: "test",
    MEMORY_DIAGNOSTICS_ENABLED: "true",
    MEDIA_STORAGE_DRIVER: "s3",
    MEDIA_DEPLOYMENT_ENV: "test",
    MEDIA_STORAGE_PROVIDER: "minio",
    MEDIA_S3_ENDPOINT: "https://storage.invalid",
    MEDIA_S3_REGION: "us-east-1",
    MEDIA_S3_ACCESS_KEY_ID: "benchmark-access-fixture",
    MEDIA_S3_SECRET_ACCESS_KEY: "benchmark-secret-fixture",
    MEDIA_PUBLIC_BUCKET: "benchmark-public-test",
    MEDIA_PRIVATE_BUCKET: "benchmark-private-test",
    MEDIA_S3_FORCE_PATH_STYLE: "true",
    PAYMENTS_ENABLED: "false",
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
    PAYMENT_DEPLOYMENT_ENV: "development",
    LIVE_REFUNDS_ENABLED: "false",
    NOTIFICATION_DEPLOYMENT_ENV: "development",
    NOTIFICATION_EMAIL_TRANSPORT: "disabled",
    EMAIL_NOTIFICATIONS_ENABLED: "false",
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "false",
    CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
    SMS_TRANSPORT: "disabled",
    SMS_NOTIFICATIONS_ENABLED: "false",
    NOTIFICATION_WORKER_ENABLED: "false",
    SHOP_ENABLED: "false",
    MUSIC_PRICING_SOURCE: "legacy",
  });

  return () => {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  };
}

function startMemoryTracker(startup: MemorySample) {
  let samples = 1;
  let peak = { ...startup };
  const capture = () => {
    const current = memorySample();
    samples += 1;
    peak = {
      rss: Math.max(peak.rss, current.rss),
      heapUsed: Math.max(peak.heapUsed, current.heapUsed),
      external: Math.max(peak.external, current.external),
      arrayBuffers: Math.max(peak.arrayBuffers, current.arrayBuffers),
    };
    return current;
  };
  const timer = setInterval(capture, MEMORY_SAMPLE_INTERVAL_MS);
  timer.unref();
  return {
    capture,
    finish: () => {
      clearInterval(timer);
      capture();
      return { peak: { ...peak }, samples } as const;
    },
  };
}

function updatePeakCounters(target: { activeUploads: number; activeImageTransforms: number; activeS3Operations: number }, counters: DiagnosticCounters) {
  target.activeUploads = Math.max(target.activeUploads, counters.activeUploads);
  target.activeImageTransforms = Math.max(target.activeImageTransforms, counters.activeImageTransforms);
  target.activeS3Operations = Math.max(target.activeS3Operations, counters.activeS3Operations);
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const startedAt = performance.now();
  const restoreEnvironment = installIsolatedEnvironment();
  const originalConsoleInfo = console.info;
  const diagnosticEvents: Record<string, number> = {};
  const diagnosticPeakCounters = {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  };
  let diagnosticRecords = 0;
  let diagnosticSchemaViolations = 0;
  let watchdog: NodeJS.Timeout | undefined;
  let temporaryReportPath: string | null = null;

  console.info = (...values: unknown[]) => {
    if (values.length !== 1 || typeof values[0] !== "string") {
      diagnosticSchemaViolations += 1;
      return;
    }
    try {
      const parsed = JSON.parse(values[0]) as Record<string, unknown>;
      if (typeof parsed.event !== "string" || !parsed.event.startsWith("memory.")) {
        diagnosticSchemaViolations += 1;
        return;
      }
      const allowedKeys = new Set([
        "event",
        "rssMiB",
        "heapTotalMiB",
        "heapUsedMiB",
        "externalMiB",
        "arrayBuffersMiB",
        "activeUploads",
        "activeImageTransforms",
        "activeS3Operations",
        "outcome",
        "durationMs",
      ]);
      if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) diagnosticSchemaViolations += 1;
      const counters = {
        activeUploads: Number(parsed.activeUploads),
        activeImageTransforms: Number(parsed.activeImageTransforms),
        activeS3Operations: Number(parsed.activeS3Operations),
      };
      if (Object.values(counters).some((value) => !Number.isSafeInteger(value) || value < 0)) {
        diagnosticSchemaViolations += 1;
      } else {
        updatePeakCounters(diagnosticPeakCounters, counters);
      }
      diagnosticEvents[parsed.event] = (diagnosticEvents[parsed.event] ?? 0) + 1;
      diagnosticRecords += 1;
    } catch {
      diagnosticSchemaViolations += 1;
    }
  };

  try {
    watchdog = setTimeout(() => {
      process.stderr.write(`Memory hardening benchmark exceeded ${DEFAULT_RUNTIME_LIMIT_MS} ms.\n`);
      process.exit(124);
    }, DEFAULT_RUNTIME_LIMIT_MS);
    watchdog.unref();

    const [
      sharpModule,
      healthModule,
      storageConfigurationModule,
      s3StorageModule,
      uploadModule,
      diagnosticsModule,
      orderOfferModule,
    ] = await Promise.all([
      import("sharp"),
      import("@/lib/health"),
      import("@/lib/media/storage/config"),
      import("@/lib/media/storage/s3"),
      import("@/lib/orders/upload"),
      import("@/lib/memory-diagnostics"),
      import("@/data/order-offer"),
    ]);

    const sharp = sharpModule.default;
    const { healthResponse } = healthModule;
    const {
      activeMediaStorage,
      resetMediaStorageCacheForTests,
    } = storageConfigurationModule;
    const { S3MediaStorage, setS3ClientFactoryForTests } = s3StorageModule;
    const {
      getOrderPhotoTransformState,
      normalizeOrderImage,
      ORDER_PHOTO_TRANSFORM_CONCURRENCY,
      ORDER_PHOTO_TRANSFORM_QUEUE_LIMIT,
      processOrderImageBatch,
    } = uploadModule;
    const {
      getMemoryDiagnosticCounters,
      withMemoryDiagnosticOperation,
    } = diagnosticsModule;
    const { orderOffer } = orderOfferModule;

    const startupMemory = memorySample();
    const memoryTracker = startMemoryTracker(startupMemory);

    const smallWidth = 96;
    const smallHeight = 64;
    const nearLimitWidth = orderOffer.maxImageWidth - 100;
    const nearLimitHeight = Math.floor((orderOffer.maxImagePixels - 1) / nearLimitWidth);
    const nearLimitPixels = nearLimitWidth * nearLimitHeight;
    assert.ok(nearLimitPixels <= orderOffer.maxImagePixels);
    assert.ok(nearLimitPixels >= orderOffer.maxImagePixels * 0.99);

    let smallFixture: Buffer | null = await sharp({
      create: { width: smallWidth, height: smallHeight, channels: 3, background: { r: 30, g: 60, b: 90 } },
    }).jpeg({ quality: 72, progressive: true }).toBuffer();
    let nearLimitFixture: Buffer | null = await sharp({
      create: {
        width: nearLimitWidth,
        height: nearLimitHeight,
        channels: 3,
        background: { r: 18, g: 36, b: 54 },
      },
    }).jpeg({ quality: 62, progressive: true }).toBuffer();
    const nearLimitMetadata = await sharp(nearLimitFixture).metadata();
    assert.equal(nearLimitMetadata.width, nearLimitWidth);
    assert.equal(nearLimitMetadata.height, nearLimitHeight);
    assert.equal(nearLimitMetadata.isProgressive, true);
    assert.ok(nearLimitFixture.length <= orderOffer.maxPhotoBytes);

    const warmupImage = await normalizeOrderImage({
      buffer: smallFixture,
      originalFilename: "warmup.jpg",
      declaredMimeType: "image/jpeg",
    });
    assert.deepEqual([warmupImage.width, warmupImage.height], [smallWidth, smallHeight]);
    const warmupMemory = memoryTracker.capture();

    let healthClientCreations = 0;
    resetMediaStorageCacheForTests();
    setS3ClientFactoryForTests(() => {
      healthClientCreations += 1;
      throw new Error("Health validation must not construct an S3 client.");
    });
    const healthLatencies: number[] = [];
    let healthyResponses = 0;
    let validHealthContracts = 0;
    const expectedHealthContract = {
      ok: true,
      service: "lnx-studio",
      mediaStorage: { backend: "OBJECT", provider: "minio" },
      payments: {
        enabled: false,
        deploymentEnvironment: "development",
        liveRefundsEnabled: false,
        providers: {
          stripe: {
            provider: "stripe",
            enabled: false,
            configured: false,
            mode: "disabled",
            apiVersion: "2026-07-29.dahlia",
          },
          paypal: {
            provider: "paypal",
            enabled: false,
            configured: false,
            environment: "disabled",
          },
        },
      },
      notifications: {
        emailTransport: "disabled",
        emailEnabled: false,
        ownerEmailEnabled: false,
        clientEmailEnabled: false,
        emailConfigured: false,
        smsTransport: "disabled",
        workerEnabled: false,
        workerConfigured: false,
        webhookConfigured: false,
      },
      shop: {
        enabled: false,
        pricingSource: "legacy",
        commerceConfigured: false,
      },
    } as const;

    for (let index = 0; index < HEALTH_CALLS; index += 1) {
      const callStartedAt = performance.now();
      const response = await healthResponse({ assertPaymentRuntime: async () => assert.fail("Payments are disabled.") });
      healthLatencies.push(performance.now() - callStartedAt);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      healthyResponses += 1;
      assert.deepEqual(await response.json(), expectedHealthContract);
      validHealthContracts += 1;
    }
    assert.equal(healthyResponses, HEALTH_CALLS);
    assert.equal(validHealthContracts, HEALTH_CALLS);
    assert.equal(healthClientCreations, 0);
    resetMediaStorageCacheForTests();
    setS3ClientFactoryForTests(null);

    let noNetworkHandlerCalls = 0;
    let operationHandlerCalls = 0;
    const createdLegacyClients: S3Client[] = [];
    const noNetworkRequestHandler = {
      async handle(request: { method?: string }) {
        noNetworkHandlerCalls += 1;
        operationHandlerCalls += 1;
        assert.equal(request.method, "HEAD");
        updatePeakCounters(diagnosticPeakCounters, getMemoryDiagnosticCounters());
        return {
          response: {
            statusCode: 200,
            headers: {
              "content-length": "0",
              "content-type": "image/webp",
            },
          },
        };
      },
      destroy() {},
    };

    const createMeasuredClientFactory = (clients: S3Client[]) => (configuration: ConstructorParameters<typeof S3Client>[0]) => {
      const client = new S3Client({
        ...configuration,
        requestHandler: noNetworkRequestHandler as never,
      });
      clients.push(client);
      return client;
    };

    const requiredEnvironmentValue = (name: string) => {
      const value = process.env[name]?.trim();
      assert.ok(value, `${name} must be configured by the isolated benchmark.`);
      return value;
    };
    const legacyUncachedLookup = () => new S3MediaStorage({
      provider: process.env.MEDIA_STORAGE_PROVIDER?.trim() || "r2",
      endpoint: requiredEnvironmentValue("MEDIA_S3_ENDPOINT"),
      region: process.env.MEDIA_S3_REGION?.trim() || "auto",
      publicBucket: requiredEnvironmentValue("MEDIA_PUBLIC_BUCKET"),
      privateBucket: requiredEnvironmentValue("MEDIA_PRIVATE_BUCKET"),
      forcePathStyle: process.env.MEDIA_S3_FORCE_PATH_STYLE === "true",
      accessKeyId: requiredEnvironmentValue("MEDIA_S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnvironmentValue("MEDIA_S3_SECRET_ACCESS_KEY"),
    });

    setS3ClientFactoryForTests(createMeasuredClientFactory(createdLegacyClients));
    const legacyMemoryBefore = memoryTracker.capture();
    const retainedLegacyStorages: unknown[] = [];
    const legacyStartedAt = performance.now();
    for (let index = 0; index < FACTORY_LOOKUPS; index += 1) {
      retainedLegacyStorages.push(legacyUncachedLookup());
    }
    const legacyDurationMs = performance.now() - legacyStartedAt;
    const legacyMemoryRetained = memoryTracker.capture();
    assert.equal(retainedLegacyStorages.length, FACTORY_LOOKUPS);
    assert.equal(new Set(retainedLegacyStorages).size, FACTORY_LOOKUPS);
    assert.equal(createdLegacyClients.length, FACTORY_LOOKUPS);
    assert.equal(operationHandlerCalls, 0);
    retainedLegacyStorages.length = 0;
    for (const client of createdLegacyClients) client.destroy();
    createdLegacyClients.length = 0;
    await waitForImmediate();

    const createdCachedClients: S3Client[] = [];
    resetMediaStorageCacheForTests();
    setS3ClientFactoryForTests(createMeasuredClientFactory(createdCachedClients));
    const cachedMemoryBefore = memoryTracker.capture();
    const retainedCachedStorages: unknown[] = [];
    const cachedStartedAt = performance.now();
    for (let index = 0; index < FACTORY_LOOKUPS; index += 1) {
      retainedCachedStorages.push(activeMediaStorage());
    }
    const cachedDurationMs = performance.now() - cachedStartedAt;
    const cachedMemoryRetained = memoryTracker.capture();
    assert.equal(retainedCachedStorages.length, FACTORY_LOOKUPS);
    assert.equal(new Set(retainedCachedStorages).size, 1);
    assert.equal(createdCachedClients.length, 1);
    const cachedStorage = retainedCachedStorages[0] as ReturnType<typeof activeMediaStorage>;
    assert.ok(cachedStorage);

    const operationKey = "catalog/images/00000000-0000-4000-8000-000000000001.webp";
    for (let index = 0; index < MOCK_STORAGE_OPERATIONS; index += 1) {
      assert.equal(retainedCachedStorages[index], cachedStorage);
      const metadata = await cachedStorage.head({ scope: "public", key: operationKey });
      assert.equal(metadata.contentLength, 0);
      assert.equal(metadata.contentType, "image/webp");
    }
    assert.equal(operationHandlerCalls, MOCK_STORAGE_OPERATIONS);
    assert.equal(noNetworkHandlerCalls, MOCK_STORAGE_OPERATIONS);
    assert.equal(createdCachedClients.length, 1);
    retainedCachedStorages.length = 0;
    resetMediaStorageCacheForTests();
    for (const client of createdCachedClients) client.destroy();
    createdCachedClients.length = 0;
    setS3ClientFactoryForTests(null);

    let observedTransformConcurrency = 0;
    let successfulImages = 0;
    let normalizedBytes = 0;
    const uploadDurations: number[] = [];
    const cycleEndMemoryMiB: MemorySample[] = [];

    for (let cycle = 0; cycle < options.uploadCycles; cycle += 1) {
      assert.ok(smallFixture);
      assert.ok(nearLimitFixture);
      const currentSmallFixture: Buffer = smallFixture;
      const currentNearLimitFixture: Buffer = nearLimitFixture;
      const inputs: Array<{
        buffer: () => Promise<Buffer>;
        originalFilename: string;
        declaredMimeType: string;
      }> = [
        {
          buffer: async () => {
            const state = getOrderPhotoTransformState();
            observedTransformConcurrency = Math.max(observedTransformConcurrency, state.active);
            updatePeakCounters(diagnosticPeakCounters, getMemoryDiagnosticCounters());
            assert.equal(state.active, 1);
            assert.equal(state.queued, 0);
            return currentSmallFixture;
          },
          originalFilename: "small.jpg",
          declaredMimeType: "image/jpeg",
        },
        {
          buffer: async () => {
            const state = getOrderPhotoTransformState();
            observedTransformConcurrency = Math.max(observedTransformConcurrency, state.active);
            updatePeakCounters(diagnosticPeakCounters, getMemoryDiagnosticCounters());
            assert.equal(state.active, 1);
            assert.equal(state.queued, 0);
            return currentNearLimitFixture;
          },
          originalFilename: "near-limit-progressive.jpg",
          declaredMimeType: "image/jpeg",
        },
      ];

      const uploadStartedAt = performance.now();
      const persisted = await withMemoryDiagnosticOperation("upload", () => processOrderImageBatch(inputs, {
        persist: async (normalized, index): Promise<{ storageKey: string }> => {
          successfulImages += 1;
          normalizedBytes += normalized.sizeBytes;
          return { storageKey: `synthetic/${cycle}/${index}` };
        },
        cleanup: async () => assert.fail("Successful synthetic uploads must not require cleanup."),
      }));
      uploadDurations.push(performance.now() - uploadStartedAt);

      assert.equal(persisted.length, 2);
      assert.deepEqual([persisted[0]?.width, persisted[0]?.height], [smallWidth, smallHeight]);
      assert.deepEqual([persisted[1]?.width, persisted[1]?.height], [nearLimitWidth, nearLimitHeight]);
      assert.ok(persisted.every((item) => !("buffer" in item)));
      assert.equal(getOrderPhotoTransformState().active, 0);
      assert.equal(getOrderPhotoTransformState().queued, 0);
      cycleEndMemoryMiB.push(memoryTracker.capture());
    }

    assert.equal(successfulImages, options.uploadCycles * 2);
    assert.equal(observedTransformConcurrency, ORDER_PHOTO_TRANSFORM_CONCURRENCY);
    assert.equal(ORDER_PHOTO_TRANSFORM_CONCURRENCY, 1);
    assert.equal(ORDER_PHOTO_TRANSFORM_QUEUE_LIMIT, 1);

    const smallFixtureBytes = smallFixture.length;
    const nearLimitFixtureBytes = nearLimitFixture.length;
    smallFixture = null;
    nearLimitFixture = null;
    await waitForImmediate();
    const postMemory = memoryTracker.capture();
    await wait(options.idleMs);
    await waitForImmediate();
    const postIdleMemory = memoryTracker.capture();
    const trackedMemory = memoryTracker.finish();

    const firstCycleRss = cycleEndMemoryMiB[0]?.rss ?? postMemory.rss;
    const lastCycleRss = cycleEndMemoryMiB.at(-1)?.rss ?? postMemory.rss;
    const cycleRssGrowthMiB = round(lastCycleRss - firstCycleRss, 1);
    const cycleRssGrowthRatio = firstCycleRss > 0
      ? round(cycleRssGrowthMiB / firstCycleRss, 3)
      : 0;
    const cycleRssMonotonic = cycleEndMemoryMiB.every((sample, index) => (
      index === 0 || sample.rss >= cycleEndMemoryMiB[index - 1]!.rss
    ));
    const trendClassification = cycleEndMemoryMiB.length >= 5
      && cycleRssMonotonic
      && cycleRssGrowthRatio >= 0.25
      ? "SUSPICIOUS_GROWTH"
      : cycleEndMemoryMiB.length >= 5 && Math.abs(cycleRssGrowthRatio) <= 0.1
        ? "STABLE_LOCAL"
        : "INCONCLUSIVE";

    const finalSemaphore = getOrderPhotoTransformState();
    const finalCounters = getMemoryDiagnosticCounters();
    assert.deepEqual(finalSemaphore, {
      active: 0,
      queued: 0,
      concurrency: 1,
      queueLimit: 1,
    });
    assert.deepEqual(finalCounters, {
      activeUploads: 0,
      activeImageTransforms: 0,
      activeS3Operations: 0,
    });
    assert.equal(diagnosticSchemaViolations, 0);
    assert.equal(diagnosticEvents["memory.storage.before"], MOCK_STORAGE_OPERATIONS);
    assert.equal(diagnosticEvents["memory.storage.after"], MOCK_STORAGE_OPERATIONS);
    assert.equal(diagnosticEvents["memory.upload.before"], options.uploadCycles);
    assert.equal(diagnosticEvents["memory.upload.after"], options.uploadCycles);

    const report = {
      schemaVersion: 1,
      result: "pass",
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        profile: options.profile,
        durationMs: round(performance.now() - startedAt),
        sameProcessForStorageComparison: true,
      },
      parameters: {
        healthCalls: HEALTH_CALLS,
        factoryLookupsPerPattern: FACTORY_LOOKUPS,
        mockStorageOperations: MOCK_STORAGE_OPERATIONS,
        uploadCycles: options.uploadCycles,
        imagesPerCycle: 2,
        idleMs: options.idleMs,
        memorySampleIntervalMs: MEMORY_SAMPLE_INTERVAL_MS,
      },
      memoryMiB: {
        startup: startupMemory,
        warmup: warmupMemory,
        peak: trackedMemory.peak,
        post: postMemory,
        postIdle: postIdleMemory,
        samples: trackedMemory.samples,
        trendAssessment: {
          classification: trendClassification,
          reasonCode: trendClassification === "SUSPICIOUS_GROWTH"
            ? "MONOTONIC_CYCLE_RSS_GROWTH"
            : trendClassification === "STABLE_LOCAL"
              ? "NO_SIGNIFICANT_CYCLE_RSS_GROWTH"
              : "SHORT_WINDOW_OR_NOISY_RSS",
          cycleRssMonotonic,
          cycleRssGrowthMiB,
          cycleRssGrowthRatio,
        },
      },
      health: {
        status200: healthyResponses,
        validContracts: validHealthContracts,
        clientCreations: healthClientCreations,
        latencyMs: durationSummary(healthLatencies),
      },
      storageFactory: {
        legacyUncached: {
          storageCreations: FACTORY_LOOKUPS,
          clientCreations: FACTORY_LOOKUPS,
          durationMs: round(legacyDurationMs),
          retainedMemoryDeltaMiB: memoryDelta(legacyMemoryRetained, legacyMemoryBefore),
        },
        cached: {
          uniqueStorages: 1,
          clientCreations: 1,
          durationMs: round(cachedDurationMs),
          retainedMemoryDeltaMiB: memoryDelta(cachedMemoryRetained, cachedMemoryBefore),
        },
        mockOperations: operationHandlerCalls,
        stableClient: true,
      },
      uploads: {
        cycles: options.uploadCycles,
        successfulImages,
        normalizedBytes,
        fixture: {
          small: { width: smallWidth, height: smallHeight, bytes: smallFixtureBytes },
          nearLimitProgressive: {
            width: nearLimitWidth,
            height: nearLimitHeight,
            pixels: nearLimitPixels,
            pixelLimitRatio: round(nearLimitPixels / orderOffer.maxImagePixels, 6),
            bytes: nearLimitFixtureBytes,
          },
        },
        durationMs: durationSummary(uploadDurations),
        cycleEndMemoryMiB,
        maxTransformConcurrency: observedTransformConcurrency,
        finalSemaphore,
        finalCounters,
      },
      diagnostics: {
        enabled: true,
        records: diagnosticRecords,
        events: diagnosticEvents,
        peakCounters: diagnosticPeakCounters,
        schemaViolations: diagnosticSchemaViolations,
      },
      safeguards: {
        networkRequests: 0,
        localMockHandlerCalls: noNetworkHandlerCalls,
        databaseCalls: 0,
        portsOpened: 0,
        globalGcCalls: 0,
        temporaryArtifactsRemaining: 0,
      },
    } as const;

    const serializedReport = JSON.stringify(report);
    assert.doesNotMatch(
      serializedReport,
      /(?:benchmark-(?:access|secret)-fixture|storage\.invalid|access.?key|credential|password|\/Users\/|@)/i,
    );
    temporaryReportPath = `${REPORT_PATH}.${process.pid}.tmp`;
    await writeFile(temporaryReportPath, `${serializedReport}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryReportPath, REPORT_PATH);
    temporaryReportPath = null;
    process.stdout.write(`${serializedReport}\n`);
  } finally {
    if (watchdog) clearTimeout(watchdog);
    console.info = originalConsoleInfo;
    restoreEnvironment();
    if (temporaryReportPath) await rm(temporaryReportPath, { force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown benchmark failure.";
  process.stderr.write(`Memory hardening benchmark failed: ${message}\n`);
  process.exitCode = 1;
});
