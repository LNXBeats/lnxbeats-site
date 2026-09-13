import { requireAdmin } from "@/lib/auth/session";
import { creationMediaResponse } from "@/lib/creations/media-response";
import { getAdminCreationMediaAsset } from "@/lib/creations/media-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serve(request: Request, params: Promise<{ assetId: string }>, head = false) {
  await requireAdmin();
  const { assetId } = await params;
  const asset = await getAdminCreationMediaAsset(assetId);
  if (!asset) return new Response(null, { status: 404, headers: { "cache-control": "private, no-store" } });
  return creationMediaResponse(request, asset, head, true);
}

export function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  return serve(request, params);
}

export function HEAD(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  return serve(request, params, true);
}
