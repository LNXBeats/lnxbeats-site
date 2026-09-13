import { creationMediaResponse } from "@/lib/creations/media-response";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

async function publishedCreationMedia(assetId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return null;
  return prisma.asset.findFirst({
    where: {
      id: assetId,
      visibility: "PUBLIC",
      rightsStatus: "CLEARED",
      OR: [
        {
          type: { in: ["COVER", "IMAGE"] },
          mimeType: "image/webp",
          creations: {
            some: {
              role: { in: ["COVER", "VIDEO_POSTER"] },
              creation: { status: "PUBLISHED", publishedAt: { not: null } },
            },
          },
        },
        {
          type: "AUDIO",
          mimeType: "audio/mpeg",
          creations: {
            some: {
              role: "AUDIO",
              creation: { status: "PUBLISHED", publishedAt: { not: null } },
            },
          },
        },
        {
          type: "VIDEO",
          mimeType: "video/mp4",
          creations: {
            some: {
              role: "VIDEO",
              creation: { status: "PUBLISHED", publishedAt: { not: null } },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      storageKey: true,
      storageBackend: true,
      storageProvider: true,
      visibility: true,
      checksumSha256: true,
      mimeType: true,
      sizeBytes: true,
      updatedAt: true,
    },
  });
}

async function serve(request: Request, params: Promise<{ assetId: string }>, head = false) {
  const { assetId } = await params;
  const asset = await publishedCreationMedia(assetId);
  if (!asset) return new Response(null, { status: 404 });
  return creationMediaResponse(request, asset, head);
}

export function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  return serve(request, params);
}

export function HEAD(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  return serve(request, params, true);
}
