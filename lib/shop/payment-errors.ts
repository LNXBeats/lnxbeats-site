export type ShopPaymentServiceErrorCode =
  | "PAYMENT_ACCESS_DENIED"
  | "INVALID_ORDER_NUMBER"
  | "SHOP_PAYMENTS_DISABLED"
  | "PROVIDER_UNAVAILABLE"
  | "ORDER_NOT_PAYABLE"
  | "PAYMENT_ALREADY_COMPLETED"
  | "PAYMENT_SNAPSHOT_CONFLICT"
  | "RESERVATION_EXPIRED"
  | "TERMS_NOT_ACCEPTED"
  | "RATE_LIMITED"
  | "PAYMENT_UNAVAILABLE";

export class ShopPaymentServiceError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 429 | 503,
    readonly code: ShopPaymentServiceErrorCode,
    message = "Le paiement de cette commande Boutique ne peut pas être préparé.",
  ) {
    super(message);
    this.name = "ShopPaymentServiceError";
  }
}
