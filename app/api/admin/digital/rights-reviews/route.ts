import { digitalActor, digitalBody, digitalHttpError, digitalJson, digitalRateLimit } from "@/lib/digital/http";
import { listProjectDigitalRightsReviews, recordDigitalRightsReviews } from "@/lib/digital/rights-review-service";
import { prisma } from "@/lib/prisma";
import { DigitalError } from "@/lib/digital/domain";
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
    if (process.env.DCN_V13_QA_READONLY_MEDIA === "true" && typeof body.projectId === "string" && await prisma.digitalOffer.findFirst({ where: { projectId: body.projectId, active: true }, select: { id: true } })) throw new DigitalError("GROUP_LIVE_PROJECT_PROTECTED", 409);
    return digitalJson({ reviews: await recordDigitalRightsReviews(actor, body) });
  } catch (error) { return digitalHttpError(error); }
}
