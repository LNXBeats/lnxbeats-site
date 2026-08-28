import "server-only";

import { createHash } from "node:crypto";

import type { PaymentProvider, PersistedPaymentMode, ServerCheckoutLineItem } from "@/lib/payments/types";
import {
  createStripeCheckoutGateway,
  StripeCheckoutClientError,
  type HostedCheckoutRequest,
  type HostedCheckoutSession,
  type StripeCheckoutGateway,
} from "@/lib/payments/stripe-client";
import {
  createPaypalGateway,
  createPaypalReconciliationGateway,
  PaypalClientError,
  type PaypalCaptureResponseEvidence,
  type PaypalCreateOrderRequest,
  type PaypalGateway,
} from "@/lib/payments/paypal-client";
import {
  assertPaymentsRuntimeEnvironment,
  assertPaypalWebhookRuntimeEnvironment,
} from "@/lib/payments/runtime";
import { logPaymentEvent } from "@/lib/payments/observability";
import { assertShopPaymentProviderEnabled, shopPaymentProvidersAvailable } from "@/lib/shop/payment-config";
import { ShopPaymentServiceError } from "@/lib/shop/payment-errors";
import type {
  ReservedShopPaymentAttempt,
  ReservedShopPaypalCapture,
  ShopPaymentActor,
  ShopPaymentFinalizationResult,
  ShopPaymentProviderEvent,
} from "@/lib/shop/payment-types";

export { ShopPaymentServiceError, shopPaymentProvidersAvailable };

const SHOP_ORDER_NUMBER = /^LNX-SHOP-[0-9]{4}-[0-9]{6,}$/;

function paypalCaptureResponseEventId(captureId: string) {
  const prefix = "paypal-capture-response:";
  return captureId.length <= 255 - prefix.length
    ? `${prefix}${captureId}`
    : `${prefix}${createHash("sha256").update(captureId).digest("hex")}`;
}

export interface ShopPaymentCheckoutRepository {
  enforceRateLimit(actorId: string): Promise<void>;
  reserveAttempt(
    actorId: string,
    orderNumber: string,
    provider: PaymentProvider,
    mode: PersistedPaymentMode,
    termsAccepted: unknown,
  ): Promise<ReservedShopPaymentAttempt>;
  recordSession(
    paymentId: string,
    provider: PaymentProvider,
    session: HostedCheckoutSession,
  ): Promise<void>;
}

export interface ShopPaymentCaptureRepository {
  enforceRateLimit(actorId: string): Promise<void>;
  reservePaypalCapture(
    actorId: string,
    orderNumber: string,
    providerOrderId: string,
    mode: PersistedPaymentMode,
  ): Promise<ReservedShopPaypalCapture>;
  reconcile(
    event: ShopPaymentProviderEvent,
    now?: Date,
  ): Promise<ShopPaymentFinalizationResult>;
}

export type ShopStripeCheckoutDependencies = Readonly<{
  repository: ShopPaymentCheckoutRepository;
  gateway: StripeCheckoutGateway;
  baseUrl: string;
  mode: PersistedPaymentMode;
}>;

export type ShopPaypalCheckoutDependencies = Readonly<{
  repository: ShopPaymentCheckoutRepository;
  gateway: PaypalGateway;
  baseUrl: string;
  mode: PersistedPaymentMode;
}>;

export type ShopPaypalCaptureDependencies = Readonly<{
  repository: ShopPaymentCaptureRepository;
  gateway: PaypalGateway;
  mode: PersistedPaymentMode;
}>;

function assertShopPaymentActor(actor: ShopPaymentActor) {
  if (
    actor.status !== "ACTIVE"
    || actor.emailVerified !== true
    || (actor.role !== "MEMBER" && actor.role !== "CUSTOMER")
  ) {
    throw new ShopPaymentServiceError(403, "PAYMENT_ACCESS_DENIED");
  }
}

