import { notificationHealthSummary, parseNotificationConfiguration } from "@/lib/notifications/config";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

try {
  const configuration = parseNotificationConfiguration();
  assertDatabaseConfigured();
  const [pending, retryable, finalFailures, suppressed] = await Promise.all([
    prisma.orderNotification.count({ where: { status: "PENDING" } }),
    prisma.orderNotification.count({ where: { status: "FAILED_RETRYABLE" } }),
    prisma.orderNotification.count({ where: { status: "FAILED_FINAL" } }),
    prisma.notificationSuppression.count({ where: { active: true } }),
  ]);
  const health = notificationHealthSummary(configuration);
  console.info(`Notifications configuration: email=${health.emailTransport}, configured=${health.emailConfigured}, sms=${health.smsTransport}, worker=${health.workerConfigured}.`);
  console.info(`Outbox: pending=${pending}, retryable=${retryable}, final=${finalFailures}, suppressed=${suppressed}.`);
  console.info(`Webhook configured: ${configuration.webhookConfigured}. Owner destination configured: ${Boolean(configuration.ownerRecipient)}.`);
} catch {
  console.error("Notifications diagnostic failed safely. No secret was printed.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
