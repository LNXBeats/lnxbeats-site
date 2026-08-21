import "server-only";

import { NextResponse } from "next/server";

import { validateMediaStorageConfiguration } from "@/lib/media/storage/config";
import {
  parsePaymentsConfiguration,
  paymentsHealthSummary,
} from "@/lib/payments/config";
import { assertPaymentsRuntimeEnvironment } from "@/lib/payments/runtime";
import { notificationHealthSummary, parseNotificationConfiguration } from "@/lib/notifications/config";

export type HealthDependencies = Readonly<{
  assertPaymentRuntime(): Promise<void>;
}>;

const healthDependencies: HealthDependencies = {
  assertPaymentRuntime: async () => {
    await assertPaymentsRuntimeEnvironment();
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
    const configuration = parsePaymentsConfiguration();
    if (configuration.enabled) {
      await dependencies.assertPaymentRuntime();
    }
    payments = paymentsHealthSummary(configuration);
  } catch {
    return NextResponse.json(
      { ok: false, service: "lnx-studio", check: "payments" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  let notifications;
  try {
    notifications = notificationHealthSummary(parseNotificationConfiguration());
  } catch {
    return NextResponse.json(
      { ok: false, service: "lnx-studio", check: "notifications" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { ok: true, service: "lnx-studio", mediaStorage, payments, notifications },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
