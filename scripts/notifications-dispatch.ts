import { parseNotificationConfiguration } from "@/lib/notifications/config";
import { dispatchPendingOrderNotifications } from "@/lib/notifications/service";
import { prisma } from "@/lib/prisma";

try {
  const configuration = parseNotificationConfiguration();
  if (!configuration.emailEnabled) throw new Error("Notifications are disabled.");
  const result = await dispatchPendingOrderNotifications(25);
  console.info(`Notification dispatcher completed: claimed=${result.claimed}, delivered=${result.delivered}, failed=${result.failed}, skipped=${result.skipped}.`);
} catch {
  console.error("Notification dispatcher failed safely. Review the server configuration and Admin status.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
