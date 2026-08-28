import "server-only";

import Stripe from "stripe";

import { paypalCentsFromAmount } from "@/lib/payments/paypal-client";
import { normalizePaymentMethod } from "@/lib/payments/domain";
import { normalizePaypalWebhookEvent, processVerifiedPaypalWebhookEvent, type VerifiedPaypalWebhookEvent } from "@/lib/payments/paypal-webhook";
import type { PaypalCaptureRepository } from "@/lib/payments/paypal-service";
import { STRIPE_API_VERSION } from "@/lib/payments/config";
import type { PaymentMethod, PaypalPaymentEnvironment } from "@/lib/payments/types";
import type { VerifiedStripeWebhookEvent } from "@/lib/payments/webhook";
import { prisma } from "@/lib/prisma";
import { createShopPaymentDatabaseRepository, shopPaymentDatabaseRepository } from "@/lib/shop/payment-repository";
import type { ShopPaymentFinalizationResult, ShopPaymentProviderEvent } from "@/lib/shop/payment-types";
import { SHOP_PAYMENT_PRICING_VERSION } from "@/lib/shop/payment-types";

type StripeReconciliationConfiguration = Readonly<{
  secretKey: string;
  mode: "test" | "live";
}>;

type ShopStripeIntentEvidence = Readonly<{
  providerPaymentId: string;
  paymentId: string | null;
  shopOrderId: string | null;
  amountCents?: number;
  currency?: string;
  livemode: boolean;
  paymentMethod: PaymentMethod;
  consistent: boolean;
}>;

type EnrichedShopStripeWebhookEvent = VerifiedStripeWebhookEvent & Readonly<{
  shopPaymentIntentEvidence?: ShopStripeIntentEvidence;
  shopPaymentSourceResolved?: true;
  musicPaymentSourceResolved?: true;
  shopResolvedPaymentId?: string;
  shopResolvedOrderId?: string;
}>;

type ShopWebhookRepository = Readonly<{
  reconcile(event: ShopPaymentProviderEvent, now?: Date): Promise<ShopPaymentFinalizationResult>;
  recordUnmatched(input: Readonly<{
    provider: "STRIPE" | "PAYPAL";
    eventId: string;
    type: string;
    livemode: boolean;
    objectId?: string;
    occurredAt: Date;
  }>): Promise<ShopPaymentFinalizationResult>;
}>;

type PaymentSource = Readonly<{
  id: string;
  orderId: string | null;
  shopOrderId: string | null;
}>;

type PaymentSourceLookup = Readonly<{
  resolvePaypalPayment(providerOrderId: string, paymentId?: string): Promise<PaymentSource | null>;
}>;

type PaypalPaymentFinder = (
  where: Readonly<{ provider: "PAYPAL"; providerCheckoutId?: string; id?: string }>,
) => Promise<PaymentSource | null>;

