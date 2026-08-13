import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_BACKFILL_DATABASE_CONFIRMATION,
  MEDIA_MIGRATION_DATABASE_TARGET,
  MEDIA_OBJECT_DATABASE_CONFIRMATION,
  assertApprovedMediaMigrationDatabase,
  withMediaMigrationFileLock,
  type MediaMigrationLockFileSystem,
} from "@/lib/media/migration-database-guard";

function environment(overrides: Record<string, string | undefined> = {}) {
  const databaseUrl = "postgresql://preview:secret@127.0.0.1:51238/template1?schema=public";
  return {
    LNX_DATABASE_TARGET: MEDIA_MIGRATION_DATABASE_TARGET,
    DATABASE_URL: databaseUrl,
    ...overrides,
  };
}

function proof(overrides: Record<string, unknown> = {}) {
  return {
    name: MEDIA_MIGRATION_DATABASE_TARGET,
    pid: 1234,
    exports: { database: { connectionString: environment().DATABASE_URL } },
    ...overrides,
  };
}

test("read-only media inventory accepts only the proven isolated local preview database", () => {
  assert.doesNotThrow(() => assertApprovedMediaMigrationDatabase("backup", proof(), environment()));
  assert.doesNotThrow(() => assertApprovedMediaMigrationDatabase("dry-run", proof(), environment()));
  assert.throws(
    () => assertApprovedMediaMigrationDatabase("backup", proof(), environment({ LNX_DATABASE_TARGET: "lnx-studio-production" })),
    /outside the approved local preview target/,
  );
  assert.throws(
    () => assertApprovedMediaMigrationDatabase("backup", proof(), environment({ DATABASE_URL: "postgresql://preview:secret@db.example.invalid:5432/production" })),
    /isolated loopback PostgreSQL runtime/,
  );
  for (const databaseUrl of [
    "postgresql://preview:secret@127.0.0.1:51238/template1?host=db.example.invalid",
    "postgresql://preview:secret@127.0.0.1:51238/template1?port=5432",
    "postgresql://preview:secret@127.0.0.1:51238/template1?schema=public&schema=other",
    "postgresql://preview:secret@127.0.0.1:51238/template1?sslmode=require",
  ]) {
    assert.throws(
      () => assertApprovedMediaMigrationDatabase("backup", proof(), environment({ DATABASE_URL: databaseUrl })),
      /connection parameter|schema parameter|sslmode parameter/,
    );
  }
  assert.throws(
    () => assertApprovedMediaMigrationDatabase("backup", proof(), environment({ RAILWAY_ENVIRONMENT: "production" })),
    /refuses Railway/,
  );
  assert.throws(
    () => assertApprovedMediaMigrationDatabase("backup", proof({ pid: 0 }), environment()),
    /process identifier/,
  );
  assert.throws(
    () => assertApprovedMediaMigrationDatabase("backup", proof({ name: "another" }), environment()),
    /proof does not match/,
  );
});

test("write modes require a database-specific confirmation", () => {
  assert.throws(
    () => assertApprovedMediaMigrationDatabase("object-migration", proof(), environment()),
    /explicit approval/,
  );
  assert.doesNotThrow(() => assertApprovedMediaMigrationDatabase(
    "object-migration",
    proof(),
    environment({ MEDIA_MIGRATION_DATABASE_CONFIRM: MEDIA_OBJECT_DATABASE_CONFIRMATION }),
  ));
  assert.throws(
    () => assertApprovedMediaMigrationDatabase("backfill-local", proof(), environment()),
    /explicit approval/,
  );
  assert.doesNotThrow(() => assertApprovedMediaMigrationDatabase(
    "backfill-local",
    proof(),
    environment({ MEDIA_MIGRATION_DATABASE_CONFIRM: MEDIA_BACKFILL_DATABASE_CONFIRMATION }),
  ));
});

function fakeLockFileSystem(options: { exists?: boolean; replaced?: boolean } = {}) {
  const events: string[] = [];
  let exists = options.exists ?? false;
  const fileSystem: MediaMigrationLockFileSystem = {
    async open() {
      events.push("open-wx");
      if (exists) {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      }
      exists = true;
      return {
        async writeFile(data) {
          events.push("write");
          const lock = JSON.parse(data);
          assert.equal(lock.format, "lnx-studio-media-migration-lock-v1");
          assert.equal(lock.databaseTarget, MEDIA_MIGRATION_DATABASE_TARGET);
          assert.equal(typeof lock.pid, "number");
        },
        async stat() {
          events.push("handle-stat");
          return { dev: 1, ino: 42 };
        },
        async close() {
          events.push("close");
        },
      };
    },
    async stat() {
      events.push("path-stat");
      if (!exists) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { dev: 1, ino: options.replaced ? 99 : 42 };
    },
    async unlink() {
      events.push("unlink");
      exists = false;
    },
  };
  return { fileSystem, events, exists: () => exists };
}

