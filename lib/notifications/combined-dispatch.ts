import "server-only";
import { dispatchPendingOrderNotifications } from "@/lib/notifications/service";
import { dispatchSupportNotifications } from "@/lib/support/notifications";
import { dispatchReleaseAlerts } from "@/lib/release-notifications/dispatch";
/** Same worker/cron and guards; existing order dispatch is unchanged. */
export async function dispatchPendingNotifications(limit = 25) {
  const orders = await dispatchPendingOrderNotifications(limit);
  const support = await dispatchSupportNotifications(limit);
  const releases = await dispatchReleaseAlerts(limit);
  return { claimed: orders.claimed + support.claimed + releases.claimed, delivered: orders.delivered + support.delivered + releases.delivered,
    failed: orders.failed + support.failed + releases.failed, skipped: orders.skipped + support.skipped + releases.skipped };
}