type StripePaymentFinder = (
  where: Readonly<{
    provider: "STRIPE";
    id?: string;
    providerCheckoutId?: string;
    providerPaymentId?: string;
  }>,
) => Promise<PaymentSource | null>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHOP_STRIPE_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
]);
const SHOP_PAYPAL_EVENTS = new Set([
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DECLINED",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function bounded(value: unknown, max = 255) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function metadata(value: unknown) {
  return record(record(value)?.metadata);
}

function paymentIntentId(value: unknown) {
  return bounded(typeof value === "string" ? value : record(value)?.id);
}

function occurredAt(event: VerifiedStripeWebhookEvent) {
  if (!Number.isSafeInteger(event.created) || event.created <= 0) return null;
  const value = new Date(event.created * 1_000);
  return Number.isNaN(value.getTime()) ? null : value;
}

export function isShopStripeWebhookEvent(event: VerifiedStripeWebhookEvent) {
  const resolved = event as EnrichedShopStripeWebhookEvent;
  if (resolved.shopPaymentSourceResolved === true) return true;
  if (resolved.musicPaymentSourceResolved === true) return false;
  return metadata(event.data.object)?.paymentSource === "SHOP_ORDER";
}

export async function resolveShopStripePaymentSource(
  event: VerifiedStripeWebhookEvent,
  findPayment: StripePaymentFinder = (where) => prisma.payment.findFirst({
    where,
    select: { id: true, orderId: true, shopOrderId: true },
  }),
) {
  const object = record(event.data.object);
  const paymentId = bounded(metadata(object)?.paymentId);
  const objectId = bounded(object?.id);
  const checkoutId = event.type.startsWith("checkout.session.") ? objectId : null;
  const intentId = event.type.startsWith("payment_intent.")
    ? objectId
    : paymentIntentId(object?.payment_intent);
  // Provider identifiers are persisted from provider responses and therefore
  // outrank mutable metadata carried by a later webhook. Metadata is only the
  // crash-before-recordSession fallback when no provider identifier is known.
  let payment = checkoutId
    ? await findPayment({ providerCheckoutId: checkoutId, provider: "STRIPE" })
    : null;
  if (!payment && intentId) {
    payment = await findPayment({ providerPaymentId: intentId, provider: "STRIPE" });
  }
  if (!payment && paymentId && UUID.test(paymentId)) {
    payment = await findPayment({ id: paymentId, provider: "STRIPE" });
  }
  if (!payment) return event;
  return payment.shopOrderId && !payment.orderId
    ? {
      ...event,
      shopPaymentSourceResolved: true as const,
      shopResolvedPaymentId: payment.id,
      shopResolvedOrderId: payment.shopOrderId,
    }
    : payment.orderId && !payment.shopOrderId
      ? { ...event, musicPaymentSourceResolved: true as const }
      : event;
}

function expandedIntent(value: unknown) {
  const candidate = record(value);
  return candidate?.object === "payment_intent" ? candidate : null;
}

export function shopStripePaymentIntentEvidence(
  sessionValue: unknown,
  expectedSessionId: string,
  expectedLivemode: boolean,
): ShopStripeIntentEvidence {
  const session = record(sessionValue);
  const sessionMetadata = metadata(session);
  const intent = expandedIntent(session?.payment_intent);
  const intentMetadata = metadata(intent);
  const method = record(intent?.payment_method);
  const paymentId = bounded(sessionMetadata?.paymentId);
  const shopOrderId = bounded(sessionMetadata?.shopOrderId);
  const pricingVersion = bounded(sessionMetadata?.pricingVersion, 64);
  const intentPaymentId = bounded(intentMetadata?.paymentId);
  const intentShopOrderId = bounded(intentMetadata?.shopOrderId);
  const intentPricingVersion = bounded(intentMetadata?.pricingVersion, 64);
  const intentId = bounded(intent?.id);
  const intentCurrency = bounded(intent?.currency, 3)?.toUpperCase();
  const methodType = bounded(method?.type, 80);
  if (
    !session
    || session.object !== "checkout.session"
    || session.id !== expectedSessionId
    || session.mode !== "payment"
    || session.payment_status !== "paid"
    || session.livemode !== expectedLivemode
    || !intent
    || !intentId
    || intent.object !== "payment_intent"
    || intent.status !== "succeeded"
    || intent.livemode !== expectedLivemode
    || !methodType
  ) throw new Error("Stripe Shop payment evidence is unavailable.");
  return {
    providerPaymentId: intentId,
    paymentId,
    shopOrderId,
    ...(Number.isSafeInteger(intent.amount) && Number(intent.amount) > 0
      ? { amountCents: Number(intent.amount) }
      : {}),
    ...(intentCurrency ? { currency: intentCurrency } : {}),
    livemode: expectedLivemode,
    paymentMethod: normalizePaymentMethod(methodType),
    consistent: session.client_reference_id === shopOrderId
      && sessionMetadata?.paymentSource === "SHOP_ORDER"
      && UUID.test(paymentId ?? "")
      && UUID.test(shopOrderId ?? "")
      && pricingVersion === SHOP_PAYMENT_PRICING_VERSION
      && intentMetadata?.paymentSource === "SHOP_ORDER"
      && intentPaymentId === paymentId
      && intentShopOrderId === shopOrderId
      && intentPricingVersion === pricingVersion
      && Number.isSafeInteger(intent.amount)
      && Number(intent.amount) > 0
      && intentCurrency === "EUR",
  };
}

export async function enrichShopStripeWebhookEvent(
  event: VerifiedStripeWebhookEvent,
  configuration: StripeReconciliationConfiguration,
  retrieveSession?: (checkoutId: string) => Promise<unknown>,
): Promise<EnrichedShopStripeWebhookEvent> {
  if (!isShopStripeWebhookEvent(event)) return event;
  const object = record(event.data.object);
  const checkoutId = bounded(object?.id);
  const successful = event.type === "checkout.session.async_payment_succeeded"
    || (event.type === "checkout.session.completed" && object?.payment_status === "paid");
  if (!successful || !checkoutId) return event;
  const retrieve = retrieveSession ?? (async (sessionId: string) => {
    const client = new Stripe(configuration.secretKey, {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 2,
      timeout: 20_000,
      telemetry: false,
    });
    return client.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent.payment_method"],
    });
  });
  const session = await retrieve(checkoutId);
  return {
    ...event,
    shopPaymentSourceResolved: true,
    shopPaymentIntentEvidence: shopStripePaymentIntentEvidence(
      session,
      checkoutId,
      configuration.mode === "live",
    ),
  };
}

