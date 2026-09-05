import assert from "node:assert/strict";
import test from "node:test";

import {
  assertClientNotificationDryRunArguments,
  classifyClientNotification,
  readClientNotificationActivationState,
  summarizeClientNotifications,
} from "../../scripts/client-notification-activation-dry-run.mjs";

const cutoff = new Date("2026-09-05T12:00:00.000Z");

test("client activation dry-run refuses every mode except explicit dry-run", () => {
  assert.doesNotThrow(() => assertClientNotificationDryRunArguments(["--dry-run"]));
  assert.throws(() => assertClientNotificationDryRunArguments([]));
  assert.throws(() => assertClientNotificationDryRunArguments(["--apply"]));
});

test("historical claimable messages always require human review", () => {
  assert.equal(classifyClientNotification({ status: "PENDING", createdAt: "2026-09-04T12:00:00Z" }, cutoff), "NEEDS_HUMAN_REVIEW");
  assert.equal(classifyClientNotification({ status: "FAILED_RETRYABLE", createdAt: "2026-09-04T12:00:00Z" }, cutoff), "NEEDS_HUMAN_REVIEW");
  assert.equal(classifyClientNotification({ status: "PENDING", createdAt: cutoff.toISOString() }, cutoff), "CURRENT_FUTURE_ONLY");
});

test("terminal messages cannot be resent by activation", () => {
  for (const status of ["DELIVERED", "FAILED_FINAL", "BOUNCED", "COMPLAINED", "SUPPRESSED", "CANCELED"]) {
    assert.equal(classifyClientNotification({ status, createdAt: "2026-09-01T00:00:00Z" }, cutoff), "ALREADY_FINAL_NO_RETRY");
  }
});

test("empty production backlog is safe and sends no historical mail", () => {
  const report = summarizeClientNotifications([], cutoff);
  assert.equal(report.total, 0);
  assert.equal(report.historicalClaimable, 0);
  assert.equal(report.activatingWorkerWouldSendHistoricalMail, "NO");
  assert.equal(report.backlogSafe, true);
  assert.equal(report.activationReady, true);
  assert.equal(report.approvedPolicy, "OPTION_B_PLUS_E");
  assert.equal(report.workerOnlyActivationRequired, true);
  assert.equal(report.manualRunNowAllowed, false);
  assert.equal(report.rollbackWorkerFlagValue, false);
});

test("approved activation policy blocks any immediately retryable client message", () => {
  const report = summarizeClientNotifications([
    { kind: "CUSTOMER_REFUND_COMPLETED", status: "PENDING", createdAt: cutoff, availableAt: cutoff },
  ], cutoff, cutoff);
  assert.equal(report.retryableNow, 1);
  assert.equal(report.dangerousBacklog, 1);
  assert.equal(report.activationReady, false);
});

test("database diagnostic opens an explicit read-only transaction and always rolls back", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql.trim());
      return { rows: [] };
    },
  };
  await readClientNotificationActivationState(client, cutoff);
  assert.match(queries[0]!, /^BEGIN TRANSACTION READ ONLY$/);
  assert.match(queries[1]!, /^SELECT/);
  assert.match(queries[2]!, /^ROLLBACK$/);
  assert.doesNotMatch(queries.join("\n"), /\b(INSERT|UPDATE|DELETE|nextval)\b/i);
});
