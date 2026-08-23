import { runProductionPaymentPreflight } from "@/lib/payments/production-preflight";
import { prisma } from "@/lib/prisma";

try {
  const result = await runProductionPaymentPreflight();
  for (const item of result.rules) {
    console.info(`${item.passed ? "PASS" : "BLOCKED"} ${item.name}${item.detail ? ` ${item.detail}` : ""}`);
  }
  console.info(`${result.passed ? "PASS" : "BLOCKED"} PRODUCTION_PAYMENTS_PREFLIGHT ${result.status}`);
  if (!result.passed) process.exitCode = 1;
} catch {
  console.error("BLOCKED PRODUCTION_PAYMENTS_PREFLIGHT");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
