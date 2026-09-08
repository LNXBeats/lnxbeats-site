import type { PaymentMethod, PaymentProvider, PersistedPaymentMode } from "@/lib/payments/types";

export type RightsPaymentActor = Readonly<{
  id: string;
  email: string;
  role: "MEMBER" | "CUSTOMER" | "ADMIN";
  status: "ACTIVE";
  emailVerified: true;
}>;

export type ReservedRightsPaymentAttempt = Readonly<{
  rightsRequestId: string;
  requestNumber: string;
  orderId: string;
  orderNumber: string;
  workTitle: string;
  paymentId: string;
  provider: PaymentProvider;
  mode: PersistedPaymentMode;
  idempotencyKey: string;
  providerCheckoutId?: string;
  amountCents: 15000;
  currency: "EUR";
  pricingVersion: string;
}>;

export type RightsProviderEvent = Readonly<{
  eventId: string;
  type: string;
  provider: PaymentProvider;
  livemode: boolean;
  paymentId: string;
  providerCheckoutId?: string;
  providerPaymentId?: string;
  amountCents?: number;
  currency?: string;
  status: "APPROVED" | "PENDING" | "SUCCEEDED" | "FAILED";
  occurredAt: Date;
  paymentMethod?: PaymentMethod;
  evidenceConsistent?: boolean;
}>;

export type RightsPaymentResult = Readonly<{
  outcome: "PROCESSED" | "IGNORED" | "REQUIRES_REVIEW";
  duplicate: boolean;
  paid: boolean;
  waitingWithdrawal: boolean;
  winningPaymentId?: string;
  reviewCode?: string;
}>;
