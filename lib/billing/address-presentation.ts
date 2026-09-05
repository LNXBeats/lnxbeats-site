export type BillingPostalAddress = Readonly<{
  line1: string;
  line2?: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
}>;

export function billingAddressLines(address: BillingPostalAddress): readonly string[] {
  return Object.freeze([
    address.line1,
    ...(address.line2 ? [address.line2] : []),
    `${address.postalCode} ${address.city}`,
    address.countryCode === "FR" ? "France" : address.countryCode,
  ]);
}
