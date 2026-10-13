import { acknowledgeDigitalContract } from "@/lib/digital/documents";
import { digitalBody, digitalJson, withDigitalApi } from "@/lib/digital/http";
import { assertDigitalUuid, DigitalError } from "@/lib/digital/domain";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withDigitalApi(request, async actor => { const { id } = await params; assertDigitalUuid(id); const b = await digitalBody(request, ["documentId", "snapshotHash", "received"]);
    assertDigitalUuid(b.documentId); if (b.received !== true || typeof b.snapshotHash !== "string" || !/^[a-f0-9]{64}$/.test(b.snapshotHash)) throw new DigitalError("CONTRACT_RECEIPT_REQUIRED");
    return digitalJson(await acknowledgeDigitalContract(actor.id, id, b.documentId, b.snapshotHash)); });
}