function assertShopOrderNumber(orderNumber: string) {
  if (!SHOP_ORDER_NUMBER.test(orderNumber)) {
    throw new ShopPaymentServiceError(400, "INVALID_ORDER_NUMBER");
  }
}

function canonicalOrigin(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:")
      || url.username
      || url.password
      || (url.protocol === "http:" && !["127.0.0.1", "localhost", "::1"].includes(url.hostname))
    ) throw new Error("Invalid origin.");
    return url.origin;
  } catch {
    throw new ShopPaymentServiceError(503, "PAYMENT_UNAVAILABLE");
  }
}

export function shopPaymentReturnUrls(orderNumber: string, baseUrl: string) {
  assertShopOrderNumber(orderNumber);
  const orderUrl = new URL(
    `/compte/achats/${encodeURIComponent(orderNumber)}`,
    canonicalOrigin(baseUrl),
  );
  const stripeSuccess = new URL(orderUrl);
  stripeSuccess.search = "?paiement=retour&session_id={CHECKOUT_SESSION_ID}";
  const paypalReturn = new URL(orderUrl);
  paypalReturn.search = "?paiement=paypal-retour";
  const stripeCancel = new URL(orderUrl);
  stripeCancel.search = "?paiement=annule";
  const paypalCancel = new URL(orderUrl);
  paypalCancel.search = "?paiement=paypal-annule";
  return {
    stripeSuccessUrl: stripeSuccess.toString(),
    stripeCancelUrl: stripeCancel.toString(),
    paypalReturnUrl: paypalReturn.toString(),
    paypalCancelUrl: paypalCancel.toString(),
  } as const;
}

function stripeLineItems(attempt: ReservedShopPaymentAttempt): readonly ServerCheckoutLineItem[] {
  const items: ServerCheckoutLineItem[] = attempt.lines.map((line) => ({
    quantity: 1,
    price_data: {
      currency: "eur",
      unit_amount: line.lineTotalCents,
      product_data: {
        name: line.quantity === 1 ? line.title : `${line.title} × ${line.quantity}`,
      },
    },
  }));
  if (attempt.shippingCents > 0) {
    items.push({
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: attempt.shippingCents,
        product_data: { name: "Livraison" },
      },
    });
  }
  const total = items.reduce((sum, line) => sum + line.price_data.unit_amount, 0);
  if (
    items.length === 0
    || items.some((line) => !Number.isSafeInteger(line.price_data.unit_amount) || line.price_data.unit_amount <= 0)
    || total !== attempt.amountCents
  ) {
    throw new ShopPaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
  }
  return items;
}

function stripeRequest(
  attempt: ReservedShopPaymentAttempt,
  email: string,
  baseUrl: string,
): HostedCheckoutRequest {
  const urls = shopPaymentReturnUrls(attempt.orderNumber, baseUrl);
  return {
    paymentSource: "SHOP_ORDER",
    shopOrderId: attempt.shopOrderId,
    orderNumber: attempt.orderNumber,
    paymentId: attempt.paymentId,
    pricingVersion: attempt.pricingVersion,
    lineItems: stripeLineItems(attempt),
    customerEmail: email,
    successUrl: urls.stripeSuccessUrl,
    cancelUrl: urls.stripeCancelUrl,
  };
}

function paypalRequest(
  attempt: ReservedShopPaymentAttempt,
  baseUrl: string,
): PaypalCreateOrderRequest {
  const urls = shopPaymentReturnUrls(attempt.orderNumber, baseUrl);
  return {
    paymentSource: "SHOP_ORDER",
    shopOrderId: attempt.shopOrderId,
    orderNumber: attempt.orderNumber,
    paymentId: attempt.paymentId,
    amountCents: attempt.amountCents,
    currency: attempt.currency,
    description: `Commande Boutique LNX Beats ${attempt.orderNumber}`,
    returnUrl: urls.paypalReturnUrl,
    cancelUrl: urls.paypalCancelUrl,
  };
}

