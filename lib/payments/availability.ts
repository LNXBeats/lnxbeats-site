import "server-only";

import { assertPaymentsRuntimeEnvironment } from "@/lib/payments/runtime";

export type PaymentProviderAvailability = Readonly<{
  stripe: boolean;
  paypal: boolean;
}>;

export async function paymentProvidersAvailable(): Promise<PaymentProviderAvailability> {
  try {
    const configuration = await assertPaymentsRuntimeEnvironment();
    return {
      stripe: configuration.stripe.enabled,
      paypal: configuration.paypal.enabled,
    };
  } catch {
    return { stripe: false, paypal: false };
  }
}

export async function paymentQaAvailable() {
  const providers = await paymentProvidersAvailable();
  return providers.stripe || providers.paypal;
}
