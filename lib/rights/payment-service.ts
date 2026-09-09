import "server-only";

import { createHash } from "node:crypto";

import {
  createPaypalGateway,
  createPaypalReconciliationGateway,
  type PaypalGateway,
} from "@/lib/payments/paypal-client";
import {
  createStripeCheckoutGateway,
  type HostedCheckoutRequest,
  type StripeCheckoutGateway,
} from "@/lib/payments/stripe-client";
import { assertPaymentsRuntimeEnvironment, assertPaypalWebhookRuntimeEnvironment } from "@/lib/payments/runtime";
import { assertRightsPaymentsOpen } from "@/lib/rights/payment-config";
import { createRightsPaymentRepository, RightsPaymentError } from "@/lib/rights/payment-repository";
import type { RightsPaymentActor, RightsProviderEvent } from "@/lib/rights/payment-types";

type Provider = "STRIPE" | "PAYPAL";
type Mode = "TEST" | "LIVE";

type Repository = ReturnType<typeof createRightsPaymentRepository>;

export type RightsCheckoutDependencies = Readonly<{
  repository: Repository;
  stripe?: StripeCheckoutGateway;
  paypal?: PaypalGateway;
  baseUrl: string;
  mode: Mode;
  skipGate?: boolean;
}>;

function assertActor(actor: RightsPaymentActor) {
  if (actor.status !== "ACTIVE" || actor.emailVerified !== true || !["MEMBER", "CUSTOMER"].includes(actor.role)) {
    throw new RightsPaymentError(403, "RIGHTS_PAYMENT_ACCESS_DENIED");
  }
}

function origin(baseUrl: string) {
  const url = new URL(baseUrl);
  if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password || (url.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname))) {
    throw new RightsPaymentError(503, "RIGHTS_PAYMENT_UNAVAILABLE");
  }
  return url.origin;
}

export function rightsPaymentReturnUrls(requestNumber: string, baseUrl: string) {
  if (!/^LNX-LIC-[0-9]{4}-[0-9]{6,}$/.test(requestNumber)) throw new RightsPaymentError(400, "RIGHTS_REQUEST_NOT_PAYABLE");
  const page = new URL(`/compte/droits/${encodeURIComponent(requestNumber)}`, origin(baseUrl));
  const stripeSuccess = new URL(page); stripeSuccess.search = "?paiement=retour&session_id={CHECKOUT_SESSION_ID}";
  const stripeCancel = new URL(page); stripeCancel.search = "?paiement=annule";
  const paypalReturn = new URL(page); paypalReturn.search = "?paiement=paypal-retour";
  const paypalCancel = new URL(page); paypalCancel.search = "?paiement=paypal-annule";
  return { stripeSuccess: stripeSuccess.toString(), stripeCancel: stripeCancel.toString(), paypalReturn: paypalReturn.toString(), paypalCancel: paypalCancel.toString() };
}

async function defaults(provider: Provider): Promise<RightsCheckoutDependencies> {
  assertRightsPaymentsOpen();
  const configuration = await assertPaymentsRuntimeEnvironment();
  const mode: Mode = configuration.deploymentEnvironment === "production" ? "LIVE" : "TEST";
  const baseUrl = process.env.APP_CANONICAL_URL ?? process.env.AUTH_URL ?? process.env.SITE_URL;
  if (!baseUrl) throw new RightsPaymentError(503, "RIGHTS_PAYMENT_UNAVAILABLE");
  return {
    repository: createRightsPaymentRepository(undefined, mode), baseUrl, mode,
    ...(provider === "STRIPE" ? { stripe: createStripeCheckoutGateway() } : { paypal: createPaypalGateway() }),
  };
}

function ensureGate(dependencies: RightsCheckoutDependencies) {
  if (!dependencies.skipGate) assertRightsPaymentsOpen();
}

export async function createStripeCheckoutForRights(actor: RightsPaymentActor, requestNumber: string, contractAccepted: unknown, dependencies?: RightsCheckoutDependencies) {
  assertActor(actor);
  if (contractAccepted !== true) throw new RightsPaymentError(409, "RIGHTS_CONTRACT_ACCEPTANCE_REQUIRED");
  const resolved = dependencies ?? await defaults("STRIPE");
  ensureGate(resolved);
  if (!resolved.stripe) throw new RightsPaymentError(503, "RIGHTS_PAYMENT_UNAVAILABLE");
  const attempt = await resolved.repository.reserveAttempt(actor.id, requestNumber, "STRIPE", resolved.mode);
  const urls = rightsPaymentReturnUrls(requestNumber, resolved.baseUrl);
  const request: HostedCheckoutRequest = {
    paymentSource: "RIGHTS_REQUEST",
    rightsRequestId: attempt.rightsRequestId,
    orderNumber: attempt.requestNumber,
    paymentId: attempt.paymentId,
    pricingVersion: attempt.pricingVersion,
    lineItems: [{ quantity: 1, price_data: { currency: "eur", unit_amount: 15_000, product_data: { name: `Licence de publication via distributeur — ${attempt.workTitle}` } } }],
    customerEmail: actor.email,
    successUrl: urls.stripeSuccess,
    cancelUrl: urls.stripeCancel,
  };
  const session = attempt.providerCheckoutId
    ? await resolved.stripe.retrieveHostedCheckout(attempt.providerCheckoutId)
    : await resolved.stripe.createHostedCheckout(request, attempt.idempotencyKey);
  await resolved.repository.recordSession(attempt.paymentId, "STRIPE", session);
  return { checkoutUrl: session.url };
}

