import type { PaymentMethod, PaymentProvider, PersistedPaymentMode } from "@/lib/payments/types";

export const SHOP_PAYMENT_PRICING_VERSION = "shop-order-v1" as const;

export type ShopPaymentActor = Readonly<{
  id: string;
  email: string;
  role: "MEMBER" | "CUSTOMER" | "ADMIN";
  status: "ACTIVE";
  emailVerified: true;
}>;

export type ShopCheckoutLine = Readonly<{
  productId: string;
  title: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}>;

export type ReservedShopPaymentAttempt = Readonly<{
  shopOrderId: string;
  orderNumber: string;
  paymentId: string;
  provider: PaymentProvider;
  mode: PersistedPaymentMode;
  idempotencyKey: string;
  providerCheckoutId?: string;
  amountCents: number;
  shippingCents: number;
  currency: "EUR";
  pricingVersion: typeof SHOP_PAYMENT_PRICING_VERSION;
  reservationExpiresAt: Date;
  lines: readonly ShopCheckoutLine[];
}>;

export type ReservedShopPaypalCapture = Readonly<{
  paymentId: string;
  shopOrderId: string;
  orderNumber: string;
  providerOrderId: string;
  captureIdempotencyKey: string;
  amountCents: number;
  currency: "EUR";
  pricingVersion: typeof SHOP_PAYMENT_PRICING_VERSION;
}>;

export type ShopPaymentProviderEvent = Readonly<{
  eventId: string;
  type: string;
  provider: PaymentProvider;
  livemode: boolean;
  paymentId: string;
  providerSourcePaymentId?: string;
  providerSourceShopOrderId?: string;
  providerCheckoutId?: string;
  providerPaymentId?: string;
  amountCents?: number;
  currency?: string;
  /** False only when the signed provider payload contradicts its own financial evidence. */
  evidenceConsistent?: boolean;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "EXPIRED";
  occurredAt: Date;
  paymentMethod?: PaymentMethod;
  failureCode?: string;
}>;

export type ShopPaymentFinalizationResult = Readonly<{
  outcome: "PROCESSED" | "IGNORED" | "REQUIRES_REVIEW";
  duplicate: boolean;
  shopOrderPaid: boolean;
  stockConfirmed: boolean;
  winningPaymentId?: string;
  reviewCode?: string;
}>;
