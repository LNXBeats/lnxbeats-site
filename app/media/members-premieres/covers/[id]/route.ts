import { getAuthSession } from "@/lib/auth/session";
import { memberPremiereCoverAsset } from "@/lib/members/previews";
import { readCatalogCover } from "@/lib/catalog/media-storage";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function serve(id: string, head = false) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
  try {
    const session = await getAuthSession(), asset = await memberPremiereCoverAsset(session?.user, id);
    if (asset && asset.mimeType === "image/webp") {
      const bytes = await readCatalogCover(asset);
      if (BigInt(bytes.length) === asset.sizeBytes) return new Response(head ? null : new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "image/webp", "Content-Length": String(bytes.length) } });
    }
  } catch { /* No private metadata or storage diagnostics in public responses. */ }
  return new Response(null, { status: 404, headers });
}
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) { return serve((await params).id); }
export async function HEAD(_request: Request, { params }: { params: Promise<{ id: string }> }) { return serve((await params).id, true); }
