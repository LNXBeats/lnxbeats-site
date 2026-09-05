export const SHOP_ORDER_CUSTOMER_SNAPSHOT_NAME_MAX_LENGTH = 201;

type ShopOrderCustomerNameSnapshot = Readonly<{
  shippingFirstName: string | null;
  shippingLastName: string | null;
}>;

function normalizedNamePart(value: string | null) {
  return value?.trim().replace(/\s+/g, " ") || null;
}

export function shopOrderCustomerSnapshotName(input: ShopOrderCustomerNameSnapshot) {
  const firstName = normalizedNamePart(input.shippingFirstName);
  const lastName = normalizedNamePart(input.shippingLastName);
  return firstName && lastName ? `${firstName} ${lastName}` : null;
}
