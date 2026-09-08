import "server-only";

import type { OrderActor } from "@/lib/orders/domain";
import { isAllowedOrderMutation, orderActorFromHeaders } from "@/lib/orders/request";
import { capturePaypalOrderForRights, createPaypalOrderForRights, createStripeCheckoutForRights } from "@/lib/rights/payment-service";
import { RightsPaymentError } from "@/lib/rights/payment-repository";
import type { RightsPaymentActor } from "@/lib/rights/payment-types";

type Context = { params: Promise<{ requestNumber: string }> };
const MAX = 4096;

function json(body: object, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function actor(request: Request): Promise<RightsPaymentActor | Response> {
  if (!isAllowedOrderMutation(request)) return json({ ok: false, code: "RIGHTS_PAYMENT_ACCESS_DENIED" }, 403);
  const value: OrderActor | null = await orderActorFromHeaders(request.headers).catch(() => null);
  if (!value || value.status !== "ACTIVE" || !value.emailVerified || !["MEMBER", "CUSTOMER"].includes(value.role)) return json({ ok: false, code: "RIGHTS_PAYMENT_ACCESS_DENIED" }, value ? 403 : 401);
  return { id: value.id, email: value.email, role: value.role as "MEMBER" | "CUSTOMER", status: "ACTIVE", emailVerified: true };
}

async function body(request: Request) {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new RightsPaymentError(415, "INVALID_RIGHTS_PAYMENT_PAYLOAD");
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX) throw new RightsPaymentError(413, "INVALID_RIGHTS_PAYMENT_PAYLOAD");
  try { return JSON.parse(text) as unknown; } catch { throw new RightsPaymentError(400, "INVALID_RIGHTS_PAYMENT_PAYLOAD"); }
}

function failure(error: unknown) {
  return error instanceof RightsPaymentError
    ? json({ ok: false, code: error.code }, error.status)
    : json({ ok: false, code: "RIGHTS_PAYMENT_UNAVAILABLE" }, 503);
}

export async function handleRightsStripeCheckout(request: Request, context: Context) {
  const current = await actor(request);
  if (current instanceof Response) return current;
  try {
    const payload = await body(request);
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 1 || (payload as { contractAccepted?: unknown }).contractAccepted !== true) throw new RightsPaymentError(409, "RIGHTS_CONTRACT_ACCEPTANCE_REQUIRED");
    return json(await createStripeCheckoutForRights(current, (await context.params).requestNumber, true), 200);
  } catch (error) { return failure(error); }
}

export async function handleRightsPaypalCheckout(request: Request, context: Context) {
  const current = await actor(request);
  if (current instanceof Response) return current;
  try {
    const payload = await body(request);
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 1 || (payload as { contractAccepted?: unknown }).contractAccepted !== true) throw new RightsPaymentError(409, "RIGHTS_CONTRACT_ACCEPTANCE_REQUIRED");
    return json(await createPaypalOrderForRights(current, (await context.params).requestNumber, true), 200);
  } catch (error) { return failure(error); }
}

export async function handleRightsPaypalCapture(request: Request, context: Context) {
  const current = await actor(request);
  if (current instanceof Response) return current;
  try {
    const payload = await body(request) as { providerOrderId?: unknown };
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 1 || typeof payload.providerOrderId !== "string" || !/^[A-Za-z0-9_-]{6,255}$/.test(payload.providerOrderId)) throw new RightsPaymentError(400, "INVALID_RIGHTS_PAYMENT_PAYLOAD");
    return json(await capturePaypalOrderForRights(current, (await context.params).requestNumber, payload.providerOrderId), 200);
  } catch (error) { return failure(error); }
}
