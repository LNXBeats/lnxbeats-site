import type { OrderDraftInput } from "@/lib/orders/domain";
import type { KnownOrderStatus } from "@/lib/orders/status";
import type { OrderUsage } from "@/data/order-offer";
import type { PaymentMethod, PaymentStatus } from "@/lib/payments/types";

export type SerializedOrderEvent = {
  id: string;
  fromStatus: KnownOrderStatus | null;
  toStatus: KnownOrderStatus;
  note: string | null;
  createdAt: string;
};
export type SerializedOrderPhoto = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  position: number;
};

export type SerializedOrderDelivery = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  createdAt: string;
};

export type SerializedOrderPayment = {
  id: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  paymentMethod: PaymentMethod | null;
  checkoutExpiresAt: string | null;
  paidAt: string | null;
  failedAt: string | null;
  expiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SerializedOrder = OrderDraftInput & {
  orderNumber: string;
  status: KnownOrderStatus;
  usage: OrderUsage;
  customerEmail: string;
  customerName: string | null;
  basePriceCents: number;
  coverPriceCents: number;
  priorityPriceCents: number;
  totalCents: number;
  currency: string;
  pricingVersion: string;
  personalUseTermsVersion: string | null;
  personalUseTermsHashSha256: string | null;
  personalUseTermsAcceptedAt: string | null;
  contractRequired: boolean;
  revisionAllowance: number;
  revisionUsed: number;
  submittedAt: string | null;
  deliveredAt: string | null;
  downloadExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  events: SerializedOrderEvent[];
  photos: SerializedOrderPhoto[];
  delivery: SerializedOrderDelivery | null;
  payments: SerializedOrderPayment[];
};
