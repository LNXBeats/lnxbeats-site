export type OrderNotificationKind =
  | "OWNER_NEW_ORDER"
  | "CUSTOMER_DELIVERY_READY"
  | "OWNER_RIGHTS_REQUESTED"
  | "CUSTOMER_RIGHTS_INFORMATION_REQUIRED"
  | "CUSTOMER_RIGHTS_PREAUTHORIZATION_READY"
  | "CUSTOMER_RIGHTS_CONTRACT_READY"
  | "OWNER_RIGHTS_CLIENT_ACCEPTED"
  | "CUSTOMER_RIGHTS_REJECTED"
  | "CUSTOMER_RIGHTS_READY_FOR_PAYMENT";
export type NotificationChannel = "EMAIL" | "SMS";

export type OrderNotificationMessage = Readonly<{
  id: string;
  kind: OrderNotificationKind;
  channel: NotificationChannel;
  recipient: string | null;
  idempotencyKey: string;
  order: Readonly<{
    orderNumber: string;
    customerName: string | null;
    customerEmail: string;
    totalCents: number;
    currency: string;
    coverIncluded: boolean;
    priorityProcessing: boolean;
    createdAt: Date;
  }>;
}>;

export type NotificationTemplate = Readonly<{
  subject: string;
  text: string;
  html: string;
}>;
