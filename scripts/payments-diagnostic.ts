import {
  formatPaymentDiagnostic,
  runPaymentDiagnostic,
} from "@/lib/payments/production-diagnostic";
import { prisma } from "@/lib/prisma";

try {
  const result = await runPaymentDiagnostic();
  console.info(formatPaymentDiagnostic(result));
  if (result.status === "INVALID") process.exitCode = 1;
} catch {
  console.error("PAYMENTS_DIAGNOSTIC\nstatus=INVALID");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
