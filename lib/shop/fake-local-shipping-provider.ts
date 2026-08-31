import { createHash } from "node:crypto";

import type {
  ShippingProviderAdapter,
  ShippingProviderCreateInput,
  ShippingProviderReconcileInput,
  ShippingProviderResult,
} from "@/lib/shop/shipping-provider";

function identity(idempotencyKey: string) {
  return createHash("sha256").update(`lnx-phase5d:${idempotencyKey}`, "utf8").digest("hex").slice(0, 20).toUpperCase();
}

function succeeded(idempotencyKey: string): ShippingProviderResult {
  const suffix = identity(idempotencyKey);
  return Object.freeze({
    status: "SUCCEEDED",
    providerShipmentId: `FAKE-SHIP-${suffix}`,
    tracking: Object.freeze({
      carrier: "Transporteur suivi QA",
      number: `LNXQA${suffix}`,
      url: `https://example.invalid/track/LNXQA${suffix}`,
    }),
    errorCode: null,
  });
}

function resultForCreate(input: ShippingProviderCreateInput): ShippingProviderResult {
  const providerShipmentId = `FAKE-SHIP-${identity(input.idempotencyKey)}`;
  if (input.scenario === "SUCCEEDED") return succeeded(input.idempotencyKey);
  if (input.scenario === "PENDING") return Object.freeze({
    status: "PENDING",
    providerShipmentId,
    tracking: null,
    errorCode: null,
  });
  if (input.scenario === "FAILED") return Object.freeze({
    status: "FAILED",
    providerShipmentId: null,
    tracking: null,
    errorCode: "FAKE_LOCAL_REQUEST_REJECTED",
  });
  return Object.freeze({
    status: "REQUIRES_REVIEW",
    providerShipmentId,
    tracking: null,
    errorCode: "AMBIGUOUS_PROVIDER_ACCEPTANCE",
  });
}

export const fakeLocalShippingProvider: ShippingProviderAdapter = Object.freeze({
  name: "FAKE_LOCAL",
  async createShipment(input: ShippingProviderCreateInput) {
    return resultForCreate(input);
  },
  async reconcileShipment(input: ShippingProviderReconcileInput) {
    if (input.scenario === "PENDING") return succeeded(input.idempotencyKey);
    if (input.scenario === "AMBIGUOUS") return Object.freeze({
      status: "REQUIRES_REVIEW",
      providerShipmentId: input.providerShipmentId,
      tracking: null,
      errorCode: "AMBIGUOUS_PROVIDER_ACCEPTANCE",
    });
    return input.scenario === "SUCCEEDED"
      ? succeeded(input.idempotencyKey)
      : Object.freeze({
          status: "FAILED",
          providerShipmentId: input.providerShipmentId,
          tracking: null,
          errorCode: "FAKE_LOCAL_REQUEST_REJECTED",
        });
  },
});
