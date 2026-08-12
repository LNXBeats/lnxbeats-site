import { catalogAudioResponse } from "@/lib/catalog/audio-response";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

async function publicAudioAsset(assetId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return null;
  return prisma.asset.findFirst({
    where: {
      id: assetId,
      type: "AUDIO_PREVIEW",
      mimeType: "audio/mpeg",
      rightsStatus: "CLEARED",
      projects: {
        some: {
          role: "AUDIO_PREVIEW",
          project: { status: "PUBLISHED" },
        },
      },
    },
    select: { id: true, storageKey: true, mimeType: true, sizeBytes: true, updatedAt: true },
  });
}

async function serve(request: Request, params: Promise<{ assetId: string }>, head = false) {
  const { assetId } = await params;
  const asset = await publicAudioAsset(assetId);
  if (!asset) return new Response(null, { status: 404 });
  return catalogAudioResponse(request, asset, "public, max-age=31536000, immutable", head);
}

export function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  return serve(request, params);
}

export function HEAD(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  return serve(request, params, true);
}
