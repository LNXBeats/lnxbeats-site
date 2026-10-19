import { catalogAudioResponse } from "@/lib/catalog/audio-response";
import { digitalActor, digitalHttpError, digitalRateLimit } from "@/lib/digital/http";
import { studioAudioAsset } from "@/lib/digital/studio-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function serve(request: Request, jobId: string, role: string, head = false) {
  try {
    const actor = await digitalActor(request, true);
    await digitalRateLimit(actor.id, "studio-private-audition", 240);
    const asset = await studioAudioAsset(actor, jobId, role);
    const response = await catalogAudioResponse(request, asset, "private, no-store", head);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) { return digitalHttpError(error); }
}

type Context = { params: Promise<{ jobId: string; role: string }> };
export async function GET(request: Request, { params }: Context) { const p = await params; return serve(request, p.jobId, p.role); }
export async function HEAD(request: Request, { params }: Context) { const p = await params; return serve(request, p.jobId, p.role, true); }
