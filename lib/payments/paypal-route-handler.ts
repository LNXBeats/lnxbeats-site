import "server-only";

import type { OrderActor } from "@/lib/orders/domain";
import { isAllowedOrderMutation, orderActorFromHeaders } from "@/lib/orders/request";
import {
  capturePaypalOrderForOrder,
  createPaypalOrderForOrder,
  type PaypalCheckoutResult,
} from "@/lib/payments/paypal-service";
import { PaymentServiceError } from "@/lib/payments/service";
import { assertPaymentsRuntimeEnvironment } from "@/lib/payments/runtime";

type RouteContext = { params: Promise<{ orderNumber: string }> };

export const PAYPAL_CAPTURE_REQUEST_MAX_BYTES = 4_096;

type CommonDependencies = Readonly<{
  isAllowedMutation(request: Request): boolean;
  assertRuntime(): Promise<void>;
  actorFromHeaders(headers: Headers): Promise<OrderActor | null>;
}>;

export type PaypalCheckoutRouteDependencies = CommonDependencies & Readonly<{
  createOrder(actor: OrderActor, orderNumber: string): Promise<PaypalCheckoutResult>;
}>;

export type PaypalCaptureRouteDependencies = CommonDependencies & Readonly<{
  captureOrder(actor: OrderActor, orderNumber: string, providerOrderId: string): Promise<{ confirmed: boolean; pending: boolean }>;
}>;

const commonDependencies: CommonDependencies = {
  isAllowedMutation: isAllowedOrderMutation,
  assertRuntime: async () => {
    await assertPaymentsRuntimeEnvironment();
  },
  actorFromHeaders: orderActorFromHeaders,
};

const checkoutDependencies: PaypalCheckoutRouteDependencies = {
  ...commonDependencies,
  createOrder: createPaypalOrderForOrder,
};

const captureDependencies: PaypalCaptureRouteDependencies = {
  ...commonDependencies,
  captureOrder: capturePaypalOrderForOrder,
};

function json(body: object, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function authenticatedActor(
  request: Request,
  dependencies: CommonDependencies,
) {
  if (!dependencies.isAllowedMutation(request)) {
    return { ok: false, response: json({ error: "Le paiement ne peut pas être préparé.", code: "PAYMENT_ACCESS_DENIED" }, 403) } as const;
  }
  try {
    await dependencies.assertRuntime();
  } catch {
    return { ok: false, response: json({ error: "Le paiement ne peut pas être préparé.", code: "PAYMENT_UNAVAILABLE" }, 503) } as const;
  }
  let actor: OrderActor | null;
  try {
    actor = await dependencies.actorFromHeaders(request.headers);
  } catch {
    return { ok: false, response: json({ error: "Le paiement ne peut pas être préparé.", code: "PAYMENT_UNAVAILABLE" }, 503) } as const;
  }
  if (!actor || actor.status !== "ACTIVE" || actor.emailVerified !== true) {
    return { ok: false, response: json({ error: "Le paiement ne peut pas être préparé.", code: "PAYMENT_ACCESS_DENIED" }, actor ? 403 : 401) } as const;
  }
  return { ok: true, actor } as const;
}

function serviceError(error: unknown) {
  return error instanceof PaymentServiceError
    ? json({ error: error.message, code: error.code }, error.status)
    : json({ error: "Le paiement ne peut pas être préparé.", code: "PAYMENT_UNAVAILABLE" }, 503);
}

async function boundedJsonBody(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return { ok: false, response: json({ error: "La confirmation PayPal est invalide.", code: "ORDER_NOT_PAYABLE" }, 415) } as const;
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      return { ok: false, response: json({ error: "La confirmation PayPal est invalide.", code: "ORDER_NOT_PAYABLE" }, 400) } as const;
    }
    if (length > PAYPAL_CAPTURE_REQUEST_MAX_BYTES) {
      return { ok: false, response: json({ error: "La confirmation PayPal est invalide.", code: "ORDER_NOT_PAYABLE" }, 413) } as const;
    }
  }
  if (!request.body) {
    return { ok: false, response: json({ error: "La confirmation PayPal est invalide.", code: "ORDER_NOT_PAYABLE" }, 400) } as const;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > PAYPAL_CAPTURE_REQUEST_MAX_BYTES) {
      await reader.cancel();
      return { ok: false, response: json({ error: "La confirmation PayPal est invalide.", code: "ORDER_NOT_PAYABLE" }, 413) } as const;
    }
    chunks.push(value);
  }
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks, total).toString("utf8")) as unknown } as const;
  } catch {
    return { ok: false, response: json({ error: "La confirmation PayPal est invalide.", code: "ORDER_NOT_PAYABLE" }, 400) } as const;
  }
}

export async function handlePaypalCheckoutPost(
  request: Request,
  context: RouteContext,
  dependencies: PaypalCheckoutRouteDependencies = checkoutDependencies,
): Promise<Response> {
  const authenticated = await authenticatedActor(request, dependencies);
  if (!authenticated.ok) return authenticated.response;
  try {
    const { orderNumber } = await context.params;
    return json(await dependencies.createOrder(authenticated.actor, orderNumber), 200);
  } catch (error) {
    return serviceError(error);
  }
}

export async function handlePaypalCapturePost(
  request: Request,
  context: RouteContext,
  dependencies: PaypalCaptureRouteDependencies = captureDependencies,
): Promise<Response> {
  const authenticated = await authenticatedActor(request, dependencies);
  if (!authenticated.ok) return authenticated.response;
  const parsed = await boundedJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (
    body === null
    || typeof body !== "object"
    || Array.isArray(body)
    || typeof (body as { providerOrderId?: unknown }).providerOrderId !== "string"
    || !/^[A-Za-z0-9_-]{6,255}$/.test((body as { providerOrderId: string }).providerOrderId)
  ) {
    return json({ error: "La confirmation PayPal est invalide.", code: "ORDER_NOT_PAYABLE" }, 400);
  }
  const providerOrderId = (body as { providerOrderId: string }).providerOrderId;
  try {
    const { orderNumber } = await context.params;
    return json(await dependencies.captureOrder(authenticated.actor, orderNumber, providerOrderId), 200);
  } catch (error) {
    return serviceError(error);
  }
}
