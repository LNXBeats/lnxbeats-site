import "server-only";
import { parseNotificationConfiguration } from "@/lib/notifications/config";

const zero = () => ({ claimed: 0, delivered: 0, failed: 0, skipped: 0 });

/** Scheduler calls the Web capability without AUTH_SECRET or release-table writes. */
export async function dispatchReleaseAlertsViaWeb(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  request: typeof fetch = fetch,
) {
  const enabled = environment.RELEASE_ALERT_WEB_DISPATCH_ENABLED;
  if (enabled === undefined || enabled === "false") return zero();
  if (enabled !== "true") throw new Error("RELEASE_ALERT_WEB_CONFIGURATION_INVALID");
  const configuration = parseNotificationConfiguration(environment);
  if (!configuration.workerEnabled || !configuration.emailEnabled || !configuration.canonicalUrl || !configuration.workerSecret) {
    throw new Error("RELEASE_ALERT_WEB_CONFIGURATION_INVALID");
  }
  try {
    const response = await request(`${configuration.canonicalUrl}/api/internal/notifications/releases/dispatch`, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(55_000),
      headers: { authorization: `Bearer ${configuration.workerSecret}`, "x-notification-environment": configuration.deploymentEnvironment },
    });
    if (!response.ok) throw new Error("UNAVAILABLE");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") throw new Error("INVALID_RESPONSE");
    const result = body as Record<string, unknown>;
    if (result.ok !== true || !["claimed", "delivered", "failed", "skipped"].every(key =>
      typeof result[key] === "number" && Number.isSafeInteger(result[key]) && result[key] >= 0 && result[key] <= 25)) throw new Error("INVALID_RESPONSE");
    return { claimed: result.claimed as number, delivered: result.delivered as number,
      failed: result.failed as number, skipped: result.skipped as number };
  } catch {
    // No immediate retry after an ambiguous network result; the next cron uses the same outbox/idempotency keys.
    throw new Error("RELEASE_ALERT_WEB_DISPATCH_UNAVAILABLE");
  }
}
