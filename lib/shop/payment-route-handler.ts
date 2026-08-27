import "server-only";

import type { OrderActor } from "@/lib/orders/domain";
import { isAllowedOrderMutation, orderActorFromHeaders } from "@/lib/orders/request";
import {
  capturePaypalOrderForShopOrder,
  createPaypalOrderForShopOrder,
  createStripeCheckoutForShopOrder,
  ShopPaymentServiceError,
} from "@/lib/shop/payment-service";
import type { ShopPaymentActor } from "@/lib/shop/payment-types";

type RouteContext = { params: Promise<{ orderNumber: string }> };
const MAX_BODY_BYTES = 4_096;

type CommonDependencies = Readonly<{
  isAllowedMutation(request: Request): boolean;
  actorFromHeaders(headers: Headers): Promise<OrderActor | null>;
}>;

export type ShopStripeCheckoutRouteDependencies = CommonDependencies & Readonly<{
  createCheckout(actor: ShopPaymentActor, orderNumber: string, termsAccepted: true): Promise<{ checkoutUrl: string }>;
}>;

export type ShopPaypalCheckoutRouteDependencies = CommonDependencies & Readonly<{
  createOrder(actor: ShopPaymentActor, orderNumber: string, termsAccepted: true): Promise<{ approvalUrl: string }>;
}>;

export type ShopPaypalCaptureRouteDependencies = CommonDependencies & Readonly<{
  captureOrder(actor: ShopPaymentActor, orderNumber: string, providerOrderId: string): Promise<{
    confirmed: boolean;
    pending: boolean;
    requiresReview?: boolean;
  }>;
}>;

const common: CommonDependencies = {
  isAllowedMutation: isAllowedOrderMutation,
  actorFromHeaders: orderActorFromHeaders,
};

const stripeDependencies: ShopStripeCheckoutRouteDependencies = {
  ...common,
  createCheckout: createStripeCheckoutForShopOrder,
};

const paypalCheckoutDependencies: ShopPaypalCheckoutRouteDependencies = {
  ...common,
  createOrder: createPaypalOrderForShopOrder,
};

const paypalCaptureDependencies: ShopPaypalCaptureRouteDependencies = {
  ...common,
  captureOrder: capturePaypalOrderForShopOrder,
};

function json(body: object, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function authenticate(request: Request, dependencies: CommonDependencies) {
  if (!dependencies.isAllowedMutation(request)) {
    return { ok: false, response: json({ ok: false, code: "PAYMENT_ACCESS_DENIED" }, 403) } as const;
  }
  let actor: OrderActor | null;
  try {
    actor = await dependencies.actorFromHeaders(request.headers);
  } catch {
    return { ok: false, response: json({ ok: false, code: "PAYMENT_UNAVAILABLE" }, 503) } as const;
  }
  if (
    !actor
    || actor.status !== "ACTIVE"
    || actor.emailVerified !== true
    || (actor.role !== "MEMBER" && actor.role !== "CUSTOMER")
  ) {
    return {
      ok: false,
      response: json({ ok: false, code: "PAYMENT_ACCESS_DENIED" }, actor ? 403 : 401),
    } as const;
  }
  return {
    ok: true,
    actor: {
      id: actor.id,
      email: actor.email,
      role: actor.role,
      status: "ACTIVE",
      emailVerified: true,
    } satisfies ShopPaymentActor,
  } as const;
}

async function boundedJson(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" || !request.body) {
    return { ok: false, response: json({ ok: false, code: "INVALID_PAYMENT_PAYLOAD" }, 415) } as const;
  }
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      return { ok: false, response: json({ ok: false, code: "INVALID_PAYMENT_PAYLOAD" }, 400) } as const;
    }
    if (length > MAX_BODY_BYTES) {
      return { ok: false, response: json({ ok: false, code: "INVALID_PAYMENT_PAYLOAD" }, 413) } as const;
    }
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return { ok: false, response: json({ ok: false, code: "INVALID_PAYMENT_PAYLOAD" }, 413) } as const;
    }
    chunks.push(value);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks, total).toString("utf8")) as unknown } as const;
  } catch {
    return { ok: false, response: json({ ok: false, code: "INVALID_PAYMENT_PAYLOAD" }, 400) } as const;
  }
}

function exactObject(value: unknown, key: string) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === 1
    && Object.prototype.hasOwnProperty.call(value, key)
    ? value as Record<string, unknown>
    : null;
}

function serviceError(error: unknown) {
  return error instanceof ShopPaymentServiceError
    ? json({ ok: false, code: error.code, error: error.message }, error.status)
    : json({ ok: false, code: "PAYMENT_UNAVAILABLE" }, 503);
}

async function acceptedTerms(request: Request) {
  const body = await boundedJson(request);
  if (!body.ok) return body;
  const record = exactObject(body.value, "termsAccepted");
  if (!record || record.termsAccepted !== true) {
    return { ok: false, response: json({ ok: false, code: "TERMS_NOT_ACCEPTED" }, 409) } as const;
  }
  return { ok: true, value: true as const } as const;
}

export async function handleShopStripeCheckoutPost(
  request: Request,
  context: RouteContext,
  dependencies: ShopStripeCheckoutRouteDependencies = stripeDependencies,
) {
  const authenticated = await authenticate(request, dependencies);
  if (!authenticated.ok) return authenticated.response;
  const terms = await acceptedTerms(request);
  if (!terms.ok) return terms.response;
  try {
    const { orderNumber } = await context.params;
    return json(await dependencies.createCheckout(authenticated.actor, orderNumber, true), 200);
  } catch (error) {
    return serviceError(error);
  }
}

export async function handleShopPaypalCheckoutPost(
  request: Request,
  context: RouteContext,
  dependencies: ShopPaypalCheckoutRouteDependencies = paypalCheckoutDependencies,
) {
  const authenticated = await authenticate(request, dependencies);
  if (!authenticated.ok) return authenticated.response;
  const terms = await acceptedTerms(request);
  if (!terms.ok) return terms.response;
  try {
    const { orderNumber } = await context.params;
    return json(await dependencies.createOrder(authenticated.actor, orderNumber, true), 200);
  } catch (error) {
    return serviceError(error);
  }
}

export async function handleShopPaypalCapturePost(
  request: Request,
  context: RouteContext,
  dependencies: ShopPaypalCaptureRouteDependencies = paypalCaptureDependencies,
) {
  const authenticated = await authenticate(request, dependencies);
  if (!authenticated.ok) return authenticated.response;
  const body = await boundedJson(request);
  if (!body.ok) return body.response;
  const record = exactObject(body.value, "providerOrderId");
  if (
    !record
    || typeof record.providerOrderId !== "string"
    || !/^[A-Za-z0-9_-]{6,255}$/.test(record.providerOrderId)
  ) {
    return json({ ok: false, code: "INVALID_PAYMENT_PAYLOAD" }, 400);
  }
  try {
    const { orderNumber } = await context.params;
    return json(await dependencies.captureOrder(
      authenticated.actor,
      orderNumber,
      record.providerOrderId,
    ), 200);
  } catch (error) {
    return serviceError(error);
  }
}
