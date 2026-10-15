import { digitalBody, digitalJson, withDigitalApi } from "@/lib/digital/http";
import { reviewDigitalConsumerRequest } from "@/lib/legal/withdrawal-admin";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return withDigitalApi(request, async actor => digitalJson(await reviewDigitalConsumerRequest(actor,
    await digitalBody(request, ["requestId", "idempotencyKey", "expectedUpdatedAt", "decision", "basis", "reason"]))), true);
}