function normalizeShopStripeCheckout(
  event: EnrichedShopStripeWebhookEvent,
): ShopPaymentProviderEvent | null {
  const session = record(event.data.object);
  const data = metadata(session);
  const eventTime = occurredAt(event);
  const rawPaymentId = bounded(data?.paymentId);
  const rawShopOrderId = bounded(data?.shopOrderId);
  const checkoutId = bounded(session?.id);
  const amount = session?.amount_total;
  const currency = bounded(session?.currency, 3)?.toUpperCase();
  const successful = event.type === "checkout.session.async_payment_succeeded"
    || (event.type === "checkout.session.completed" && session?.payment_status === "paid");
  if (
    !eventTime
    || !checkoutId
    || (data?.paymentSource !== "SHOP_ORDER" && event.shopPaymentSourceResolved !== true)
    || session?.object !== "checkout.session"
    || session?.mode !== "payment"
    || session?.livemode !== event.livemode
  ) return null;

  const providerPaymentId = paymentIntentId(session.payment_intent);
  const evidence = event.shopPaymentIntentEvidence;
  if (successful && !evidence) return null;
  const paymentId = event.shopResolvedPaymentId
    ?? (UUID.test(rawPaymentId ?? "") ? rawPaymentId : undefined);
  const shopOrderId = event.shopResolvedOrderId
    ?? (UUID.test(rawShopOrderId ?? "") ? rawShopOrderId : undefined);
  if (!paymentId || !UUID.test(paymentId)) return null;
  const checkoutAmountCents = Number.isSafeInteger(amount) && Number(amount) > 0
    ? Number(amount)
    : undefined;

  let status: ShopPaymentProviderEvent["status"];
  if (successful) status = "SUCCEEDED";
  else if (event.type === "checkout.session.expired" && session.status === "expired" && session.payment_status === "unpaid") status = "EXPIRED";
  else if (event.type === "checkout.session.async_payment_failed" && session.status === "complete" && session.payment_status === "unpaid") status = "FAILED";
  else if (event.type === "checkout.session.completed" && session.status === "complete" && session.payment_status === "unpaid") status = "PENDING";
  else return null;

  return {
    eventId: event.id,
    type: event.type,
    provider: "STRIPE",
    livemode: event.livemode,
    paymentId: paymentId as string,
    ...(UUID.test(shopOrderId ?? "")
      ? { providerSourceShopOrderId: shopOrderId as string }
      : {}),
    providerCheckoutId: checkoutId,
    ...(successful
      ? { providerPaymentId: evidence?.providerPaymentId }
      : providerPaymentId
        ? { providerPaymentId }
        : {}),
    ...(successful
      ? evidence?.amountCents !== undefined ? { amountCents: evidence.amountCents } : {}
      : checkoutAmountCents !== undefined ? { amountCents: checkoutAmountCents } : {}),
    ...(successful
      ? evidence?.currency ? { currency: evidence.currency } : {}
      : { currency: currency as string }),
    ...(successful && (
      evidence?.consistent !== true
      || evidence.paymentId !== paymentId
      || evidence.shopOrderId !== shopOrderId
      || rawPaymentId !== paymentId
      || rawShopOrderId !== shopOrderId
      || evidence.providerPaymentId !== providerPaymentId
      || evidence.amountCents !== amount
      || evidence.currency !== currency
      || evidence.livemode !== event.livemode
      || data?.pricingVersion !== SHOP_PAYMENT_PRICING_VERSION
      || data?.paymentSource !== "SHOP_ORDER"
      || session?.client_reference_id !== shopOrderId
    ) ? { evidenceConsistent: false } : {}),
    ...(!successful && (
      rawPaymentId !== paymentId
      || rawShopOrderId !== shopOrderId
      || data?.paymentSource !== "SHOP_ORDER"
      || data?.pricingVersion !== SHOP_PAYMENT_PRICING_VERSION
      || session?.client_reference_id !== shopOrderId
      || checkoutAmountCents === undefined
      || currency !== "EUR"
    ) ? { evidenceConsistent: false } : {}),
    status,
    occurredAt: eventTime,
    ...(evidence?.paymentMethod ? { paymentMethod: evidence.paymentMethod } : {}),
    ...(status === "FAILED" ? { failureCode: "STRIPE_SHOP_PAYMENT_FAILED" } : {}),
    ...(status === "EXPIRED" ? { failureCode: "STRIPE_SHOP_CHECKOUT_EXPIRED" } : {}),
  };
}

