import { createHash } from "node:crypto";

export const BILLING_TIME_ZONE = "Europe/Paris";
export const CURRENT_VAT_REGIME = "FRANCHISE_EN_BASE_TVA" as const;
export const CURRENT_VAT_LEGAL_NOTICE = "TVA non applicable, article 293 B du CGI";
export const ACCOUNTING_RETENTION_YEARS = 10;

export type BillingCustomerIdentity = Readonly<{
  type: "INDIVIDUAL" | "PROFESSIONAL";
  name: string;
  email: string;
  companyName?: string | null;
  billingAddress?: Readonly<{
    line1: string;
    line2?: string | null;
    postalCode: string;
    city: string;
    countryCode: "FR";
  }> | null;
  businessIdentifier?: string | null;
  vatId?: string | null;
}>;

const customerKeys = new Set(["type", "name", "email", "companyName", "billingAddress", "businessIdentifier", "vatId"]);
const addressKeys = new Set(["line1", "line2", "postalCode", "city", "countryCode"]);

function closedRecord(value: unknown, keys: ReadonlySet<string>, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is invalid.`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.has(key))) throw new TypeError(`${label} contains an unexpected field.`);
  return record;
}

function boundedText(value: unknown, maximum: number, label: string, required = true) {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid.`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if ((required && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return normalized;
}

export function validateBillingCustomerIdentity(input: BillingCustomerIdentity): BillingCustomerIdentity {
  const record = closedRecord(input, customerKeys, "Billing customer");
  if (record.type !== "INDIVIDUAL" && record.type !== "PROFESSIONAL") throw new TypeError("Billing customer type is invalid.");
  const type = record.type;
  const name = boundedText(record.name, 240, "Billing name");
  const email = boundedText(record.email, 320, "Billing email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TypeError("Billing email is invalid.");
  const companyName = record.companyName ? boundedText(record.companyName, 240, "Company name") : null;
  if (type === "PROFESSIONAL" && !companyName) throw new TypeError("Company name is required for professional billing.");
  if (type === "INDIVIDUAL" && (record.companyName || record.businessIdentifier || record.vatId)) {
    throw new TypeError("Professional fields are not accepted for individual billing.");
  }
  const businessIdentifier = record.businessIdentifier
    ? boundedText(record.businessIdentifier, 32, "Business identifier").replaceAll(" ", "")
    : null;
  if (businessIdentifier && !/^(?:\d{9}|\d{14})$/.test(businessIdentifier)) throw new TypeError("Business identifier is invalid.");
  const vatId = record.vatId ? boundedText(record.vatId, 32, "VAT identifier").replaceAll(" ", "").toUpperCase() : null;
  if (vatId && !/^[A-Z]{2}[A-Z0-9]{2,14}$/.test(vatId)) throw new TypeError("VAT identifier is invalid.");
  const address = record.billingAddress ? closedRecord(record.billingAddress, addressKeys, "Billing address") : null;
  const billingAddress = address ? {
    line1: boundedText(address.line1, 240, "Billing address"),
    line2: address.line2 ? boundedText(address.line2, 240, "Billing address complement") : null,
    postalCode: boundedText(address.postalCode, 32, "Billing postal code"),
    city: boundedText(address.city, 120, "Billing city"),
    countryCode: address.countryCode,
  } : null;
  if (billingAddress && billingAddress.countryCode !== "FR") throw new TypeError("Phase 4B billing country is invalid.");
  return { type, name, email, companyName, billingAddress: billingAddress as BillingCustomerIdentity["billingAddress"], businessIdentifier, vatId };
}

export function parseBillingCustomerSnapshot(value: unknown) {
  return validateBillingCustomerIdentity(value as BillingCustomerIdentity);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function billingSnapshotHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function parisDateSegment(value: Date) {
  if (Number.isNaN(value.getTime())) throw new TypeError("Issued date is invalid.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BILLING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new TypeError("Issued date cannot be formatted.");
  return `${year}${month}${day}`;
}

function parisOffsetAtNoon(year: number, month: number, day: number) {
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BILLING_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(probe);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return Date.UTC(number("year"), number("month") - 1, number("day"), number("hour"), number("minute"), number("second")) - probe.getTime();
}

export function parisDayRange(year: number, month: number, day: number) {
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isInteger(year) || year < 2000 || year > 9999 || calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    throw new TypeError("Billing search date is invalid.");
  }
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: new Date(Date.UTC(year, month - 1, day) - parisOffsetAtNoon(year, month, day)),
    end: new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate()) - parisOffsetAtNoon(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())),
  };
}

function sequenceSegment(sequence: bigint) {
  if (sequence < 1n) throw new TypeError("Billing sequence is invalid.");
  return sequence.toString().padStart(4, "0");
}

export function invoiceNumber(issuedAt: Date, sequence: bigint) {
  return `LNX-${parisDateSegment(issuedAt)}-${sequenceSegment(sequence)}`;
}

export function creditNoteNumber(issuedAt: Date, sequence: bigint) {
  return `AV-LNX-${parisDateSegment(issuedAt)}-${sequenceSegment(sequence)}`;
}

export function paymentMethodLabel(provider: "STRIPE" | "PAYPAL", method: "CARD" | "PAYPAL" | "WERO" | "OTHER" | null) {
  if (provider === "PAYPAL" || method === "PAYPAL") return "PayPal";
  if (method === "WERO") return "Wero";
  return "Carte bancaire / Apple Pay via Stripe";
}

export function formatBillingMoney(cents: number) {
  if (!Number.isInteger(cents)) throw new TypeError("Billing amount is invalid.");
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}