async function databaseCheckoutDependencies(
  provider: PaymentProvider,
): Promise<ShopStripeCheckoutDependencies | ShopPaypalCheckoutDependencies> {
  assertShopPaymentProviderEnabled(provider);
  const configuration = await assertPaymentsRuntimeEnvironment();
  const baseUrl = process.env.APP_CANONICAL_URL ?? process.env.AUTH_URL ?? process.env.SITE_URL;
  if (!baseUrl) throw new ShopPaymentServiceError(503, "PAYMENT_UNAVAILABLE");
  const { createShopPaymentDatabaseRepository } = await import("@/lib/shop/payment-repository");
  const mode: PersistedPaymentMode = configuration.deploymentEnvironment === "production" ? "LIVE" : "TEST";
  const repository = createShopPaymentDatabaseRepository(undefined, mode);
  return provider === "STRIPE"
    ? { repository, gateway: createStripeCheckoutGateway(), baseUrl, mode }
    : { repository, gateway: createPaypalGateway(), baseUrl, mode };
}

export async function createStripeCheckoutForShopOrder(
  actor: ShopPaymentActor,
  orderNumber: string,
  termsAccepted: unknown,
  dependencies?: ShopStripeCheckoutDependencies,
) {
  assertShopPaymentActor(actor);
  assertShopOrderNumber(orderNumber);
  if (termsAccepted !== true) {
    throw new ShopPaymentServiceError(409, "TERMS_NOT_ACCEPTED");
  }
  try {
    const resolved = dependencies
      ?? await databaseCheckoutDependencies("STRIPE") as ShopStripeCheckoutDependencies;
    await resolved.repository.enforceRateLimit(actor.id);
    const attempt = await resolved.repository.reserveAttempt(
      actor.id,
      orderNumber,
      "STRIPE",
      resolved.mode,
      termsAccepted,
    );
    const request = stripeRequest(attempt, actor.email, resolved.baseUrl);
    const session = attempt.providerCheckoutId
      ? await resolved.gateway.retrieveHostedCheckout(attempt.providerCheckoutId)
      : await resolved.gateway.createHostedCheckout(request, attempt.idempotencyKey);
    await resolved.repository.recordSession(attempt.paymentId, "STRIPE", session);
    logPaymentEvent("payment.session.created", {
      paymentId: attempt.paymentId,
      shopOrderId: attempt.shopOrderId,
    });
    return { checkoutUrl: session.url } as const;
  } catch (error) {
    if (error instanceof ShopPaymentServiceError) throw error;
    if (error instanceof StripeCheckoutClientError) logPaymentEvent("payment.session.failed");
    throw new ShopPaymentServiceError(503, "PAYMENT_UNAVAILABLE");
  }
}

export async function createPaypalOrderForShopOrder(
  actor: ShopPaymentActor,
  orderNumber: string,
  termsAccepted: unknown,
  dependencies?: ShopPaypalCheckoutDependencies,
) {
  assertShopPaymentActor(actor);
  assertShopOrderNumber(orderNumber);
  if (termsAccepted !== true) {
    throw new ShopPaymentServiceError(409, "TERMS_NOT_ACCEPTED");
  }
  try {
    const resolved = dependencies
      ?? await databaseCheckoutDependencies("PAYPAL") as ShopPaypalCheckoutDependencies;
    await resolved.repository.enforceRateLimit(actor.id);
    const attempt = await resolved.repository.reserveAttempt(
      actor.id,
      orderNumber,
      "PAYPAL",
      resolved.mode,
      termsAccepted,
    );
    const request = paypalRequest(attempt, resolved.baseUrl);
    const providerOrder = attempt.providerCheckoutId
      ? await resolved.gateway.retrieveOrder(attempt.providerCheckoutId)
      : await resolved.gateway.createOrder(request, attempt.idempotencyKey);
    const approvalUrl = providerOrder.approvalUrl
      ?? `${request.returnUrl}&token=${encodeURIComponent(providerOrder.id)}`;
    await resolved.repository.recordSession(attempt.paymentId, "PAYPAL", {
      id: providerOrder.id,
      url: approvalUrl,
    });
    logPaymentEvent("payment.session.created", {
      paymentId: attempt.paymentId,
      shopOrderId: attempt.shopOrderId,
    });
    return { approvalUrl } as const;
  } catch (error) {
    if (error instanceof ShopPaymentServiceError) throw error;
    if (error instanceof PaypalClientError) logPaymentEvent("payment.session.failed");
    throw new ShopPaymentServiceError(503, "PAYMENT_UNAVAILABLE");
  }
}

