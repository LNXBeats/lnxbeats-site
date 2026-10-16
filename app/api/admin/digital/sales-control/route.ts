import { digitalBody, digitalJson, withDigitalApi } from "@/lib/digital/http";
import { DigitalError } from "@/lib/digital/domain";
import { setDigitalSalesControl } from "@/lib/digital/sales-control";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return withDigitalApi(request, async actor => {
    const body = await digitalBody(request, ["enabled", "expectedEventId", "idempotencyKey"]);
    if (typeof body.enabled !== "boolean" || body.expectedEventId !== null && typeof body.expectedEventId !== "string"
      || typeof body.idempotencyKey !== "string") throw new DigitalError("INVALID_BODY");
    return digitalJson(await setDigitalSalesControl(actor, { enabled: body.enabled, expectedEventId: body.expectedEventId as string | null, idempotencyKey: body.idempotencyKey }));
  }, true);
}
