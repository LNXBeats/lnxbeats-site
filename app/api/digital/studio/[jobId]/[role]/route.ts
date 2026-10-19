import { digitalActor, digitalHttpError, digitalRateLimit } from "@/lib/digital/http";
import { studioCustomerDownload } from "@/lib/digital/studio-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ jobId: string; role: string }> };
async function serve(request: Request, context: Context, head = false) {
  try {
    const actor = await digitalActor(request);
    await digitalRateLimit(actor.id, "studio-download", 120);
    const p = await context.params;
    return await studioCustomerDownload(request, actor.id, p.jobId, p.role, head);
  } catch (error) { return digitalHttpError(error); }
}
export async function GET(request: Request, context: Context) { return serve(request, context); }
export async function HEAD(request: Request, context: Context) { return serve(request, context, true); }
