import assert from "node:assert/strict";
import { open, readFile, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";

export const MEDIA_MIGRATION_DATABASE_TARGET = "lnx-studio-local-preview";
export const MEDIA_OBJECT_DATABASE_CONFIRMATION = "migrate-lnx-studio-local-preview-media-to-r2-staging";
export const MEDIA_BACKFILL_DATABASE_CONFIRMATION = "backfill-lnx-studio-local-preview-media-metadata";
export const MEDIA_MIGRATION_LOCK_MAX_RUNTIME_MS = 2 * 60 * 60 * 1_000;
export const MEDIA_MIGRATION_LOCK_PATH = "/private/tmp/lnx-studio-media-migration-v0631.lock";

type Environment = Record<string, string | undefined>;

export type PrismaRuntimeProof = {
  name?: string;
  pid?: number;
  exports?: { database?: { connectionString?: string } };
};

export type MediaDatabaseOperation = "backup" | "dry-run" | "backfill-local" | "object-migration";

export type MediaMigrationLease = {
  readonly deadlineAt: number;
  assertActive(): void;
};

export type MediaMigrationLockFile = {
  writeFile(data: string): Promise<void>;
  stat(): Promise<{ dev: number | bigint; ino: number | bigint }>;
  close(): Promise<void>;
};

export type MediaMigrationLockFileSystem = {
  open(filePath: string, flags: "wx", mode: number): Promise<MediaMigrationLockFile>;
  stat(filePath: string): Promise<{ dev: number | bigint; ino: number | bigint }>;
  unlink(filePath: string): Promise<void>;
};

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  assert.ok(value, `${name} must be configured.`);
  return value;
}

export async function loadMediaMigrationDatabaseProof(environment: Environment = process.env) {
  const target = required(environment, "LNX_DATABASE_TARGET");
  const configuredPath = environment.LNX_PRISMA_DEV_SERVER_FILE?.trim();
  const proofPath = configuredPath || path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "prisma-dev-nodejs",
    target,
    "server.json",
  );
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as PrismaRuntimeProof;
  return { proof, proofPath } as const;
}

export function assertPrismaRuntimeProcessAlive(proof: PrismaRuntimeProof) {
  const pid = Number(proof.pid);
  assert.ok(Number.isInteger(pid) && pid > 0, "The Prisma runtime proof has no valid process identifier.");
  try {
    process.kill(pid, 0);
  } catch {
    throw new Error("The proven Prisma runtime process is not active.");
  }
}

function migrationLease(now: () => number, maximumRuntimeMs: number): MediaMigrationLease {
  assert.ok(
    Number.isSafeInteger(maximumRuntimeMs) && maximumRuntimeMs > 0 && maximumRuntimeMs < 12 * 60 * 60 * 1_000,
    "The media migration lock runtime must be positive and shorter than twelve hours.",
  );
  const deadlineAt = now() + maximumRuntimeMs;
  return {
    deadlineAt,
    assertActive() {
      assert.ok(now() <= deadlineAt, "The media migration lock runtime deadline was exceeded.");
    },
  };
}

const defaultLockFileSystem: MediaMigrationLockFileSystem = { open, stat, unlink };

