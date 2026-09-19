import { handlePublicCreationMediaRequest } from "@/lib/creations/public-media-route";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

async function publishedCreationMedia(assetId: string) {
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
  return handlePublicCreationMediaRequest(request, assetId, head, {
    findPublishedAsset: publishedCreationMedia,
  });
}

export function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  return serve(request, params);
}

export function HEAD(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  return serve(request, params, true);
}