export async function createPaypalOrderForRights(actor: RightsPaymentActor, requestNumber: string, contractAccepted: unknown, dependencies?: RightsCheckoutDependencies) {
  assertActor(actor);
  if (contractAccepted !== true) throw new RightsPaymentError(409, "RIGHTS_CONTRACT_ACCEPTANCE_REQUIRED");
  const resolved = dependencies ?? await defaults("PAYPAL");
  ensureGate(resolved);
  if (!resolved.paypal) throw new RightsPaymentError(503, "RIGHTS_PAYMENT_UNAVAILABLE");
  const attempt = await resolved.repository.reserveAttempt(actor.id, requestNumber, "PAYPAL", resolved.mode);
  const urls = rightsPaymentReturnUrls(requestNumber, resolved.baseUrl);
  const request = {
    paymentSource: "RIGHTS_REQUEST" as const,
    rightsRequestId: attempt.rightsRequestId,
    orderNumber: attempt.requestNumber,
    paymentId: attempt.paymentId,
    amountCents: 15_000,
    currency: "EUR" as const,
    description: `Licence de publication via distributeur — ${attempt.workTitle}`,
    returnUrl: urls.paypalReturn,
    cancelUrl: urls.paypalCancel,
  };
  const providerOrder = attempt.providerCheckoutId
    ? await resolved.paypal.retrieveOrder(attempt.providerCheckoutId)
    : await resolved.paypal.createOrder(request, attempt.idempotencyKey);
  const approvalUrl = providerOrder.approvalUrl ?? `${urls.paypalReturn}&token=${encodeURIComponent(providerOrder.id)}`;
  await resolved.repository.recordSession(attempt.paymentId, "PAYPAL", { id: providerOrder.id, url: approvalUrl });
  return { approvalUrl };
}

export async function capturePaypalOrderForRights(actor: RightsPaymentActor, requestNumber: string, providerOrderId: string, dependencies?: RightsCheckoutDependencies) {
  assertActor(actor);
  const resolved = dependencies ?? await (async () => {
    const configuration = await assertPaypalWebhookRuntimeEnvironment();
    const mode: Mode = configuration.deploymentEnvironment === "production" ? "LIVE" : "TEST";
    const baseUrl = process.env.APP_CANONICAL_URL ?? process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost";
    return { repository: createRightsPaymentRepository(undefined, mode), paypal: createPaypalReconciliationGateway(), baseUrl, mode };
  })();
  // A capture completes an already-created PayPal order. Closing new Rights
  // sales must not strand that in-flight operation or its provider evidence.
  if (!resolved.paypal) throw new RightsPaymentError(503, "RIGHTS_PAYMENT_UNAVAILABLE");
  const reserved = await resolved.repository.reservePaypalCapture(actor.id, requestNumber, providerOrderId, resolved.mode);
  const capture = await resolved.paypal.captureOrder(reserved.providerOrderId, reserved.captureIdempotencyKey);
  const event: RightsProviderEvent = {
    eventId: `paypal-rights-capture:${capture.captureId ?? createHash("sha256").update(providerOrderId).digest("hex")}`,
    type: "PAYPAL.RIGHTS.CAPTURE.RESPONSE", provider: "PAYPAL", livemode: resolved.mode === "LIVE",
    paymentId: reserved.paymentId, providerCheckoutId: capture.providerOrderId,
    ...(capture.captureId ? { providerPaymentId: capture.captureId } : {}),
    ...(capture.amountCents !== undefined ? { amountCents: capture.amountCents } : {}),
    ...(capture.currency ? { currency: capture.currency } : {}),
    status: capture.status === "COMPLETED" ? "SUCCEEDED" : "PENDING",
    occurredAt: capture.occurredAt, paymentMethod: "PAYPAL",
    evidenceConsistent: capture.evidenceConsistent !== false && capture.paymentId === reserved.paymentId,
  };
  return resolved.repository.reconcile(event);
}
