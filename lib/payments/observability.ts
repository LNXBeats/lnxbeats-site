import "server-only";

type PaymentLogEvent =
  | "payment.session.created"
  | "payment.session.failed"
  | "payment.webhook.received"
  | "payment.webhook.processed"
  | "payment.webhook.failed";

type PaymentLogContext = Readonly<{
  paymentId?: string;
  orderId?: string;
  providerEventId?: string;
  outcome?: string;
}>;

/**
 * Server-only structured payment logs. Context is deliberately restricted to
 * opaque internal/provider identifiers and bounded outcomes: no email, URL,
 * amount, cookie, payload or credential can be passed through this API.
 */
export function logPaymentEvent(
  event: PaymentLogEvent,
  context: PaymentLogContext = {},
) {
  console.info(JSON.stringify({ event, ...context }));
}
