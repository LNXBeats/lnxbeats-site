import type { PaymentStatus, PersistedPaymentMode } from "@/lib/payments/types";
import type { ShopPaymentProviderEvent } from "@/lib/shop/payment-types";
import { SHOP_PAYMENT_PRICING_VERSION } from "@/lib/shop/payment-types";

export type ShopPaymentReconciliationSnapshot = Readonly<{
  payment: Readonly<{
    id: string;
    orderId: string | null;
    shopOrderId: string | null;
    provider: "STRIPE" | "PAYPAL";
    mode: PersistedPaymentMode;
    status: PaymentStatus;
    amountCents: number;
    currency: string;
    pricingVersion: string;
    providerCheckoutId: string | null;
    providerPaymentId: string | null;
    paidAt: Date | null;
  }>;
  shopOrder: Readonly<{
    id: string;
    totalCents: number;
    currency: string;
    status: "OPEN" | "EXPIRED" | "CANCELLED";
    paymentStatus: "AWAITING_PAYMENT" | "PAID" | "CANCELLED";
    paymentReviewAt: Date | null;
    paymentReviewCode: string | null;
  }>;
  event: ShopPaymentProviderEvent;
  providerIdentifiersBelongToAnotherPayment: boolean;
  shopOrderSnapshotValid: boolean;
  otherWinningPaymentId?: string;
  reservationValid: boolean;
}>;

export type ShopPaymentReconciliationPlan =
  | Readonly<{ action: "REVIEW_EVIDENCE"; reviewCode: "SHOP_PAYMENT_EVIDENCE_MISMATCH"; captured: boolean }>
  | Readonly<{ action: "RECORD_PENDING" }>
  | Readonly<{ action: "RECORD_FAILURE" }>
  | Readonly<{ action: "IGNORE_TERMINAL_FAILURE" }>
  | Readonly<{ action: "REVIEW_OTHER_WINNER"; reviewCode: "SHOP_PAYMENT_ALREADY_CAPTURED"; captured: true; winningPaymentId: string }>
  | Readonly<{ action: "REPLAY_SUCCESS"; requiresReview: boolean; reviewCode?: string }>
  | Readonly<{ action: "REVIEW_OPEN"; reviewCode: string; captured: true }>
  | Readonly<{ action: "REVIEW_TERMINAL"; reviewCode: "SHOP_PAYMENT_TERMINAL_CAPTURE"; captured: true }>
  | Readonly<{ action: "REVIEW_EXPIRED"; reviewCode: "SHOP_RESERVATION_EXPIRED_AFTER_CAPTURE"; captured: true }>
  | Readonly<{ action: "CHECK_STOCK" }>;

const financiallySuccessful = new Set<PaymentStatus>([
  "SUCCEEDED",
  "REFUND_PENDING",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);

export function planShopPaymentReconciliation(
  snapshot: ShopPaymentReconciliationSnapshot,
): ShopPaymentReconciliationPlan {
  const { event, payment, shopOrder } = snapshot;
  const expectedMode: PersistedPaymentMode = event.livemode ? "LIVE" : "TEST";
  const sourceMismatch = Boolean(
    payment.orderId
    || payment.shopOrderId !== shopOrder.id
    || (event.providerSourcePaymentId !== undefined && event.providerSourcePaymentId !== payment.id)
    || (event.providerSourceShopOrderId !== undefined && event.providerSourceShopOrderId !== shopOrder.id)
    || payment.provider !== event.provider
    || payment.mode !== expectedMode
    || payment.pricingVersion !== SHOP_PAYMENT_PRICING_VERSION
    || payment.amountCents !== shopOrder.totalCents
    || payment.currency !== shopOrder.currency
    || !snapshot.shopOrderSnapshotValid
    || event.evidenceConsistent === false
    || (event.amountCents !== undefined && event.amountCents !== payment.amountCents)
    || (event.currency !== undefined && event.currency !== payment.currency)
    || (event.providerCheckoutId !== undefined && payment.providerCheckoutId !== event.providerCheckoutId)
    || (payment.providerPaymentId && event.providerPaymentId && payment.providerPaymentId !== event.providerPaymentId)
    || snapshot.providerIdentifiersBelongToAnotherPayment
  );
  const successfulEvidenceMismatch = event.status === "SUCCEEDED" && (
    !event.providerCheckoutId
    || !event.providerPaymentId
    || event.amountCents === undefined
    || event.currency === undefined
    || !event.paymentMethod
  );
  if (sourceMismatch || successfulEvidenceMismatch) {
    return {
      action: "REVIEW_EVIDENCE",
      reviewCode: "SHOP_PAYMENT_EVIDENCE_MISMATCH",
      captured: event.status === "SUCCEEDED",
    };
  }
  if (event.status === "SUCCEEDED" && snapshot.otherWinningPaymentId) {
    return {
      action: "REVIEW_OTHER_WINNER",
      reviewCode: "SHOP_PAYMENT_ALREADY_CAPTURED",
      captured: true,
      winningPaymentId: snapshot.otherWinningPaymentId,
    };
  }
  if (event.status === "PENDING") return { action: "RECORD_PENDING" };
  if (event.status === "FAILED" || event.status === "EXPIRED") {
    return financiallySuccessful.has(payment.status) || payment.paidAt !== null
      ? { action: "IGNORE_TERMINAL_FAILURE" }
      : { action: "RECORD_FAILURE" };
  }
  if (payment.status === "SUCCEEDED") {
    const requiresReview = shopOrder.paymentStatus !== "PAID" || shopOrder.paymentReviewAt !== null;
    return {
      action: "REPLAY_SUCCESS",
      requiresReview,
      ...(requiresReview
        ? { reviewCode: shopOrder.paymentReviewCode ?? "SHOP_PAYMENT_TERMINAL_CAPTURE" }
        : {}),
    };
  }
  if (event.status === "SUCCEEDED" && shopOrder.paymentReviewAt) {
    return {
      action: "REVIEW_OPEN",
      reviewCode: shopOrder.paymentReviewCode ?? "SHOP_PAYMENT_TERMINAL_CAPTURE",
      captured: true,
    };
  }
  if (!["CREATED", "PENDING", "FAILED", "EXPIRED", "CANCELED"].includes(payment.status)) {
    return {
      action: "REVIEW_TERMINAL",
      reviewCode: "SHOP_PAYMENT_TERMINAL_CAPTURE",
      captured: true,
    };
  }
  if (
    shopOrder.status !== "OPEN"
    || shopOrder.paymentStatus !== "AWAITING_PAYMENT"
    || !snapshot.reservationValid
  ) {
    return {
      action: "REVIEW_EXPIRED",
      reviewCode: "SHOP_RESERVATION_EXPIRED_AFTER_CAPTURE",
      captured: true,
    };
  }
  return { action: "CHECK_STOCK" };
}
