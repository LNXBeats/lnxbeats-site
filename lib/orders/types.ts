import type { OrderDraftInput } from "@/lib/orders/domain";
import type { KnownOrderStatus } from "@/lib/orders/status";
import type {
  CommercialLicensePaymentStatus,
  CommercialLicenseStatus,
  OrderUsage,
} from "@/data/order-offer";

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

export type SerializedCommercialLicense = {
  id: string;
  status: CommercialLicenseStatus;
  priceCents: number;
  currency: string;
  pricingVersion: string;
  contractRequired: boolean;
  contractAcceptedAt: string | null;
  paymentStatus: CommercialLicensePaymentStatus;
  requestedAt: string;
  approvedAt: string | null;
  activatedAt: string | null;
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
  commercialLicenses: SerializedCommercialLicense[];
};
