import "server-only";

import { NextResponse } from "next/server";

import { validateMediaStorageConfiguration } from "@/lib/media/storage/config";
import {
  assertPaymentServerEnvironment,
  parsePaymentConfiguration,
  paymentHealthSummary,
} from "@/lib/payments/config";
import { loadAndAssertPaymentQaRuntimeEnvironment } from "@/lib/payments/qa-guard";

export type HealthDependencies = Readonly<{
  assertPaymentQaRuntime(): Promise<void>;
}>;

const healthDependencies: HealthDependencies = {
  assertPaymentQaRuntime: async () => {
    await loadAndAssertPaymentQaRuntimeEnvironment();
  },
};

export async function healthResponse(
  dependencies: HealthDependencies = healthDependencies,
) {
  let mediaStorage;
  try {
    mediaStorage = validateMediaStorageConfiguration();
  } catch {
    return NextResponse.json(
      { ok: false, service: "lnx-studio", check: "media-storage" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  let payments;
  try {
    const configuration = parsePaymentConfiguration();
    if (configuration.enabled) {
      await dependencies.assertPaymentQaRuntime();
    }
    payments = paymentHealthSummary(configuration.enabled
      ? assertPaymentServerEnvironment()
      : configuration);
  } catch {
    return NextResponse.json(
      { ok: false, service: "lnx-studio", check: "payments" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { ok: true, service: "lnx-studio", mediaStorage, payments },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
