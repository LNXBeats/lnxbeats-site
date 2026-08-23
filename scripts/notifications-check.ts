import { notificationHealthSummary, parseNotificationConfiguration } from "@/lib/notifications/config";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

try {
  const configuration = parseNotificationConfiguration();
  assertDatabaseConfigured();
  const now = new Date();
  const [pending, retryable, finalFailures, suppressed, expiredLeases, reviewEvents, foreignEnvironment] = await Promise.all([
    prisma.orderNotification.count({ where: { deploymentEnvironment: configuration.deploymentEnvironment, status: "PENDING" } }),
    prisma.orderNotification.count({ where: { deploymentEnvironment: configuration.deploymentEnvironment, status: "FAILED_RETRYABLE" } }),
    prisma.orderNotification.count({ where: { deploymentEnvironment: configuration.deploymentEnvironment, status: "FAILED_FINAL" } }),
    prisma.notificationSuppression.count({ where: { active: true } }),
    prisma.orderNotification.count({ where: { deploymentEnvironment: configuration.deploymentEnvironment, status: "PROCESSING", leaseExpiresAt: { lte: now } } }),
    prisma.notificationEvent.count({ where: { outcome: "REQUIRES_REVIEW" } }),
    prisma.orderNotification.count({
      where: {
        deploymentEnvironment: { not: configuration.deploymentEnvironment },
        status: { in: ["PENDING", "FAILED_RETRYABLE", "PROCESSING"] },
      },
    }),
  ]);
  const health = notificationHealthSummary(configuration);
  console.info(`Notifications configuration: email=${health.emailTransport}, configured=${health.emailConfigured}, enabled=${health.emailEnabled}, sms=${health.smsTransport}, workerEnabled=${health.workerEnabled}, workerConfigured=${health.workerConfigured}, webhookConfigured=${health.webhookConfigured}.`);
  console.info(`Outbox: pending=${pending}, retryable=${retryable}, final=${finalFailures}, suppressed=${suppressed}.`);
  console.info(`Reconciliation: expiredLeases=${expiredLeases}, requiresReview=${reviewEvents}, foreignEnvironment=${foreignEnvironment}.`);
  console.info(`Owner destination configured: ${Boolean(configuration.ownerRecipient)}.`);
} catch {
  console.error("Notifications diagnostic failed safely. No secret was printed.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
