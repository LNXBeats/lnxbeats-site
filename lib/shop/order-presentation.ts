export function formatShopMoney(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function effectiveShopOrderStatus(
  order: Readonly<{
    status: "OPEN" | "EXPIRED" | "CANCELLED";
    paymentStatus: "AWAITING_PAYMENT" | "PAID" | "CANCELLED";
    reservationExpiresAt: Date;
  }>,
  now = new Date(),
) {
  if (
    order.status === "OPEN"
    && order.paymentStatus === "AWAITING_PAYMENT"
    && order.reservationExpiresAt.getTime() <= now.getTime()
  ) return "EXPIRED" as const;
  return order.status;
}
