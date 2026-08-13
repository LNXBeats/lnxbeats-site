import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { readCatalogCover } from "@/lib/catalog/media-storage";

export const runtime = "nodejs";

async function serve(request: Request, params: Promise<{ assetId: string }>, head = false) {
  const { assetId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) {
    return new NextResponse(null, { status: 404 });
  }
  const asset = await prisma.asset.findFirst({
    where: {
      id: assetId, type: "COVER", mimeType: "image/webp", visibility: "PUBLIC",
      projects: { some: { role: "COVER", project: { publicVisible: true, status: { in: ["PUBLISHED", "IN_DEVELOPMENT"] } } } },
    },
    select: {
      storageKey: true, storageBackend: true, storageProvider: true, visibility: true,
      checksumSha256: true, sizeBytes: true, updatedAt: true,
    },
  });
  if (!asset) return new NextResponse(null, { status: 404 });
  try {
    const bytes = await readCatalogCover(asset);
    if (BigInt(bytes.length) !== asset.sizeBytes) return new NextResponse(null, { status: 404 });
    const etag = asset.checksumSha256 ? `"${asset.checksumSha256}"` : null;
    if (etag && request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { "ETag": etag, "Cache-Control": "public, max-age=31536000, immutable" },
      });
    }
    return new NextResponse(head ? null : new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff",
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Last-Modified": asset.updatedAt.toUTCString(),
        ...(etag ? { "ETag": etag } : {}),
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

export function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  return serve(request, params);
}

export function HEAD(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  return serve(request, params, true);
}
