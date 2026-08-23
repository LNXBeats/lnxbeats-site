import { runNotificationSchedulerPreflight } from "@/lib/notifications/scheduler-preflight";
import { prisma } from "@/lib/prisma";

try {
  const result = await runNotificationSchedulerPreflight();
  for (const rule of result.rules) {
    console.info(`${rule.passed ? "PASS" : "BLOCKED"} ${rule.name}${rule.detail ? ` ${rule.detail}` : ""}`);
  }
  console.info(`INFO scheduler.outbox pending=${result.metrics.pending} retryable=${result.metrics.retryable} expiredLeases=${result.metrics.expiredLeases} requiresReview=${result.metrics.requiresReview} foreignEnvironment=${result.metrics.foreignEnvironment}`);
  console.info("MANUAL scheduler.external.configured verification-required");
  console.info(result.passed ? "PASS NOTIFICATION_SCHEDULER_PREFLIGHT" : "BLOCKED NOTIFICATION_SCHEDULER_PREFLIGHT");
  process.exitCode = result.passed ? 0 : 1;
} catch {
  console.error("Notification scheduler preflight failed safely. No secret was printed.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
