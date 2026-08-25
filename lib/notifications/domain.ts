import { createHash } from "node:crypto";

import type {
  NotificationFailure,
  NotificationPayload,
  NotificationPriority,
  OrderNotificationKind,
} from "@/lib/notifications/types";

export const MAXIMUM_NOTIFICATION_ATTEMPTS = 5;
export const NOTIFICATION_LEASE_MS = 5 * 60_000;
export const NOTIFICATION_TEMPLATE_VERSION = 1;
export const NOTIFICATION_PAYLOAD_VERSION = 1;
export const OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY = "qa:owner-smoke:v0732:01";
export const PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY = "production:owner-smoke:v0812:01";
export const ONE_SHOT_NOTIFICATION_IDEMPOTENCY_KEYS = [
  OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY,
  PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY,
] as const;

const definitions: Record<OrderNotificationKind, Readonly<{
  audience: "OWNER" | "CLIENT";
  priority: NotificationPriority;
  templateKey: string;
}>> = {
  OWNER_NEW_ORDER: { audience: "OWNER", priority: "CRITICAL", templateKey: "owner-new-order" },
  CUSTOMER_PAYMENT_CONFIRMED: { audience: "CLIENT", priority: "CRITICAL", templateKey: "customer-payment-confirmed" },
  CUSTOMER_ORDER_ACCEPTED: { audience: "CLIENT", priority: "INFORMATIONAL", templateKey: "customer-order-accepted" },
  CUSTOMER_CREATION_STARTED: { audience: "CLIENT", priority: "INFORMATIONAL", templateKey: "customer-creation-started" },
  CUSTOMER_DELIVERY_READY: { audience: "CLIENT", priority: "CRITICAL", templateKey: "customer-delivery-ready" },
  OWNER_RIGHTS_REQUESTED: { audience: "OWNER", priority: "CRITICAL", templateKey: "owner-rights-requested" },
  CUSTOMER_RIGHTS_INFORMATION_REQUIRED: { audience: "CLIENT", priority: "CRITICAL", templateKey: "customer-rights-information-required" },
  CUSTOMER_RIGHTS_PREAUTHORIZATION_READY: { audience: "CLIENT", priority: "INFORMATIONAL", templateKey: "customer-rights-preauthorization-ready" },
  CUSTOMER_RIGHTS_CONTRACT_READY: { audience: "CLIENT", priority: "INFORMATIONAL", templateKey: "customer-rights-contract-ready" },
  OWNER_RIGHTS_CLIENT_ACCEPTED: { audience: "OWNER", priority: "CRITICAL", templateKey: "owner-rights-client-accepted" },
  CUSTOMER_RIGHTS_REJECTED: { audience: "CLIENT", priority: "CRITICAL", templateKey: "customer-rights-rejected" },
  CUSTOMER_RIGHTS_READY_FOR_PAYMENT: { audience: "CLIENT", priority: "INFORMATIONAL", templateKey: "customer-rights-ready-for-payment" },
  CUSTOMER_PARTIAL_REFUND: { audience: "CLIENT", priority: "CRITICAL", templateKey: "customer-partial-refund" },
  CUSTOMER_REFUND_COMPLETED: { audience: "CLIENT", priority: "CRITICAL", templateKey: "customer-refund-completed" },
  OWNER_PAYMENT_INCIDENT: { audience: "OWNER", priority: "CRITICAL", templateKey: "owner-payment-incident" },
};

export function notificationDefinition(kind: OrderNotificationKind) {
  return definitions[kind];
}

export function normalizeNotificationRecipient(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized || normalized.length > 320 || /[\r\n]/.test(normalized) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Notification recipient is invalid.");
  }
  return normalized;
}

export function recipientHash(value: string) {
  return createHash("sha256").update(normalizeNotificationRecipient(value)).digest("hex");
}

export function maskedRecipient(value: string | null) {
  if (!value) return "Destination indisponible";
  const [local, domain] = value.split("@");
  if (!local || !domain) return "Destination invalide";
  return `${local.slice(0, 2)}${"•".repeat(Math.min(Math.max(local.length - 2, 2), 8))}@${domain}`;
}

export function isFictitiousRecipient(value: string) {
  const normalized = normalizeNotificationRecipient(value);
  return normalized.endsWith(".invalid") || normalized.endsWith(".test") || normalized.endsWith("@example.invalid");
}

export function isOfficialResendTestRecipient(value: string) {
  const normalized = normalizeNotificationRecipient(value);
  return /^(delivered|bounced|complained)(\+[a-z0-9._-]{1,64})?@resend\.dev$/.test(normalized)
    || normalized === "suppressed@resend.dev";
}

export function notificationBackoffMs(attempts: number) {
  const delays = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000] as const;
  return delays[Math.min(Math.max(attempts - 1, 0), delays.length - 1)]!;
}

