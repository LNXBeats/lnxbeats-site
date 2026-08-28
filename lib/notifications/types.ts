export type OrderNotificationKind =
  | "OWNER_NEW_ORDER"
  | "CUSTOMER_PAYMENT_CONFIRMED"
  | "CUSTOMER_ORDER_ACCEPTED"
  | "CUSTOMER_CREATION_STARTED"
  | "CUSTOMER_DELIVERY_READY"
  | "OWNER_RIGHTS_REQUESTED"
  | "CUSTOMER_RIGHTS_INFORMATION_REQUIRED"
  | "CUSTOMER_RIGHTS_PREAUTHORIZATION_READY"
  | "CUSTOMER_RIGHTS_CONTRACT_READY"
  | "OWNER_RIGHTS_CLIENT_ACCEPTED"
  | "CUSTOMER_RIGHTS_REJECTED"
  | "CUSTOMER_RIGHTS_READY_FOR_PAYMENT"
  | "CUSTOMER_PARTIAL_REFUND"
  | "CUSTOMER_REFUND_COMPLETED"
  | "OWNER_PAYMENT_INCIDENT"
  | "OWNER_SHOP_ORDER_PAID"
  | "CUSTOMER_SHOP_PAYMENT_CONFIRMED"
  | "CUSTOMER_SHOP_PREPARING"
  | "CUSTOMER_SHOP_SHIPPED";

export type NotificationChannel = "EMAIL" | "SMS";
export type NotificationPriority = "CRITICAL" | "INFORMATIONAL" | "INTERNAL";
export type NotificationProvider = "CAPTURE" | "RESEND";

export type OrderNotificationPayload = Readonly<{
  orderNumber: string;
  customerName: string | null;
  customerEmail: string;
  totalCents: number;
  currency: string;
  coverIncluded: boolean;
  priorityProcessing: boolean;
  createdAt: string;
  workTitle?: string;
  rightsRequestNumber?: string;
  rightsRequestType?: "PUBLICATION_LICENSE" | "EXPLOITATION_PARTNERSHIP";
  requestedPriceCents?: number;
  refundAmountCents?: number;
  invoiceNumber?: string;
  termsVersion?: string | null;
}>;

export type ShopNotificationItem = Readonly<{
  productTitle: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}>;

export type ShopNotificationShippingAddress = Readonly<{
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
}>;

export type ShopNotificationPayload = Readonly<{
  orderNumber: string;
  customerName: string | null;
  customerEmail: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  currency: string;
  createdAt: string;
  items: readonly ShopNotificationItem[];
  paymentProvider: "STRIPE" | "PAYPAL" | null;
  termsVersion: string | null;
  shippingAddress: ShopNotificationShippingAddress | null;
  invoiceNumber?: string;
}>;

export type NotificationPayload = OrderNotificationPayload | ShopNotificationPayload;

export type OrderNotificationSource = Readonly<{
  orderNumber: string;
  customerName: string | null;
  customerEmail: string;
  totalCents: number;
  currency: string;
  coverIncluded: boolean;
  priorityProcessing: boolean;
  createdAt: Date;
}>;

export type ShopNotificationSource = Readonly<{
  orderNumber: string;
  customerName: string | null;
  customerEmail: string;
  totalCents: number;
  currency: string;
  createdAt: Date;
}>;

export type OrderNotificationMessage = Readonly<{
  id: string;
  kind: OrderNotificationKind;
  channel: NotificationChannel;
  priority: NotificationPriority;
  recipient: string | null;
  idempotencyKey: string;
  templateKey: string;
  templateVersion: number;
  payloadVersion: number;
  payload: NotificationPayload;
  resourceType: string;
  resourceId: string | null;
  resourceReference: string | null;
  deploymentEnvironment: "development" | "staging" | "production";
  order?: OrderNotificationSource | null;
  shopOrder?: ShopNotificationSource | null;
}>;

export type NotificationTemplate = Readonly<{
  subject: string;
  text: string;
  html: string;
}>;

export type NotificationTransportResult = Readonly<{
  provider: NotificationProvider;
  providerMessageId: string;
  deliveredImmediately: boolean;
}>;

export type NotificationFailure = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;