function normalizeShopStripeIntentFailure(
  event: EnrichedShopStripeWebhookEvent,
): ShopPaymentProviderEvent | null {
  const intent = record(event.data.object);
  const data = metadata(intent);
  const eventTime = occurredAt(event);
  const rawPaymentId = bounded(data?.paymentId);
  const rawShopOrderId = bounded(data?.shopOrderId);
  const paymentId = event.shopResolvedPaymentId
    ?? (UUID.test(rawPaymentId ?? "") ? rawPaymentId : undefined);
  const shopOrderId = event.shopResolvedOrderId
    ?? (UUID.test(rawShopOrderId ?? "") ? rawShopOrderId : undefined);
  const intentId = bounded(intent?.id);
  if (
    event.type !== "payment_intent.payment_failed"
    || !eventTime
    || !intentId
    || !UUID.test(paymentId ?? "")
    || (data?.paymentSource !== "SHOP_ORDER" && event.shopPaymentSourceResolved !== true)
    || intent?.object !== "payment_intent"
    || intent?.livemode !== event.livemode
    || intent?.status !== "requires_payment_method"
  ) return null;
  const amountCents = Number.isSafeInteger(intent?.amount) && Number(intent?.amount) > 0
    ? Number(intent?.amount)
    : undefined;
  const currency = bounded(intent?.currency, 3)?.toUpperCase();
  return {
    eventId: event.id,
    type: event.type,
    provider: "STRIPE",
    livemode: event.livemode,
    paymentId: paymentId as string,
    ...(UUID.test(shopOrderId ?? "")
      ? { providerSourceShopOrderId: shopOrderId as string }
      : {}),
    providerPaymentId: intentId,
    ...(amountCents !== undefined ? { amountCents } : {}),
    ...(currency ? { currency } : {}),
    status: "FAILED",
    occurredAt: eventTime,
    failureCode: "STRIPE_SHOP_PAYMENT_INTENT_FAILED",
    ...(data?.paymentSource !== "SHOP_ORDER"
      || data?.pricingVersion !== SHOP_PAYMENT_PRICING_VERSION
      || rawPaymentId !== paymentId
      || rawShopOrderId !== shopOrderId
      || !UUID.test(shopOrderId ?? "")
      || amountCents === undefined
      || currency !== "EUR"
      ? { evidenceConsistent: false }
      : {}),
  };
}

export function normalizeShopStripeWebhookEvent(
  event: EnrichedShopStripeWebhookEvent,
) {
  if (!SHOP_STRIPE_EVENTS.has(event.type) || !isShopStripeWebhookEvent(event)) return null;
  return event.type === "payment_intent.payment_failed"
    ? normalizeShopStripeIntentFailure(event)
    : normalizeShopStripeCheckout(event);
}

