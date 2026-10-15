import { catalogAudioResponse } from "@/lib/catalog/audio-response";
import { digitalActor, digitalHttpError, digitalRateLimit } from "@/lib/digital/http";
import { getDigitalExcerptCandidate } from "@/lib/digital/excerpt-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function serve(request: Request, id: string, head = false) {
  try {
    const actor = await digitalActor(request, true); await digitalRateLimit(actor.id, "admin-excerpt-candidate", 240);
    const asset = await getDigitalExcerptCandidate(actor, id), response = await catalogAudioResponse(request, asset, "private, no-store", head);
    response.headers.set("Cache-Control", "private, no-store"); response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin"); return response;
  } catch (error) { return digitalHttpError(error); }
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return serve(request, (await params).id); }
export async function HEAD(request: Request, { params }: { params: Promise<{ id: string }> }) { return serve(request, (await params).id, true); }
