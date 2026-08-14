export type OrderNotificationKind = "OWNER_NEW_ORDER" | "CUSTOMER_DELIVERY_READY";
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
