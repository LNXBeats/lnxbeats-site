export const SHOP_RETURN_REQUEST_CONFIRMATION = "CONFIRM_SHOP_RETURN_REQUEST";
export const SHOP_RETURN_APPROVAL_CONFIRMATION = "CONFIRM_SHOP_RETURN_APPROVAL";
export const SHOP_RETURN_REJECTION_CONFIRMATION = "CONFIRM_SHOP_RETURN_REJECTION";
export const SHOP_RETURN_RECEIPT_CONFIRMATION = "CONFIRM_SHOP_RETURN_RECEIPT";
export const SHOP_RETURN_INSPECTION_CONFIRMATION = "CONFIRM_SHOP_RETURN_INSPECTION";
export const SHOP_RETURN_REFUND_CONFIRMATION = "CONFIRM_SHOP_RETURN_REFUND_FAKE_QA";
export const SHOP_RETURN_RESTOCK_CONFIRMATION = "CONFIRM_SHOP_RETURN_RESTOCK";
export const SHOP_RETURN_CLOSE_CONFIRMATION = "CONFIRM_SHOP_RETURN_CLOSE";
export const SHOP_RETURN_CANCEL_CONFIRMATION = "CONFIRM_SHOP_RETURN_CANCELLATION";

export type ShopReturnType =
  | "WITHDRAWAL"
  | "DEFECTIVE"
  | "NON_CONFORMING"
  | "DAMAGED"
  | "LOGISTICS_INCIDENT"
  | "OTHER";

export type ShopReturnStatus =
  | "REQUESTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "AWAITING_RETURN"
  | "RETURN_RECEIVED"
  | "INSPECTED"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "CLOSED"
  | "CANCELLED";

export type ShopReturnInspectionCondition = "SEALED" | "UNSEALED" | "DAMAGED" | "DEFECTIVE" | "OTHER";
export type ShopReturnRestockDecision = "RESTOCKABLE" | "NOT_RESTOCKABLE";

const requestNumberPattern = /^LNX-SAV-\d{4}-[A-F0-9]{12}$/;
const orderNumberPattern = /^LNX-SHOP-\d{4}-\d{6}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const returnTypes = new Set<ShopReturnType>(["WITHDRAWAL", "DEFECTIVE", "NON_CONFORMING", "DAMAGED", "LOGISTICS_INCIDENT", "OTHER"]);
const conditions = new Set<ShopReturnInspectionCondition>(["SEALED", "UNSEALED", "DAMAGED", "DEFECTIVE", "OTHER"]);

export class ShopAfterSalesError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 503,
    readonly code:
      | "ACCESS_DENIED"
      | "INVALID_REQUEST"
      | "ORDER_NOT_ELIGIBLE"
      | "RETURN_NOT_FOUND"
      | "INVALID_TRANSITION"
      | "QUANTITY_EXCEEDED"
      | "QUANTITY_REQUIRED"
      | "REFUND_EXCEEDED"
      | "REFUND_REQUIRES_REVIEW"
      | "RESTOCK_NOT_ALLOWED"
      | "QA_DISABLED",
  ) {
    super("La demande SAV ne peut pas être traitée.");
    this.name = "ShopAfterSalesError";
  }
}

function text(value: unknown, maximum: number, required = true) {
  if (typeof value !== "string") throw new ShopAfterSalesError(400, "INVALID_REQUEST");
  const normalized = value.trim().replace(/\s+/g, " ");
  if ((required && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ShopAfterSalesError(400, "INVALID_REQUEST");
  }
  return normalized || null;
}

function positiveQuantity(value: unknown, allowZero = false) {
  const parsed = typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < (allowZero ? 0 : 1) || Number(parsed) > 999) {
    throw new ShopAfterSalesError(400, "INVALID_REQUEST");
  }
  return Number(parsed);
}

export function parseShopReturnRequestNumber(value: unknown) {
  const normalized = text(value, 32);
  if (!normalized || !requestNumberPattern.test(normalized)) throw new ShopAfterSalesError(400, "INVALID_REQUEST");
  return normalized;
}

