import { orderPricingForVersion } from "@/data/order-offer";
import type {
  CheckoutPaymentEvent,
  OrderPaymentSnapshot,
  PaymentMethod,
  PaymentStatus,
  ServerCheckoutLineItem,
} from "@/lib/payments/types";

export type PaymentPricingErrorCode =
  | "INVALID_CURRENCY"
  | "INVALID_PRICING_VERSION"
  | "INVALID_AMOUNT"
  | "INVALID_BASE_PRICE"
  | "INVALID_COVER_PRICE"
  | "INVALID_PRIORITY_PRICE"
  | "INVALID_TOTAL";

export type PaymentPricingValidation =
  | Readonly<{
    ok: true;
    amountCents: number;
    currency: "EUR";
    pricingVersion: string;
  }>
  | Readonly<{
    ok: false;
    code: PaymentPricingErrorCode;
  }>;

export class PaymentDomainError extends Error {
  constructor(readonly code: PaymentPricingErrorCode) {
    super("The order pricing snapshot is not eligible for payment.");
    this.name = "PaymentDomainError";
  }
}

function hasSafeAmounts(snapshot: OrderPaymentSnapshot) {
  return [
    snapshot.basePriceCents,
    snapshot.coverPriceCents,
    snapshot.priorityPriceCents,
    snapshot.totalCents,
  ].every(Number.isSafeInteger);
}

export function validateOrderPaymentSnapshot(
  snapshot: OrderPaymentSnapshot,
): PaymentPricingValidation {
  const pricing = orderPricingForVersion(snapshot.pricingVersion);
  if (!pricing) {
    return { ok: false, code: "INVALID_PRICING_VERSION" };
  }
  if (snapshot.currency !== pricing.currency) {
    return { ok: false, code: "INVALID_CURRENCY" };
  }
  if (
    !hasSafeAmounts(snapshot)
    || snapshot.basePriceCents <= 0
    || snapshot.coverPriceCents < 0
    || snapshot.priorityPriceCents < 0
    || snapshot.totalCents <= 0
  ) {
    return { ok: false, code: "INVALID_AMOUNT" };
  }
  if (snapshot.basePriceCents !== pricing.personalBaseCents) {
    return { ok: false, code: "INVALID_BASE_PRICE" };
  }

  const expectedCoverPrice = snapshot.coverIncluded ? pricing.coverCents : 0;
  if (snapshot.coverPriceCents !== expectedCoverPrice) {
    return { ok: false, code: "INVALID_COVER_PRICE" };
  }

  const expectedPriorityPrice = snapshot.priorityProcessing ? pricing.priorityCents : 0;
  if (snapshot.priorityPriceCents !== expectedPriorityPrice) {
    return { ok: false, code: "INVALID_PRIORITY_PRICE" };
  }

  if (
    snapshot.totalCents
    !== snapshot.basePriceCents + snapshot.coverPriceCents + snapshot.priorityPriceCents
  ) {
    return { ok: false, code: "INVALID_TOTAL" };
  }

  return {
    ok: true,
    amountCents: snapshot.totalCents,
    currency: "EUR",
    pricingVersion: snapshot.pricingVersion,
  };
}

function checkoutLineItem(name: string, unitAmount: number): ServerCheckoutLineItem {
  return {
    quantity: 1,
    price_data: {
      currency: "eur",
      unit_amount: unitAmount,
      product_data: { name },
    },
  };
}

export function checkoutLineItemsFromOrderSnapshot(
  snapshot: OrderPaymentSnapshot,
): readonly ServerCheckoutLineItem[] {
  const validation = validateOrderPaymentSnapshot(snapshot);
  if (!validation.ok) throw new PaymentDomainError(validation.code);

  const lineItems: ServerCheckoutLineItem[] = [
    checkoutLineItem("Création musicale personnalisée LNX Beats", snapshot.basePriceCents),
  ];
  if (snapshot.coverIncluded) {
    lineItems.push(checkoutLineItem("Illustration personnalisée", snapshot.coverPriceCents));
  }
  if (snapshot.priorityProcessing) {
    lineItems.push(checkoutLineItem("Traitement prioritaire", snapshot.priorityPriceCents));
  }
  return lineItems;
}

export function normalizePaymentMethod(value: unknown): PaymentMethod {
  if (typeof value !== "string") return "OTHER";
  switch (value.trim().toLowerCase()) {
    case "card": return "CARD";
    case "paypal": return "PAYPAL";
    case "wero": return "WERO";
    default: return "OTHER";
  }
}

function checkoutEventTargetStatus(event: CheckoutPaymentEvent): PaymentStatus {
  switch (event.type) {
    case "checkout.session.completed":
      return event.paymentStatus === "paid" ? "SUCCEEDED" : "PENDING";
    case "checkout.session.async_payment_succeeded":
      return "SUCCEEDED";
    case "checkout.session.async_payment_failed":
      return "FAILED";
    case "checkout.session.expired":
      return "EXPIRED";
  }
}

export function nextPaymentStatusFromCheckoutEvent(
  currentStatus: PaymentStatus,
  event: CheckoutPaymentEvent,
): PaymentStatus {
  if (currentStatus === "REFUNDED") return "REFUNDED";

  const targetStatus = checkoutEventTargetStatus(event);
  if (targetStatus === "SUCCEEDED") return "SUCCEEDED";
  if (currentStatus === "SUCCEEDED") return "SUCCEEDED";

  if (targetStatus === "PENDING") {
    return currentStatus === "CREATED" ? "PENDING" : currentStatus;
  }

  return currentStatus === "CREATED" || currentStatus === "PENDING"
    ? targetStatus
    : currentStatus;
}
