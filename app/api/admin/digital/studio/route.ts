import { digitalActor, digitalBody, digitalHttpError, digitalJson, digitalRateLimit } from "@/lib/digital/http";
import { listStudioJobs, mutateStudioJob } from "@/lib/digital/studio-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = await digitalActor(request, true);
    await digitalRateLimit(actor.id, "studio-read", 90);
    return digitalJson(await listStudioJobs(actor, new URL(request.url).searchParams.get("projectId")));
  } catch (error) { return digitalHttpError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await digitalActor(request, true);
    await digitalRateLimit(actor.id, "studio-decision", 20);
    const input = await digitalBody(request, ["action", "jobId", "expectedBinding", "expectedCurrentBinding", "confirmReplacement", "confirmExistingPurchases", "humanListened"], 4096);
    return digitalJson(await mutateStudioJob(actor, input));
  } catch (error) { return digitalHttpError(error); }
}
