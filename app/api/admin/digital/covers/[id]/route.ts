import { prisma } from "@/lib/prisma";
import { readCatalogCover } from "@/lib/catalog/media-storage";
import { assertDigitalUuid } from "@/lib/digital/domain";
import { digitalActor, digitalHttpError, digitalJson, digitalRateLimit } from "@/lib/digital/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function serve(request: Request, id: string, head = false) {
  try {
    const actor = await digitalActor(request, true);
    await digitalRateLimit(actor.id, "admin-cover", 120);
    assertDigitalUuid(id);
    const asset = await prisma.asset.findFirst({ where: { id, type: "COVER", mimeType: "image/webp", visibility: "PUBLIC", projects: { some: { role: "COVER" } } } });
    if (!asset || asset.sizeBytes < 1n || asset.sizeBytes > 12n * 1024n * 1024n) return digitalJson({ error: "Cover indisponible." }, 404);
    const bytes = await readCatalogCover(asset);
    if (BigInt(bytes.length) !== asset.sizeBytes) return digitalJson({ error: "Cover indisponible." }, 404);
    return new Response(head ? null : new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return digitalHttpError(error); }
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return serve(request, (await params).id); }
export async function HEAD(request: Request, { params }: { params: Promise<{ id: string }> }) { return serve(request, (await params).id, true); }
