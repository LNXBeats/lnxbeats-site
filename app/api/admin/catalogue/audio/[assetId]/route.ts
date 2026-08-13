import { requireAdmin } from "@/lib/auth/session";
import { catalogAudioResponse } from "@/lib/catalog/audio-response";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

async function audioAsset(assetId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return null;
  return prisma.asset.findFirst({
    where: {
      id: assetId,
      type: "AUDIO_PREVIEW",
      mimeType: "audio/mpeg",
      visibility: "PUBLIC",
      rightsStatus: "CLEARED",
      projects: { some: { role: "AUDIO_PREVIEW" } },
    },
    select: {
      id: true, storageKey: true, storageBackend: true, storageProvider: true, visibility: true,
      checksumSha256: true, mimeType: true, sizeBytes: true, updatedAt: true,
    },
  });
}

async function serve(request: Request, params: Promise<{ assetId: string }>, head = false) {
  await requireAdmin();
  const { assetId } = await params;
  const asset = await audioAsset(assetId);
  if (!asset) return new Response(null, { status: 404 });
  return catalogAudioResponse(request, asset, "private, no-store", head);
}

export function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  return serve(request, params);
}

export function HEAD(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  return serve(request, params, true);
}
