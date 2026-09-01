/**
 * Launch boundary for physical Shop deliveries.
 *
 * This is intentionally a geographic scope check, not a full La Poste address
 * validator: numeric 5-digit metropolitan codes are accepted, including 20xxx
 * (Corsica), while 00xxx and overseas 97xxx/98xxx ranges are rejected.
 */
const METROPOLITAN_POSTAL_CODE_PATTERN = /^(?:0[1-9]|[1-8][0-9]|9[0-5])[0-9]{3}$/;

export function normalizeMetropolitanFrancePostalCode(value: string) {
  return value.trim().replace(/\s+/g, "");
}

export function isMetropolitanFrancePostalCode(value: string) {
  return METROPOLITAN_POSTAL_CODE_PATTERN.test(normalizeMetropolitanFrancePostalCode(value));
}

export function isMetropolitanFranceDestination(countryCode: string, postalCode: string) {
  return countryCode === "FR" && isMetropolitanFrancePostalCode(postalCode);
}
