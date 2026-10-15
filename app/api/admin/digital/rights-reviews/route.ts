import { digitalActor, digitalBody, digitalHttpError, digitalJson, digitalRateLimit } from "@/lib/digital/http";
import { listProjectDigitalRightsReviews, recordDigitalRightsReviews } from "@/lib/digital/rights-review-service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await digitalActor(request, true);
    await digitalRateLimit(actor.id, "rights-review-read", 30);
    const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
    return digitalJson({ reviews: await listProjectDigitalRightsReviews(actor, projectId) });
  } catch (error) { return digitalHttpError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await digitalActor(request, true);
    await digitalRateLimit(actor.id, "rights-review-write", 20);
    const body = await digitalBody(request, ["projectId", "masterIds", "expectedReviews", "status", "privateEvidenceReference", "evidenceSha256", "attested", "reason", "idempotencyKey"]);
    return digitalJson({ reviews: await recordDigitalRightsReviews(actor, body) });
  } catch (error) { return digitalHttpError(error); }
}
