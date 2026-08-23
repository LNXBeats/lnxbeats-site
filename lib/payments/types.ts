export type StripePaymentMode = "test" | "live";
export type PaypalPaymentEnvironment = "sandbox" | "live";
export type PaymentDeploymentEnvironment = "development" | "staging" | "production";
export type PersistedPaymentMode = "TEST" | "LIVE";

export type PaymentProvider = "STRIPE" | "PAYPAL";

export type PaymentStatus =
  | "CREATED"
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED"
  | "EXPIRED"
  | "REFUND_PENDING"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "REQUIRES_REVIEW";

export type PaymentMethod = "CARD" | "PAYPAL" | "WERO" | "OTHER";

export type OrderPaymentSnapshot = {
  coverIncluded: boolean;
  priorityProcessing: boolean;
  basePriceCents: number;
  coverPriceCents: number;
  priorityPriceCents: number;
  totalCents: number;
  currency: string;
  pricingVersion: string;
};

export type ServerCheckoutLineItem = Readonly<{
  quantity: 1;
  price_data: Readonly<{
    currency: "eur";
    unit_amount: number;
    product_data: Readonly<{
      name: string;
    }>;
  }>;
}>;

export type CheckoutPaymentEvent =
  | Readonly<{
    type: "checkout.session.completed";
    paymentStatus: "paid" | "unpaid";
  }>
  | Readonly<{
    type: "checkout.session.async_payment_succeeded";
  }>
  | Readonly<{
    type: "checkout.session.async_payment_failed";
  }>
  | Readonly<{
    type: "checkout.session.expired";
  }>;

export type StripePaymentConfiguration =
  | Readonly<{
    provider: "stripe";
    enabled: false;
    configured: boolean;
    mode: "disabled" | StripePaymentMode;
    apiVersion: "2026-07-29.dahlia";
  }>
  | Readonly<{
    provider: "stripe";
    enabled: true;
    configured: true;
    mode: StripePaymentMode;
    apiVersion: "2026-07-29.dahlia";
    secretKey: string;
    webhookSecret: string;
    publishableKey?: string;
  }>;

/** @deprecated Prefer StripePaymentConfiguration in new provider-neutral code. */
export type PaymentConfiguration = StripePaymentConfiguration;

export type PaypalPaymentConfiguration =
  | Readonly<{
    provider: "paypal";
    enabled: false;
    configured: boolean;
    environment: "disabled" | PaypalPaymentEnvironment;
  }>
  | Readonly<{
    provider: "paypal";
    enabled: true;
    configured: true;
    environment: PaypalPaymentEnvironment;
    clientId: string;
    clientSecret: string;
    webhookId: string;
  }>;

export type PaymentsConfiguration = Readonly<{
  enabled: boolean;
  deploymentEnvironment: PaymentDeploymentEnvironment;
  stripe: StripePaymentConfiguration;
  paypal: PaypalPaymentConfiguration;
}>;

export type StripePaymentHealthSummary = Readonly<{
  provider: "stripe";
  enabled: boolean;
  configured: boolean;
  mode: "disabled" | StripePaymentMode;
  apiVersion: "2026-07-29.dahlia";
}>;

/** @deprecated Prefer StripePaymentHealthSummary in new provider-neutral code. */
export type PaymentHealthSummary = StripePaymentHealthSummary;

export type PaypalPaymentHealthSummary = Readonly<{
  provider: "paypal";
  enabled: boolean;
  configured: boolean;
  environment: "disabled" | PaypalPaymentEnvironment;
}>;

export type PaymentsHealthSummary = Readonly<{
  enabled: boolean;
  deploymentEnvironment: PaymentDeploymentEnvironment;
  providers: Readonly<{
    stripe: StripePaymentHealthSummary;
    paypal: PaypalPaymentHealthSummary;
  }>;
}>;
