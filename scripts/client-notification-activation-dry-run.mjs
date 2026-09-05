import pg from "pg";

export const CLIENT_NOTIFICATION_CATEGORIES = Object.freeze([
  "SAFE_TO_SEND_NOW",
  "OBSOLETE_DO_NOT_SEND",
  "NEEDS_HUMAN_REVIEW",
  "ALREADY_FINAL_NO_RETRY",
  "CURRENT_FUTURE_ONLY",
]);

export const APPROVED_CLIENT_NOTIFICATION_ACTIVATION_POLICY = "OPTION_B_PLUS_E";

const claimableStatuses = new Set(["PENDING", "FAILED_RETRYABLE", "PROCESSING"]);
const terminalStatuses = new Set([
  "SENT", "DELIVERED", "FAILED", "FAILED_FINAL", "BOUNCED", "COMPLAINED", "SUPPRESSED", "CANCELED",
]);

export function assertClientNotificationDryRunArguments(argumentsProvided) {
  if (argumentsProvided.length !== 1 || argumentsProvided[0] !== "--dry-run") {
    throw new Error("Only the explicit --dry-run mode is supported.");
  }
}

export function classifyClientNotification(row, cutoff) {
  if (terminalStatuses.has(row.status)) return "ALREADY_FINAL_NO_RETRY";
  if (!claimableStatuses.has(row.status)) return "NEEDS_HUMAN_REVIEW";
  const createdAt = new Date(row.createdAt);
  if (Number.isNaN(createdAt.getTime())) return "NEEDS_HUMAN_REVIEW";
  if (createdAt >= cutoff) return "CURRENT_FUTURE_ONLY";
  // Age and type alone cannot prove that a historical transactional message
  // is still useful or safe for its customer.
  return "NEEDS_HUMAN_REVIEW";
}

export function summarizeClientNotifications(rows, cutoff, now = new Date()) {
  const categories = Object.fromEntries(CLIENT_NOTIFICATION_CATEGORIES.map((category) => [category, 0]));
  const statuses = {};
  const kinds = {};
  let retryableNow = 0;
  let expiredLeases = 0;
  let clientEmailDisabled = 0;
  let dangerousBacklog = 0;
  for (const row of rows) {
    const category = classifyClientNotification(row, cutoff);
    categories[category] += 1;
    statuses[row.status] = (statuses[row.status] ?? 0) + 1;
    kinds[row.kind] = (kinds[row.kind] ?? 0) + 1;
    const retryable = (row.status === "PENDING" || row.status === "FAILED_RETRYABLE") && new Date(row.availableAt) <= now;
    const expiredLease = row.status === "PROCESSING" && row.leaseExpiresAt && new Date(row.leaseExpiresAt) <= now;
    if (retryable) retryableNow += 1;
    if (expiredLease) expiredLeases += 1;
    if (category === "NEEDS_HUMAN_REVIEW" || retryable || expiredLease) dangerousBacklog += 1;
    if (row.lastErrorCode === "CLIENT_EMAIL_DISABLED") clientEmailDisabled += 1;
  }
  const historicalClaimable = categories.NEEDS_HUMAN_REVIEW;
  return {
    approvedPolicy: APPROVED_CLIENT_NOTIFICATION_ACTIVATION_POLICY,
    cutoff: cutoff.toISOString(),
    total: rows.length,
    statuses,
    kinds,
    retryableNow,
    expiredLeases,
    clientEmailDisabled,
    categories,
    historicalClaimable,
    dangerousBacklog,
    activatingWorkerWouldSendHistoricalMail: historicalClaimable > 0 ? "YES" : "NO",
    backlogSafe: dangerousBacklog === 0,
    activationReady: dangerousBacklog === 0,
    workerOnlyActivationRequired: true,
    manualRunNowAllowed: false,
    rollbackWorkerFlagValue: false,
  };
}

export async function readClientNotificationActivationState(client, cutoff = new Date()) {
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    const result = await client.query(`
      SELECT kind::text, status::text,
        "createdAt", "availableAt", "leaseExpiresAt", "lastErrorCode"
      FROM order_notifications
      WHERE "deploymentEnvironment" = 'production'
        AND kind::text LIKE 'CUSTOMER_%'
      ORDER BY "createdAt", id
    `);
    return summarizeClientNotifications(result.rows, cutoff);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function main() {
  assertClientNotificationDryRunArguments(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: "lnx-client-notification-activation-dry-run",
    options: "-c default_transaction_read_only=on",
  });
  await client.connect();
  try {
    const report = await readClientNotificationActivationState(client);
    console.info(JSON.stringify({ mode: "DRY_RUN_READ_ONLY", ...report }));
  } finally {
    await client.end();
  }
}

const executedDirectly = process.argv[1] === "-" || import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (executedDirectly) {
  main().catch(() => {
    console.error("Client notification activation dry-run failed safely; no database write was attempted.");
    process.exitCode = 1;
  });
}