test("the atomic local lock permits independent Prisma-style work and releases in finally", async () => {
  const { fileSystem, events, exists } = fakeLockFileSystem();
  const independentDatabaseWork = Promise.resolve("database-result");
  const result = await withMediaMigrationFileLock(fileSystem, async (lease) => {
    events.push("operation-start");
    lease.assertActive();
    const value = await independentDatabaseWork;
    events.push("operation-end");
    return value;
  }, {
    now: () => 1_000,
    maximumRuntimeMs: 60_000,
    lockPath: "/private/tmp/lnx-studio-media-migration-test.lock",
    pid: 1234,
    databaseTarget: MEDIA_MIGRATION_DATABASE_TARGET,
  });

  assert.equal(result, "database-result");
  assert.equal(exists(), false);
  assert.deepEqual(events, ["open-wx", "handle-stat", "write", "operation-start", "operation-end", "path-stat", "unlink", "close"]);
});

test("the atomic local lock releases after an operation error", async () => {
  const { fileSystem, events, exists } = fakeLockFileSystem();
  await assert.rejects(
    withMediaMigrationFileLock(fileSystem, async () => {
      events.push("operation-start");
      throw new Error("simulated operation failure");
    }, {
      lockPath: "/private/tmp/lnx-studio-media-migration-test.lock",
      databaseTarget: MEDIA_MIGRATION_DATABASE_TARGET,
    }),
    /simulated operation failure/,
  );
  assert.equal(exists(), false);
  assert.deepEqual(events, ["open-wx", "handle-stat", "write", "operation-start", "path-stat", "unlink", "close"]);
});

test("lock contention fails closed without stale-lock deletion or operation execution", async () => {
  const { fileSystem, events, exists } = fakeLockFileSystem({ exists: true });
  let executed = false;
  await assert.rejects(
    withMediaMigrationFileLock(fileSystem, async () => {
      executed = true;
    }, {
      lockPath: "/private/tmp/lnx-studio-media-migration-test.lock",
      databaseTarget: MEDIA_MIGRATION_DATABASE_TARGET,
    }),
    /Inspect it manually; stale locks are never removed automatically/,
  );
  assert.equal(executed, false);
  assert.equal(exists(), true);
  assert.deepEqual(events, ["open-wx"]);
});

test("the local lock refuses to delete a path whose file identity changed", async () => {
  const { fileSystem, events, exists } = fakeLockFileSystem({ replaced: true });
  await assert.rejects(
    withMediaMigrationFileLock(fileSystem, async () => undefined, {
      lockPath: "/private/tmp/lnx-studio-media-migration-test.lock",
      databaseTarget: MEDIA_MIGRATION_DATABASE_TARGET,
    }),
    /identity changed/,
  );
  assert.equal(exists(), true);
  assert.deepEqual(events, ["open-wx", "handle-stat", "write", "path-stat", "close"]);
});

test("the local lock enforces a runtime shorter than twelve hours", async () => {
  const { fileSystem } = fakeLockFileSystem();
  await assert.rejects(
    withMediaMigrationFileLock(fileSystem, async () => undefined, {
      maximumRuntimeMs: 12 * 60 * 60 * 1_000,
      lockPath: "/private/tmp/lnx-studio-media-migration-test.lock",
      databaseTarget: MEDIA_MIGRATION_DATABASE_TARGET,
    }),
    /shorter than twelve hours/,
  );
});

test("an expired lease fails the operation and still releases the local lock", async () => {
  const { fileSystem, events, exists } = fakeLockFileSystem();
  let currentTime = 1_000;
  await assert.rejects(
    withMediaMigrationFileLock(fileSystem, async (lease) => {
      events.push("operation-start");
      currentTime = 62_000;
      lease.assertActive();
    }, {
      now: () => currentTime,
      maximumRuntimeMs: 60_000,
      lockPath: "/private/tmp/lnx-studio-media-migration-test.lock",
      databaseTarget: MEDIA_MIGRATION_DATABASE_TARGET,
    }),
    /deadline was exceeded/,
  );
  assert.equal(exists(), false);
  assert.deepEqual(events, ["open-wx", "handle-stat", "write", "operation-start", "path-stat", "unlink", "close"]);
});
