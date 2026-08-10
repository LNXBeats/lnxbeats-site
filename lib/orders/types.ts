import type { OrderDraftInput } from "@/lib/orders/domain";
import type { KnownOrderStatus } from "@/lib/orders/status";

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

export type SerializedOrder = OrderDraftInput & {
  orderNumber: string;
  status: KnownOrderStatus;
  customerEmail: string;
  customerName: string | null;
  basePriceCents: number;
  coverPriceCents: number;
  priorityPriceCents: number;
  totalCents: number;
  currency: string;
  pricingVersion: string;
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
};
