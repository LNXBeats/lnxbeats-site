import "server-only";
import { dispatchPendingOrderNotifications } from "@/lib/notifications/service";
import { dispatchSupportNotifications } from "@/lib/support/notifications";
/** Same worker/cron and guards; existing order dispatch is unchanged. */
export async function dispatchPendingNotifications(limit = 25) {
  const orders = await dispatchPendingOrderNotifications(limit);
  const support = await dispatchSupportNotifications(limit);
  return { claimed: orders.claimed + support.claimed, delivered: orders.delivered + support.delivered,
    failed: orders.failed + support.failed, skipped: orders.skipped + support.skipped };
}