function sameFileIdentity(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
) {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

export async function withMediaMigrationFileLock<T>(
  fileSystem: MediaMigrationLockFileSystem,
  operation: (lease: MediaMigrationLease) => Promise<T>,
  options: {
    now?: () => number;
    maximumRuntimeMs?: number;
    lockPath?: string;
    pid?: number;
    databaseTarget?: string;
  } = {},
) {
  const now = options.now ?? Date.now;
  const lease = migrationLease(now, options.maximumRuntimeMs ?? MEDIA_MIGRATION_LOCK_MAX_RUNTIME_MS);
  const lockPath = options.lockPath ?? MEDIA_MIGRATION_LOCK_PATH;
  assert.equal(path.dirname(lockPath), "/private/tmp", "The media migration lock must remain directly under /private/tmp.");
  assert.match(path.basename(lockPath), /^lnx-studio-media-migration-[a-zA-Z0-9._-]+\.lock$/, "Unexpected media migration lock path.");

  let lockFile: MediaMigrationLockFile | null = null;
  let lockIdentity: { dev: number | bigint; ino: number | bigint } | null = null;
  let result: T | undefined;
  let operationError: unknown;
  let releaseError: unknown;

  try {
    try {
      lockFile = await fileSystem.open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("Another media migration or backup lock exists. Inspect it manually; stale locks are never removed automatically.");
      }
      throw error;
    }
    lockIdentity = await lockFile.stat();
    await lockFile.writeFile(`${JSON.stringify({
      format: "lnx-studio-media-migration-lock-v1",
      pid: options.pid ?? process.pid,
      databaseTarget: options.databaseTarget ?? process.env.LNX_DATABASE_TARGET ?? "unconfigured",
      createdAt: new Date(now()).toISOString(),
      deadlineAt: new Date(lease.deadlineAt).toISOString(),
    })}\n`);
    lease.assertActive();
    result = await operation(lease);
  } catch (error) {
    operationError = error;
  }

  if (lockFile && lockIdentity) {
    try {
      const pathIdentity = await fileSystem.stat(lockPath);
      assert.ok(sameFileIdentity(lockIdentity, pathIdentity), "The media migration lock file identity changed; refusing to remove it.");
      await fileSystem.unlink(lockPath);
    } catch (error) {
      releaseError = error;
    }
  }
  if (lockFile) {
    try {
      await lockFile.close();
    } catch (error) {
      releaseError = releaseError
        ? new AggregateError([releaseError, error], "The media migration lock file could not be closed cleanly.")
        : error;
    }
  }

  if (operationError && releaseError) {
    throw new AggregateError([operationError, releaseError], "The media migration operation failed and its local lock did not release cleanly.");
  }
  if (operationError) throw operationError;
  if (releaseError) throw releaseError;
  return result as T;
}

export function withMediaMigrationLock<T>(operation: (lease: MediaMigrationLease) => Promise<T>) {
  return withMediaMigrationFileLock(defaultLockFileSystem, operation);
}

export function assertApprovedMediaMigrationDatabase(
  operation: MediaDatabaseOperation,
  proof: PrismaRuntimeProof,
  environment: Environment = process.env,
) {
  assert.ok(!environment.RAILWAY_ENVIRONMENT, "Media migration refuses Railway environments.");
  const target = required(environment, "LNX_DATABASE_TARGET");
  assert.equal(target, MEDIA_MIGRATION_DATABASE_TARGET, "Media migration refuses databases outside the approved local preview target.");

  const rawDatabaseUrl = required(environment, "DATABASE_URL");
  assertSafeLocalPostgresUrl(rawDatabaseUrl);

  assert.equal(proof.name, target, "The Prisma runtime proof does not match the approved media database.");
  assert.equal(
    proof.exports?.database?.connectionString,
    rawDatabaseUrl,
    "The Prisma runtime proof does not match the configured database connection.",
  );
  assert.ok(Number.isInteger(proof.pid) && Number(proof.pid) > 0, "The Prisma runtime proof has no valid process identifier.");

  if (operation === "object-migration") {
    assert.equal(
      environment.MEDIA_MIGRATION_DATABASE_CONFIRM,
      MEDIA_OBJECT_DATABASE_CONFIRMATION,
      "Object migration requires explicit approval for the persistent local preview database.",
    );
  } else if (operation === "backfill-local") {
    assert.equal(
      environment.MEDIA_MIGRATION_DATABASE_CONFIRM,
      MEDIA_BACKFILL_DATABASE_CONFIRMATION,
      "Local media backfill requires explicit approval for the persistent local preview database.",
    );
  }

  return { target, pid: Number(proof.pid) } as const;
}
