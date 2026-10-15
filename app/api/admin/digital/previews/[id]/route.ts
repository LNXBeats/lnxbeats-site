import { prisma } from "@/lib/prisma";
import { catalogAudioResponse } from "@/lib/catalog/audio-response";
import { assertDigitalUuid } from "@/lib/digital/domain";
import { digitalAdminExcerptReady } from "@/lib/digital/admin";
import { digitalActor, digitalHttpError, digitalJson, digitalRateLimit } from "@/lib/digital/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function serve(request: Request, id: string, head = false) {
  try {
    const actor = await digitalActor(request, true);
    await digitalRateLimit(actor.id, "admin-preview", 120);
    assertDigitalUuid(id);
    const master = await prisma.digitalMaster.findFirst({ where: { previewAssetId: id, status: "READY" }, include: { previewAsset: true } });
    if (!master?.previewAsset || !digitalAdminExcerptReady(master)) return digitalJson({ error: "Extrait indisponible." }, 404);
    const response = await catalogAudioResponse(request, master.previewAsset, "private, no-store", head);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  } catch (error) { return digitalHttpError(error); }
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return serve(request, (await params).id); }
export async function HEAD(request: Request, { params }: { params: Promise<{ id: string }> }) { return serve(request, (await params).id, true); }
