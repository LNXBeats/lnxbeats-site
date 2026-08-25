import { runProductionOwnerNotificationPreflight } from "@/lib/notifications/production-preflight";
import { prisma } from "@/lib/prisma";

try {
  const result = await runProductionOwnerNotificationPreflight();
  for (const rule of result.rules) {
    console.info(`${rule.passed ? "PASS" : "BLOCKED"} ${rule.name}${rule.detail ? ` ${rule.detail}` : ""}`);
  }
  console.info(result.passed
    ? "PASS PRODUCTION_OWNER_NOTIFICATIONS_PREFLIGHT"
    : "BLOCKED PRODUCTION_OWNER_NOTIFICATIONS_PREFLIGHT");
  if (!result.passed) process.exitCode = 1;
} catch {
  console.error("BLOCKED PRODUCTION_OWNER_NOTIFICATIONS_PREFLIGHT");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