const payloadKeys = new Set([
  "orderNumber", "customerName", "customerEmail", "totalCents", "currency", "coverIncluded",
  "priorityProcessing", "createdAt", "workTitle", "rightsRequestNumber", "rightsRequestType", "requestedPriceCents",
  "refundAmountCents",
]);

export function parseNotificationPayload(value: unknown): NotificationPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Notification payload is invalid.");
  const payload = value as Record<string, unknown>;
  if (Object.keys(payload).some((key) => !payloadKeys.has(key))) throw new Error("Notification payload contains an unknown field.");
  if (
    typeof payload.orderNumber !== "string" || payload.orderNumber.length > 80
    || !(payload.customerName === null || (typeof payload.customerName === "string" && payload.customerName.length <= 200))
    || typeof payload.customerEmail !== "string"
    || !Number.isInteger(payload.totalCents) || Number(payload.totalCents) < 0
    || typeof payload.currency !== "string" || !/^[A-Z]{3}$/.test(payload.currency)
    || typeof payload.coverIncluded !== "boolean"
    || typeof payload.priorityProcessing !== "boolean"
    || typeof payload.createdAt !== "string" || Number.isNaN(Date.parse(payload.createdAt))
  ) throw new Error("Notification payload is invalid.");
  normalizeNotificationRecipient(payload.customerEmail as string);
  if (payload.workTitle !== undefined && (typeof payload.workTitle !== "string" || payload.workTitle.length > 200)) throw new Error("Notification payload is invalid.");
  if (payload.rightsRequestNumber !== undefined && (typeof payload.rightsRequestNumber !== "string" || payload.rightsRequestNumber.length > 80)) throw new Error("Notification payload is invalid.");
  if (payload.rightsRequestType !== undefined && !["PUBLICATION_LICENSE", "EXPLOITATION_PARTNERSHIP"].includes(String(payload.rightsRequestType))) throw new Error("Notification payload is invalid.");
  if (payload.requestedPriceCents !== undefined && (!Number.isInteger(payload.requestedPriceCents) || Number(payload.requestedPriceCents) <= 0)) throw new Error("Notification payload is invalid.");
  if (payload.refundAmountCents !== undefined && (!Number.isInteger(payload.refundAmountCents) || Number(payload.refundAmountCents) <= 0)) throw new Error("Notification payload is invalid.");
  return payload as NotificationPayload;
}

export class NotificationTransportError extends Error {
  readonly failure: NotificationFailure;
  constructor(failure: NotificationFailure) {
    super(failure.message);
    this.name = "NotificationTransportError";
    this.failure = failure;
  }
}

export function classifyNotificationFailure(error: unknown): NotificationFailure {
  if (error instanceof NotificationTransportError) return error.failure;
  if (error instanceof Error && error.message === "Notification recipient is invalid.") {
    return { code: "INVALID_RECIPIENT", message: "La destination est invalide.", retryable: false };
  }
  const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const name = typeof candidate.name === "string" ? candidate.name : "unknown";
  const status = typeof candidate.statusCode === "number" ? candidate.statusCode : null;
  if (name === "invalid_idempotent_request") {
    return { code: "IDEMPOTENCY_CONFLICT", message: "La requête fournisseur ne correspond plus à son empreinte initiale.", retryable: false };
  }
  const retryable = name === "concurrent_idempotent_requests"
    || name === "request_timeout"
    || status === null
    || status === 408
    || status === 429
    || status !== null && status >= 500;
  const code = retryable ? "PROVIDER_TEMPORARY" : ["invalid_api_key", "missing_api_key", "restricted_api_key"].includes(name)
    ? "PROVIDER_CONFIGURATION"
    : name === "validation_error" || status === 400 || status === 422
      ? "INVALID_MESSAGE"
      : "PROVIDER_FINAL";
  return {
    code,
    message: retryable ? "Le fournisseur est temporairement indisponible." : "La notification nécessite une vérification.",
    retryable,
  };
}

export const notificationStatusPresentation = {
  PENDING: "En attente",
  PROCESSING: "Traitement en cours",
  SENT: "Accepté par le fournisseur",
  DELIVERED: "Livré",
  FAILED: "Échec historique",
  FAILED_RETRYABLE: "Nouvelle tentative planifiée",
  FAILED_FINAL: "Échec définitif",
  BOUNCED: "Adresse rejetée",
  COMPLAINED: "Plainte reçue",
  SUPPRESSED: "Adresse supprimée",
  CANCELED: "Annulé",
} as const;

export function manualRetryAllowed(input: {
  status: keyof typeof notificationStatusPresentation;
  suppressionActive: boolean;
  attempts?: number;
}) {
  return !input.suppressionActive
    && (input.attempts ?? 0) < MAXIMUM_NOTIFICATION_ATTEMPTS
    && input.status === "FAILED_RETRYABLE";
}