async function databaseCaptureDependencies(): Promise<ShopPaypalCaptureDependencies> {
  // Do not consult SHOP_ENABLED / SHOP_PAYMENTS_ENABLED here. Those switches
  // close new Checkout creation only; an already persisted PayPal attempt must
  // remain capturable/reconcilable. The historical reconciliation gate still
  // protects credentials, provider mode and the deployment/QA database while
  // deliberately ignoring Checkout-opening kill switches.
  const configuration = await assertPaypalWebhookRuntimeEnvironment();
  const mode: PersistedPaymentMode = configuration.deploymentEnvironment === "production" ? "LIVE" : "TEST";
  const { createShopPaymentDatabaseRepository } = await import("@/lib/shop/payment-repository");
  return {
    repository: createShopPaymentDatabaseRepository(undefined, mode),
    gateway: createPaypalReconciliationGateway(),
    mode,
  };
}

export async function capturePaypalOrderForShopOrder(
  actor: ShopPaymentActor,
  orderNumber: string,
  providerOrderId: string,
  dependencies?: ShopPaypalCaptureDependencies,
) {
  assertShopPaymentActor(actor);
  assertShopOrderNumber(orderNumber);
  if (!providerOrderId || providerOrderId.length > 255) {
    throw new ShopPaymentServiceError(400, "ORDER_NOT_PAYABLE");
  }
  try {
    const resolved = dependencies ?? await databaseCaptureDependencies();
    await resolved.repository.enforceRateLimit(actor.id);
    const reserved = await resolved.repository.reservePaypalCapture(
      actor.id,
      orderNumber,
      providerOrderId,
      resolved.mode,
    );
    const capture: PaypalCaptureResponseEvidence = await resolved.gateway.captureOrder(
      reserved.providerOrderId,
      reserved.captureIdempotencyKey,
    );
    const evidenceConsistent = capture.evidenceConsistent !== false
      && capture.captureId !== undefined
      && capture.paymentId === reserved.paymentId
      && capture.providerOrderId === reserved.providerOrderId
      && capture.amountCents === reserved.amountCents
      && capture.currency === reserved.currency;
    const result = await resolved.repository.reconcile({
      eventId: paypalCaptureResponseEventId(
        capture.captureId ?? `ambiguous:${reserved.providerOrderId}`,
      ),
      type: "PAYPAL.CAPTURE.RESPONSE",
      provider: "PAYPAL",
      livemode: resolved.mode === "LIVE",
      paymentId: reserved.paymentId,
      ...(capture.paymentId ? { providerSourcePaymentId: capture.paymentId } : {}),
      providerCheckoutId: capture.providerOrderId,
      ...(capture.captureId ? { providerPaymentId: capture.captureId } : {}),
      ...(capture.amountCents !== undefined ? { amountCents: capture.amountCents } : {}),
      ...(capture.currency ? { currency: capture.currency } : {}),
      ...(!evidenceConsistent ? { evidenceConsistent: false } : {}),
      status: capture.status === "COMPLETED" ? "SUCCEEDED" : "PENDING",
      occurredAt: capture.occurredAt,
      paymentMethod: "PAYPAL",
    });
    return {
      confirmed: result.shopOrderPaid,
      pending: capture.status === "PENDING",
      requiresReview: result.outcome === "REQUIRES_REVIEW",
    } as const;
  } catch (error) {
    if (error instanceof ShopPaymentServiceError) throw error;
    throw new ShopPaymentServiceError(503, "PAYMENT_UNAVAILABLE");
  }
}
