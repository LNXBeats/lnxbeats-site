import { digitalActor, digitalBody, digitalHttpError, digitalJson, digitalRateLimit } from "@/lib/digital/http";
import { getDigitalExcerptSelection, recordDigitalExcerptSelection } from "@/lib/digital/excerpt-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await digitalActor(request, true); await digitalRateLimit(actor.id, "admin-excerpt-status", 120);
    return digitalJson(await getDigitalExcerptSelection(actor, (await params).id));
  } catch (error) { return digitalHttpError(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await digitalActor(request, true); await digitalRateLimit(actor.id, "admin-excerpt-mutation", 40);
    return digitalJson(await recordDigitalExcerptSelection(actor, (await params).id,
      await digitalBody(request, ["action", "startMs", "expectedRevisionId", "idempotencyKey", "attested"])));
  } catch (error) { return digitalHttpError(error); }
}
