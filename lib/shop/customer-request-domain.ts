import { createHash } from "node:crypto";

import type { ShopShippingAddress } from "@/lib/shop/order-domain";

const POSTAL_CODE = /^\d{5}$/;

export const SHOP_CUSTOMER_REQUEST_CONFIRMATION = "CONFIRM_SHOP_CUSTOMER_REQUEST";
export const SHOP_CUSTOMER_REQUEST_APPROVAL = "CONFIRM_SHOP_CUSTOMER_REQUEST_APPROVAL";
export const SHOP_CUSTOMER_REQUEST_REJECTION = "CONFIRM_SHOP_CUSTOMER_REQUEST_REJECTION";
export const SHOP_CUSTOMER_REQUEST_REFUND_RECONCILIATION = "CONFIRM_SHOP_CUSTOMER_REFUND_RECONCILIATION";

export class ShopCustomerRequestError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "ACCESS_DENIED" | "ORDER_NOT_ELIGIBLE" | "REQUEST_NOT_FOUND" | "REFUND_REQUIRES_REVIEW") {
    super(code);
    this.name = "ShopCustomerRequestError";
  }
}

function clean(value: unknown, maximum: number, optional = false) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string") throw new ShopCustomerRequestError("INVALID_REQUEST");
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) throw new ShopCustomerRequestError("INVALID_REQUEST");
  return normalized;
}

export function parseFranceShippingAddress(input: Readonly<Record<string, unknown>>): ShopShippingAddress {
  const countryCode = clean(input.countryCode, 2);
  const postalCode = clean(input.postalCode, 5);
  if (countryCode !== "FR" || !POSTAL_CODE.test(postalCode!)) throw new ShopCustomerRequestError("INVALID_REQUEST");
  return Object.freeze({
    firstName: clean(input.firstName, 100)!,
    lastName: clean(input.lastName, 100)!,
    addressLine1: clean(input.addressLine1, 240)!,
    addressLine2: clean(input.addressLine2, 240, true),
    postalCode: postalCode!,
    city: clean(input.city, 120)!,
    countryCode: "FR",
  });
}

export function shippingAddressFingerprint(address: ShopShippingAddress) {
  return createHash("sha256").update(JSON.stringify(address)).digest("hex");
}

export function parseCustomerRequestForm(formData: FormData) {
  if (formData.get("confirmation") !== SHOP_CUSTOMER_REQUEST_CONFIRMATION) throw new ShopCustomerRequestError("INVALID_REQUEST");
  const type = formData.get("type");
  if (type !== "PAID_ORDER_CANCELLATION" && type !== "SHIPPING_ADDRESS_CORRECTION") throw new ShopCustomerRequestError("INVALID_REQUEST");
  const orderNumber = clean(formData.get("orderNumber"), 32)!;
  const reason = clean(formData.get("reason"), 1000)!;
  const address = type === "SHIPPING_ADDRESS_CORRECTION" ? parseFranceShippingAddress({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    addressLine1: formData.get("addressLine1"),
    addressLine2: formData.get("addressLine2"),
    postalCode: formData.get("postalCode"),
    city: formData.get("city"),
    countryCode: formData.get("countryCode"),
  }) : null;
  return { orderNumber, type, reason, address } as const;
}