export async function processVerifiedShopStripeWebhookEvent(
  event: EnrichedShopStripeWebhookEvent,
  repository: ShopWebhookRepository = shopPaymentDatabaseRepository,
) {
  const normalized = normalizeShopStripeWebhookEvent(event);
  if (normalized) return repository.reconcile(normalized);
  const object = record(event.data.object);
  const timestamp = occurredAt(event) ?? new Date();
  return repository.recordUnmatched({
    provider: "STRIPE",
    eventId: event.id,
    type: event.type,
    livemode: event.livemode,
    ...(bounded(object?.id) ? { objectId: bounded(object?.id) as string } : {}),
    occurredAt: timestamp,
  });
}

export function createPaypalPaymentSourceLookup(
  findPayment: PaypalPaymentFinder = (where) => prisma.payment.findFirst({
    where,
    select: { id: true, orderId: true, shopOrderId: true },
  }),
): PaymentSourceLookup {
  return {
    async resolvePaypalPayment(providerOrderId, paymentId) {
      const byProviderOrder = await findPayment({
        provider: "PAYPAL",
        providerCheckoutId: providerOrderId,
      });
      if (byProviderOrder) return byProviderOrder;
      if (!paymentId || !UUID.test(paymentId)) return null;
      return findPayment({ id: paymentId, provider: "PAYPAL" });
    },
  };
}

type ShopPaypalIdentity = Readonly<{
  providerOrderId: string;
  providerSourcePaymentId?: string;
  providerPaymentId?: string;
  occurredAt: Date;
}>;

function shopPaypalIdentity(event: VerifiedPaypalWebhookEvent): ShopPaypalIdentity | null {
  if (!SHOP_PAYPAL_EVENTS.has(event.event_type)) return null;
  const resource = record(event.resource);
  const eventTime = new Date(event.create_time);
  if (!resource || Number.isNaN(eventTime.getTime())) return null;
  if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
    const purchaseUnit = Array.isArray(resource.purchase_units)
      ? record(resource.purchase_units[0])
      : null;
    const providerOrderId = bounded(resource.id);
    if (!providerOrderId) return null;
    const providerSourcePaymentId = bounded(purchaseUnit?.custom_id);
    return {
      providerOrderId,
      ...(providerSourcePaymentId ? { providerSourcePaymentId } : {}),
      occurredAt: eventTime,
    };
  }
  const relatedIds = record(record(resource.supplementary_data)?.related_ids);
  const providerOrderId = bounded(relatedIds?.order_id);
  const providerPaymentId = bounded(resource.id);
  if (!providerOrderId || !providerPaymentId) return null;
  const providerSourcePaymentId = bounded(resource.custom_id);
  return {
    providerOrderId,
    providerPaymentId,
    ...(providerSourcePaymentId ? { providerSourcePaymentId } : {}),
    occurredAt: eventTime,
  };
}

