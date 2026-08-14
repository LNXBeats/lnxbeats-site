export type StripePaymentMode = "test";

export type PaymentProvider = "STRIPE";

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

export type PaymentConfiguration =
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

export type PaymentHealthSummary = Readonly<{
  provider: "stripe";
  enabled: boolean;
  configured: boolean;
  mode: "disabled" | StripePaymentMode;
  apiVersion: "2026-07-29.dahlia";
}>;
