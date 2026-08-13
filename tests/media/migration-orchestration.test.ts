import assert from "node:assert/strict";
import test from "node:test";

import {
  type MigrationArtifacts,
  type MigrationFileOperations,
  MEDIA_MIGRATION_JOURNAL_FORMAT,
  MEDIA_MIGRATION_RECOVERY_JOURNAL_FORMAT,
  appendPrimaryEvent,
  createMigrationArtifacts,
  migrationCounters,
  persistMigrationReport,
} from "@/lib/media/migration-orchestration";

const fixedNow = () => new Date("2026-08-13T12:34:56.000Z");
const header = {
  mode: "object-migration" as const,
  databaseTarget: "lnx-studio-local-preview",
  databaseIdentitySha256: "a".repeat(64),
  migrationEnvironment: "staging",
  migrationEnvironmentSha256: "b".repeat(64),
  sourceSetSha256: "c".repeat(64),
};

function fakeFiles() {
  const writes = new Map<string, string>();
  const appends = new Map<string, string[]>();
  const fileOperations = {
    writeFile: async (file: unknown, data: unknown) => {
      writes.set(String(file), String(data));
    },
    appendFile: async (file: unknown, data: unknown) => {
      const target = String(file);
      appends.set(target, [...(appends.get(target) ?? []), String(data)]);
    },
  } as unknown as MigrationFileOperations;
  return { writes, appends, fileOperations };
}

test("migration artifacts pre-create independent primary, recovery and partial-report channels", async () => {
  const files = fakeFiles();
  const artifacts = await createMigrationArtifacts("/private/tmp/backup", header, {
    now: fixedNow,
    nonce: () => "abc123",
    fileOperations: files.fileOperations,
  });

  assert.notEqual(artifacts.primaryJournalPath, artifacts.recoveryJournalPath);
  assert.notEqual(artifacts.primaryJournalPath, artifacts.reportPath);
  assert.equal(JSON.parse(files.writes.get(artifacts.primaryJournalPath)!).format, MEDIA_MIGRATION_JOURNAL_FORMAT);
  assert.equal(JSON.parse(files.writes.get(artifacts.recoveryJournalPath)!).format, MEDIA_MIGRATION_RECOVERY_JOURNAL_FORMAT);
  assert.equal(JSON.parse(files.writes.get(artifacts.reportPath)!).status, "running");
});

test("a primary journal failure preserves the intended event in the recovery journal", async () => {
  const artifacts: MigrationArtifacts = {
    primaryJournalPath: "/private/tmp/primary.jsonl",
    recoveryJournalPath: "/private/tmp/recovery.jsonl",
    reportPath: "/private/tmp/report.json",
  };
  const recoveryLines: string[] = [];
  const failure = Object.assign(new Error("simulated primary journal failure"), { code: "EIO" });
  const fileOperations = {
    writeFile: async () => undefined,
    appendFile: async (file: unknown, data: unknown) => {
      if (String(file) === artifacts.primaryJournalPath) throw failure;
      recoveryLines.push(String(data));
    },
  } as unknown as MigrationFileOperations;

  await assert.rejects(
    appendPrimaryEvent(artifacts, { action: "database-committed", assetId: "asset-1" }, { now: fixedNow, fileOperations }),
    /simulated primary journal failure/,
  );
  assert.equal(recoveryLines.length, 1);
  const recovery = JSON.parse(recoveryLines[0]);
  assert.equal(recovery.action, "primary-journal-write-failed");
  assert.deepEqual(recovery.intendedEvent, { action: "database-committed", assetId: "asset-1" });
  assert.deepEqual(recovery.failure, { name: "Error", code: "EIO" });
});

test("a partial-report write failure is recorded without copying the error message", async () => {
  const artifacts: MigrationArtifacts = {
    primaryJournalPath: "/private/tmp/primary.jsonl",
    recoveryJournalPath: "/private/tmp/recovery.jsonl",
    reportPath: "/private/tmp/report.json",
  };
  const recoveryLines: string[] = [];
  const fileOperations = {
    writeFile: async () => {
      throw Object.assign(new Error("must not be copied"), { code: "ENOSPC" });
    },
    appendFile: async (_file: unknown, data: unknown) => {
      recoveryLines.push(String(data));
    },
  } as unknown as MigrationFileOperations;

  await assert.rejects(
    persistMigrationReport(artifacts, { status: "failed", completedCount: 3, failedAssetId: "asset-4" }, { now: fixedNow, fileOperations }),
    /must not be copied/,
  );
  const recovery = JSON.parse(recoveryLines[0]);
  assert.equal(recovery.action, "migration-report-write-failed");
  assert.equal(recovery.completedCount, 3);
  assert.equal(recovery.failedAssetId, "asset-4");
  assert.deepEqual(recovery.failure, { name: "Error", code: "ENOSPC" });
  assert.doesNotMatch(recoveryLines[0], /must not be copied/);
});

test("a partial migration report remains explicit and points to both journals", async () => {
  const files = fakeFiles();
  const artifacts: MigrationArtifacts = {
    primaryJournalPath: "/private/tmp/primary.jsonl",
    recoveryJournalPath: "/private/tmp/recovery.jsonl",
    reportPath: "/private/tmp/report.json",
  };
  await persistMigrationReport(artifacts, {
    status: "partial",
    ok: false,
    completedCount: 13,
    failedAssetId: "asset-14",
    scanned: 14,
    wouldUpload: 0,
    uploaded: 13,
    skipped: 0,
    conflicts: 0,
    failures: 1,
    bytes: "9000000",
  }, { now: fixedNow, fileOperations: files.fileOperations });

  const report = JSON.parse(files.writes.get(artifacts.reportPath)!);
  assert.equal(report.status, "partial");
  assert.equal(report.completedCount, 13);
  assert.equal(report.failedAssetId, "asset-14");
  assert.equal(report.failures, 1);
  assert.equal(report.primaryJournalPath, artifacts.primaryJournalPath);
  assert.equal(report.recoveryJournalPath, artifacts.recoveryJournalPath);
});

test("migration counters distinguish dry-run intent, uploads, skips, conflicts and failures", () => {
  assert.deepEqual(migrationCounters({
    scanned: 5,
    bytes: "12345",
    report: [
      { action: "migrate" },
      { action: "uploaded" },
      { action: "verify-existing" },
      { action: "already-object" },
      { action: "stop" },
    ],
    failures: 1,
  }), {
    scanned: 5,
    wouldUpload: 1,
    uploaded: 1,
    skipped: 2,
    conflicts: 1,
    failures: 1,
    bytes: "12345",
  });
});