export function parseMemberShopReturnForm(formData: FormData) {
  const orderNumber = text(formData.get("orderNumber"), 32);
  const type = text(formData.get("type"), 40);
  if (!orderNumber || !orderNumberPattern.test(orderNumber) || !type || !returnTypes.has(type as ShopReturnType)) {
    throw new ShopAfterSalesError(400, "INVALID_REQUEST");
  }
  if (formData.get("confirmation") !== SHOP_RETURN_REQUEST_CONFIRMATION) {
    throw new ShopAfterSalesError(400, "INVALID_REQUEST");
  }
  const quantities = new Map<string, number>();
  const allowed = new Set(["orderNumber", "type", "comment", "confirmation"]);
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("quantity:")) {
      if (!allowed.has(name)) throw new ShopAfterSalesError(400, "INVALID_REQUEST");
      continue;
    }
    const productId = name.slice("quantity:".length);
    if (!uuidPattern.test(productId) || quantities.has(productId)) throw new ShopAfterSalesError(400, "INVALID_REQUEST");
    const quantity = positiveQuantity(value, true);
    if (quantity > 0) quantities.set(productId, quantity);
  }
  if (quantities.size < 1 || quantities.size > 50) throw new ShopAfterSalesError(400, "INVALID_REQUEST");
  return Object.freeze({
    orderNumber,
    type: type as ShopReturnType,
    comment: text(formData.get("comment") ?? "", 1000, false),
    quantities,
  });
}

export function parseQuantityMap(formData: FormData, prefix: string, maximumLines = 50) {
  const quantities = new Map<string, number>();
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(prefix)) continue;
    const productId = name.slice(prefix.length);
    if (!uuidPattern.test(productId) || quantities.has(productId)) throw new ShopAfterSalesError(400, "INVALID_REQUEST");
    quantities.set(productId, positiveQuantity(value, true));
  }
  if (quantities.size < 1 || quantities.size > maximumLines) throw new ShopAfterSalesError(400, "INVALID_REQUEST");
  return quantities;
}

export function parseInspectionCondition(value: unknown) {
  const normalized = text(value, 32);
  if (!normalized || !conditions.has(normalized as ShopReturnInspectionCondition)) {
    throw new ShopAfterSalesError(400, "INVALID_REQUEST");
  }
  return normalized as ShopReturnInspectionCondition;
}

export function parseRestockDecision(value: unknown) {
  if (value !== "RESTOCKABLE" && value !== "NOT_RESTOCKABLE") {
    throw new ShopAfterSalesError(400, "INVALID_REQUEST");
  }
  return value as ShopReturnRestockDecision;
}

export function assertTransition(from: ShopReturnStatus, to: ShopReturnStatus) {
  const allowed: Record<ShopReturnStatus, readonly ShopReturnStatus[]> = {
    REQUESTED: ["UNDER_REVIEW", "APPROVED", "AWAITING_RETURN", "REJECTED", "CANCELLED"],
    UNDER_REVIEW: ["APPROVED", "AWAITING_RETURN", "REJECTED"],
    APPROVED: ["REFUND_PENDING", "CLOSED"],
    REJECTED: ["CLOSED"],
    AWAITING_RETURN: ["RETURN_RECEIVED"],
    RETURN_RECEIVED: ["INSPECTED"],
    INSPECTED: ["REFUND_PENDING", "CLOSED"],
    REFUND_PENDING: ["REFUNDED"],
    REFUNDED: ["CLOSED"],
    CLOSED: [],
    CANCELLED: [],
  };
  if (!allowed[from].includes(to)) throw new ShopAfterSalesError(409, "INVALID_TRANSITION");
}

export function calculateShopReturnRefund(input: {
  lines: readonly { unitPriceCents: number; refundableQuantity: number }[];
  shippingCents: number;
  shippingDecision: "NONE" | "FULL";
}) {
  let itemsRefundCents = 0;
  for (const line of input.lines) {
    if (!Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents <= 0 || !Number.isSafeInteger(line.refundableQuantity) || line.refundableQuantity < 0) {
      throw new ShopAfterSalesError(409, "REFUND_REQUIRES_REVIEW");
    }
    itemsRefundCents += line.unitPriceCents * line.refundableQuantity;
    if (!Number.isSafeInteger(itemsRefundCents)) throw new ShopAfterSalesError(409, "REFUND_REQUIRES_REVIEW");
  }
  if (!Number.isSafeInteger(input.shippingCents) || input.shippingCents < 0) throw new ShopAfterSalesError(409, "REFUND_REQUIRES_REVIEW");
  const shippingRefundCents = input.shippingDecision === "FULL" ? input.shippingCents : 0;
  const totalRefundCents = itemsRefundCents + shippingRefundCents;
  if (!Number.isSafeInteger(totalRefundCents) || totalRefundCents <= 0) throw new ShopAfterSalesError(409, "REFUND_REQUIRES_REVIEW");
  return { itemsRefundCents, shippingRefundCents, totalRefundCents } as const;
}
