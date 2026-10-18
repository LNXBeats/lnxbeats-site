import "server-only";
import reference from "@/data/digital-postal-reference-20261018.json";
import { digitalFrancePostalScope } from "./france-launch-policy";

export const DIGITAL_POSTAL_REFERENCE_VERSION = reference.version;
export const DIGITAL_POSTAL_REFERENCE_SOURCE_SHA = reference.sourceSha256;
export function normalizeDigitalPostalCity(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase()
    .replaceAll("Œ", "OE").replaceAll("Æ", "AE").replace(/[^A-Z0-9]+/g, " ").trim()
    .replace(/\bST\b/g, "SAINT").replace(/\bSTE\b/g, "SAINTE");
}
/** Local public routing reference, NOT a street, identity or residence proof.
 * No customer address is sent to La Poste or any geocoding service.
 */
export function digitalPostalAddressCoherent(countryCode: string, postalCode: string, city: string) {
  if (!digitalFrancePostalScope(countryCode, postalCode)) return false;
  const entries = reference.postcodes as Record<string, string[]>;
  return Object.prototype.hasOwnProperty.call(entries, postalCode) && entries[postalCode].includes(normalizeDigitalPostalCity(city));
}
