import "server-only";

import type { OrderActor } from "@/lib/orders/domain";
import { isAllowedOrderMutation, orderActorFromHeaders } from "@/lib/orders/request";
import { submitRightsWithdrawal, RightsWithdrawalError } from "@/lib/rights/withdrawal";

type Context = { params: Promise<{ requestNumber: string }> };

function json(body: object, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function handleRightsWithdrawalSubmission(request: Request, context: Context) {
  if (!isAllowedOrderMutation(request)) return json({ ok: false, code: "RIGHTS_WITHDRAWAL_ACCESS_DENIED" }, 403);
  const actor: OrderActor | null = await orderActorFromHeaders(request.headers).catch(() => null);
  if (!actor || actor.status !== "ACTIVE" || !actor.emailVerified || !["MEMBER", "CUSTOMER"].includes(actor.role)) {
    return json({ ok: false, code: "RIGHTS_WITHDRAWAL_ACCESS_DENIED" }, actor ? 403 : 401);
  }
  try {
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      throw new RightsWithdrawalError(415, "RIGHTS_WITHDRAWAL_INVALID");
    }
    const text = await request.text();
    if (Buffer.byteLength(text) > 4096) throw new RightsWithdrawalError(413, "RIGHTS_WITHDRAWAL_INVALID");
    const payload = JSON.parse(text) as { declarationAccepted?: unknown; reason?: unknown };
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some((key) => !["declarationAccepted", "reason"].includes(key)) || payload.declarationAccepted !== true) {
      throw new RightsWithdrawalError(400, "RIGHTS_WITHDRAWAL_DECLARATION_REQUIRED");
    }
    const result = await submitRightsWithdrawal(actor, (await context.params).requestNumber, payload.reason);
    return json({ ok: true, requestNumber: result.requestNumber, status: result.status }, 201);
  } catch (error) {
    return error instanceof RightsWithdrawalError
      ? json({ ok: false, code: error.code }, error.status)
      : json({ ok: false, code: "RIGHTS_WITHDRAWAL_UNAVAILABLE" }, 503);
  }
}
