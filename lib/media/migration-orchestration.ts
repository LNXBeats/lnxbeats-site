import { randomBytes } from "node:crypto";
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const MEDIA_MIGRATION_JOURNAL_FORMAT = "lnx-studio-media-migration-journal-v2";
export const MEDIA_MIGRATION_RECOVERY_JOURNAL_FORMAT = "lnx-studio-media-migration-recovery-v1";
export const MEDIA_MIGRATION_REPORT_FORMAT = "lnx-studio-media-migration-report-v1";

export type MigrationMode = "backfill-local" | "object-migration";
export type MigrationEvent = Record<string, unknown>;

export type MigrationArtifacts = {
  primaryJournalPath: string;
  recoveryJournalPath: string;
  reportPath: string;
};

export type MigrationCounterEntry = {
  action: string;
};

export function migrationCounters(input: {
  scanned: number;
  bytes: string;
  report: MigrationCounterEntry[];
  conflicts?: number;
  failures?: number;
}) {
  return {
    scanned: input.scanned,
    wouldUpload: input.report.filter(({ action }) => action === "migrate").length,
    uploaded: input.report.filter(({ action }) => action === "uploaded").length,
    skipped: input.report.filter(({ action }) => action === "verify-existing" || action === "verified-existing" || action === "already-object").length,
    conflicts: input.conflicts ?? input.report.filter(({ action }) => action === "stop").length,
    failures: input.failures ?? 0,
    bytes: input.bytes,
  };
}

type MigrationArtifactHeader = {
  mode: MigrationMode;
  databaseTarget: string;
  databaseIdentitySha256: string;
  migrationEnvironment: string;
  migrationEnvironmentSha256: string;
  sourceSetSha256: string;
};

export type MigrationFileOperations = {
  appendFile: typeof appendFile;
  writeFile: typeof writeFile;
};

const defaultFileOperations: MigrationFileOperations = { appendFile, writeFile };

function timestamp(now: () => Date) {
  return now().toISOString();
}

function safeErrorIdentity(error: unknown) {
  if (!error || typeof error !== "object") return { name: "Error" };
  const value = error as { name?: unknown; code?: unknown };
  return {
    name: typeof value.name === "string" && value.name ? value.name : "Error",
    ...(typeof value.code === "string" && value.code ? { code: value.code } : {}),
  };
}

export async function createMigrationArtifacts(
  root: string,
  header: MigrationArtifactHeader,
  options: {
    now?: () => Date;
    nonce?: () => string;
    fileOperations?: MigrationFileOperations;
  } = {},
) {
  const now = options.now ?? (() => new Date());
  const nonce = options.nonce ?? (() => randomBytes(3).toString("hex"));
  const files = options.fileOperations ?? defaultFileOperations;
  const runId = `${timestamp(now).replace(/[:.]/g, "-")}-${nonce()}`;
  const artifacts: MigrationArtifacts = {
    primaryJournalPath: path.join(root, `migration-journal-${runId}.jsonl`),
    recoveryJournalPath: path.join(root, `migration-recovery-${runId}.jsonl`),
    reportPath: path.join(root, `migration-${runId}.json`),
  };
  const createdAt = timestamp(now);
  await files.writeFile(artifacts.recoveryJournalPath, `${JSON.stringify({
    format: MEDIA_MIGRATION_RECOVERY_JOURNAL_FORMAT,
    createdAt,
    ...header,
  })}\n`, { flag: "wx", mode: 0o600 });
  try {
    await files.writeFile(artifacts.primaryJournalPath, `${JSON.stringify({
      format: MEDIA_MIGRATION_JOURNAL_FORMAT,
      createdAt,
      recoveryJournalPath: artifacts.recoveryJournalPath,
      ...header,
    })}\n`, { flag: "wx", mode: 0o600 });
    await files.writeFile(artifacts.reportPath, `${JSON.stringify({
      format: MEDIA_MIGRATION_REPORT_FORMAT,
      status: "running",
      createdAt,
      ...header,
      primaryJournalPath: artifacts.primaryJournalPath,
      recoveryJournalPath: artifacts.recoveryJournalPath,
    }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    await files.appendFile(artifacts.recoveryJournalPath, `${JSON.stringify({
      at: timestamp(now),
      action: "artifact-initialization-failed",
      failure: safeErrorIdentity(error),
    })}\n`, { mode: 0o600 });
    throw error;
  }
  return artifacts;
}

export async function appendRecoveryEvent(
  artifacts: MigrationArtifacts,
  event: MigrationEvent,
  options: { now?: () => Date; fileOperations?: MigrationFileOperations } = {},
) {
  const now = options.now ?? (() => new Date());
  const files = options.fileOperations ?? defaultFileOperations;
  await files.appendFile(
    artifacts.recoveryJournalPath,
    `${JSON.stringify({ at: timestamp(now), ...event })}\n`,
    { mode: 0o600 },
  );
}

export async function appendPrimaryEvent(
  artifacts: MigrationArtifacts,
  event: MigrationEvent,
  options: { now?: () => Date; fileOperations?: MigrationFileOperations } = {},
) {
  const now = options.now ?? (() => new Date());
  const files = options.fileOperations ?? defaultFileOperations;
  try {
    await files.appendFile(
      artifacts.primaryJournalPath,
      `${JSON.stringify({ at: timestamp(now), ...event })}\n`,
      { mode: 0o600 },
    );
  } catch (error) {
    await appendRecoveryEvent(artifacts, {
      action: "primary-journal-write-failed",
      intendedEvent: event,
      failure: safeErrorIdentity(error),
    }, { now, fileOperations: files });
    throw error;
  }
}

export async function persistMigrationReport(
  artifacts: MigrationArtifacts,
  report: Record<string, unknown>,
  options: { now?: () => Date; fileOperations?: MigrationFileOperations } = {},
) {
  const now = options.now ?? (() => new Date());
  const files = options.fileOperations ?? defaultFileOperations;
  try {
    await files.writeFile(artifacts.reportPath, `${JSON.stringify({
      format: MEDIA_MIGRATION_REPORT_FORMAT,
      ...report,
      primaryJournalPath: artifacts.primaryJournalPath,
      recoveryJournalPath: artifacts.recoveryJournalPath,
    }, null, 2)}\n`, { flag: "w", mode: 0o600 });
  } catch (error) {
    await appendRecoveryEvent(artifacts, {
      action: "migration-report-write-failed",
      reportStatus: report.status,
      completedCount: report.completedCount,
      failedAssetId: report.failedAssetId,
      failure: safeErrorIdentity(error),
    }, { now, fileOperations: files });
    throw error;
  }
}