function shopPaypalProviderEvent(
  event: VerifiedPaypalWebhookEvent,
  identity: ShopPaypalIdentity,
  paymentId: string,
  livemode: boolean,
): ShopPaymentProviderEvent | null {
  const resource = record(event.resource);
  const purchaseUnit = event.event_type === "CHECKOUT.ORDER.APPROVED" && Array.isArray(resource?.purchase_units)
    ? record(resource.purchase_units[0])
    : null;
  const amount = record(event.event_type === "CHECKOUT.ORDER.APPROVED" ? purchaseUnit?.amount : resource?.amount);
  const rawCurrency = bounded(amount?.currency_code, 3)?.toUpperCase();
  let amountCents: number | undefined;
  try {
    amountCents = paypalCentsFromAmount(amount?.value);
  } catch {
    amountCents = undefined;
  }
  const status: ShopPaymentProviderEvent["status"] = event.event_type === "PAYMENT.CAPTURE.COMPLETED"
    ? "SUCCEEDED"
    : event.event_type === "PAYMENT.CAPTURE.DECLINED"
      ? "FAILED"
      : "PENDING";
  const providerStatusConsistent = event.event_type === "PAYMENT.CAPTURE.COMPLETED"
    ? resource?.status === "COMPLETED"
    : event.event_type === "PAYMENT.CAPTURE.DECLINED"
      ? resource?.status === "DECLINED"
      : event.event_type === "PAYMENT.CAPTURE.PENDING"
        ? resource?.status === "PENDING"
        // PayPal can deliver CHECKOUT.ORDER.APPROVED after the application has
        // already captured the Order. In that race the signed event type still
        // means "approval only", while its embedded Order reflects the newer
        // COMPLETED state. It must remain non-financial PENDING evidence and
        // must never poison an already confirmed payment.
        : resource?.status === "APPROVED" || resource?.status === "COMPLETED";
  const normalized = normalizePaypalWebhookEvent(event);
  const evidenceConsistent = event.event_type === "CHECKOUT.ORDER.APPROVED"
    ? providerStatusConsistent && amountCents !== undefined && rawCurrency === "EUR"
    : normalized !== null && providerStatusConsistent;
  return {
    eventId: event.id,
    type: event.event_type,
    provider: "PAYPAL",
    livemode,
    paymentId,
    ...(identity.providerSourcePaymentId
      ? { providerSourcePaymentId: identity.providerSourcePaymentId }
      : {}),
    providerCheckoutId: identity.providerOrderId,
    ...(identity.providerPaymentId ? { providerPaymentId: identity.providerPaymentId } : {}),
    ...(amountCents !== undefined ? { amountCents } : {}),
    ...(rawCurrency ? { currency: rawCurrency } : {}),
    ...(evidenceConsistent ? {} : { evidenceConsistent: false }),
    status,
    occurredAt: identity.occurredAt,
    ...(status === "SUCCEEDED" ? { paymentMethod: "PAYPAL" as const } : {}),
    ...(status === "FAILED" ? { failureCode: "PAYPAL_SHOP_CAPTURE_DECLINED" } : {}),
  };
}

export async function processVerifiedPaypalWebhookEventByPaymentSource(
  event: VerifiedPaypalWebhookEvent,
  environment: PaypalPaymentEnvironment,
  dependencies?: Readonly<{
    sourceLookup: PaymentSourceLookup;
    shopRepository: ShopWebhookRepository;
    musicRepository?: PaypalCaptureRepository;
  }>,
) {
  const sourceLookup = dependencies?.sourceLookup ?? createPaypalPaymentSourceLookup();
  const shopRepository = dependencies?.shopRepository ?? createShopPaymentDatabaseRepository(
    undefined,
    environment === "live" ? "LIVE" : "TEST",
  );
  const musicRepository = dependencies?.musicRepository;
  const identity = shopPaypalIdentity(event);
  if (!identity) {
    if (musicRepository) return processVerifiedPaypalWebhookEvent(event, musicRepository);
    const { createPaymentDatabasePaypalCaptureRepository } = await import("@/lib/payments/paypal-service");
    return processVerifiedPaypalWebhookEvent(event, createPaymentDatabasePaypalCaptureRepository(prisma, environment === "live" ? "LIVE" : "TEST"));
  }
  const source = await sourceLookup.resolvePaypalPayment(
    identity.providerOrderId,
    identity.providerSourcePaymentId,
  );
  if (!source?.shopOrderId || source.orderId) {
    if (musicRepository) return processVerifiedPaypalWebhookEvent(event, musicRepository);
    const { createPaymentDatabasePaypalCaptureRepository } = await import("@/lib/payments/paypal-service");
    return processVerifiedPaypalWebhookEvent(event, createPaymentDatabasePaypalCaptureRepository(prisma, environment === "live" ? "LIVE" : "TEST"));
  }
  const shopEvent = shopPaypalProviderEvent(
    event,
    identity,
    source.id,
    environment === "live",
  );
  if (shopEvent) return shopRepository.reconcile(shopEvent);
  return shopRepository.recordUnmatched({
    provider: "PAYPAL",
    eventId: event.id,
    type: event.event_type,
    livemode: environment === "live",
    objectId: identity.providerPaymentId ?? identity.providerOrderId,
    occurredAt: identity.occurredAt,
  });
}
