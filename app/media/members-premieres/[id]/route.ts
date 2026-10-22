import { getAuthSession } from "@/lib/auth/session";
import { catalogAudioResponse } from "@/lib/catalog/audio-response";
import { memberPremiereAudioAsset } from "@/lib/members/previews";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function serve(request: Request, id: string, head = false) {
  try {
    const session = await getAuthSession();
    const asset = await memberPremiereAudioAsset(session?.user, id);
    if (asset) {
      const response = await catalogAudioResponse(request, asset, "private, no-store", head);
      response.headers.set("Vary", "Cookie"); response.headers.set("X-Robots-Tag", "noindex, nofollow");
      return response;
    }
  } catch { /* Authentication and storage errors must not disclose private media. */ }
  return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" } });
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return serve(request, (await params).id); }
export async function HEAD(request: Request, { params }: { params: Promise<{ id: string }> }) { return serve(request, (await params).id, true); }
