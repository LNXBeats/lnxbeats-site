import "server-only";

import { assertPaymentServerEnvironment } from "@/lib/payments/config";
import { loadAndAssertPaymentQaRuntimeEnvironment } from "@/lib/payments/qa-guard";

export async function paymentQaAvailable() {
  try {
    await loadAndAssertPaymentQaRuntimeEnvironment();
    const configuration = assertPaymentServerEnvironment();
    return configuration.enabled && configuration.mode === "test";
  } catch {
    return false;
  }
}
