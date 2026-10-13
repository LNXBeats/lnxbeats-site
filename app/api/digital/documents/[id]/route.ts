import { digitalActor, digitalHttpError, digitalRateLimit } from "@/lib/digital/http";
import { digitalDocumentResponse } from "@/lib/digital/documents";
import { assertDigitalUuid } from "@/lib/digital/domain";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const actor = await digitalActor(request), { id } = await params; assertDigitalUuid(id); await digitalRateLimit(actor.id, "documents", 40);
    return await digitalDocumentResponse(actor, id, request.method); } catch (e) { return digitalHttpError(e); }
}
export const HEAD = GET;
