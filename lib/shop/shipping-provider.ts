export type ShippingProviderScenario = "SUCCEEDED" | "PENDING" | "FAILED" | "AMBIGUOUS";
export type ShippingProviderResultStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "REQUIRES_REVIEW";

export type ShippingProviderCreateInput = Readonly<{
  orderNumber: string;
  idempotencyKey: string;
  scenario: ShippingProviderScenario;
  service: string;
  billableGrams: number;
  destination: Readonly<{
    countryCode: string;
    postalCode: string;
  }>;
}>;

export type ShippingProviderReconcileInput = Readonly<{
  orderNumber: string;
  idempotencyKey: string;
  providerShipmentId: string;
  scenario: ShippingProviderScenario;
}>;

export type ShippingProviderResult = Readonly<{
  status: ShippingProviderResultStatus;
  providerShipmentId: string | null;
  tracking: Readonly<{
    carrier: string;
    number: string;
    url: string;
  }> | null;
  errorCode: string | null;
}>;

export interface ShippingProviderAdapter {
  readonly name: "FAKE_LOCAL";
  createShipment(input: ShippingProviderCreateInput): Promise<ShippingProviderResult>;
  reconcileShipment(input: ShippingProviderReconcileInput): Promise<ShippingProviderResult>;
}

export class ShippingProviderAdapterError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_REQUEST" | "UNEXPECTED_RESPONSE" | "RESPONSE_UNCERTAIN",
  ) {
    super(message);
    this.name = "ShippingProviderAdapterError";
  }
}
