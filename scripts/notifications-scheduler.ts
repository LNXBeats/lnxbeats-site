import { runNotificationSchedulerTick } from "@/lib/notifications/scheduler";
import { prisma } from "@/lib/prisma";

try {
  const result = await runNotificationSchedulerTick();
  process.exitCode = result.exitCode;
} finally {
  await prisma.$disconnect();
}
