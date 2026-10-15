import { DigitalError } from "./domain";
import { digitalFrancePostalScope } from "./france-launch-policy";

/** Only fields already present in an authenticated provider response. Not an
 * identity/residence proof, card issuer check, new collection or API lookup. */
export type DigitalProviderBilling = { countryCode?: string; postalCode?: string };
export function digitalProviderBilling(address: unknown): DigitalProviderBilling | undefined {
  if (address === undefined || address === null) return undefined;
  if (typeof address !== "object" || Array.isArray(address)) return { countryCode: "INVALID" };
  const a = address as Record<string, unknown>, result: DigitalProviderBilling = {};
  const country=a.country??a.country_code;
  if (country !== undefined && country !== null) result.countryCode = typeof country === "string" ? country : "INVALID";
  if(a.country!==undefined&&a.country_code!==undefined&&a.country!==a.country_code)result.countryCode="INVALID";
  if (a.postal_code !== undefined && a.postal_code !== null) result.postalCode = typeof a.postal_code === "string" ? a.postal_code : "INVALID";
  return Object.keys(result).length ? result : undefined;
}
/** Orders v2 may expose the same billing data in the legacy payer or current
 * payment_source response. Never inspect shipping, BIN or issuer country. */
export function digitalPaypalProviderBilling(body:unknown):DigitalProviderBilling|undefined{
  if(!body||typeof body!=="object"||Array.isArray(body))return undefined;
  const b=body as {payer?:{address?:unknown};payment_source?:{paypal?:{address?:unknown};card?:{billing_address?:unknown}}};
  const values=[b.payer?.address,b.payment_source?.paypal?.address,b.payment_source?.card?.billing_address].map(digitalProviderBilling).filter((value):value is DigitalProviderBilling=>!!value);
  if(!values.length)return undefined;
  const result:DigitalProviderBilling={};
  for(const value of values)for(const key of ["countryCode","postalCode"] as const){
    if(value[key]!==undefined){if(result[key]!==undefined&&result[key]!==value[key])return{countryCode:"INVALID"};result[key]=value[key];}
  }
  return result;
}
export type DigitalExpectedBilling = { countryCode: "FR"; billingPostalCode: string };
/** No retrofit to legacy acquisitions. Never returns a positive proof when data
 * is missing; the separate server residence review remains mandatory. */
export function assertDigitalProviderBilling(expected: DigitalExpectedBilling | undefined, actual: DigitalProviderBilling | undefined) {
  if (!expected) return;
  if (!digitalFrancePostalScope(expected.countryCode, expected.billingPostalCode)) throw new DigitalError("FRANCE_BILLING_BINDING_INVALID", 409);
  if (!actual) return;
  if (actual.countryCode !== undefined && actual.countryCode !== "FR"
    || actual.postalCode !== undefined && (!digitalFrancePostalScope("FR", actual.postalCode) || actual.postalCode !== expected.billingPostalCode)) {
    throw new DigitalError("FRANCE_PROVIDER_BILLING_CONFLICT", 409);
  }
}
export function digitalExpectedBilling(snapshot: unknown): DigitalExpectedBilling | undefined {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !("franceResidenceV2" in snapshot)) return undefined;
  const s = snapshot as { countryCode?: unknown; franceResidenceV2?: { countryCode?: unknown; billingPostalCode?: unknown } };
  if (s.countryCode !== "FR" || s.franceResidenceV2?.countryCode !== "FR" || typeof s.franceResidenceV2.billingPostalCode !== "string") throw new DigitalError("FRANCE_BILLING_BINDING_INVALID", 409);
  return { countryCode: "FR", billingPostalCode: s.franceResidenceV2.billingPostalCode };
}
