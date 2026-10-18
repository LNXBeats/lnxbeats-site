import { digitalActor, digitalBody, digitalHttpError, digitalJson, digitalRateLimit } from "@/lib/digital/http";
import { loadGroupReview, mutateGroupReview } from "@/lib/digital/group-review-service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const actor = await digitalActor(request, true); await digitalRateLimit(actor.id, "group-review-read", 60); return digitalJson({ project: await loadGroupReview(actor, new URL(request.url).searchParams.get("projectId") ?? "") }); }
  catch (error) { return digitalHttpError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await digitalActor(request, true); await digitalRateLimit(actor.id, "group-review-write", 80);
    const body = await digitalBody(request, ["operation", "projectId", "masterId", "ticket", "playedRangesMs", "masterIds", "expectedReviews", "expectedSelections", "expectedBindings", "facts", "idempotencyKey", "attested"], 65536);
    return digitalJson(await mutateGroupReview(actor, body));
  } catch (error) { return digitalHttpError(error); }
}
