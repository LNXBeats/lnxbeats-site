import { NextResponse } from "next/server";

import { readCatalogImage } from "@/lib/catalog/media-storage";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { parseShopConfiguration } from "@/lib/shop/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function serve(request: Request, params: Promise<{ assetId: string }>, head = false) {
  const { assetId } = await params;
  let enabled = false;
  try {
    enabled = parseShopConfiguration().enabled;
  } catch {
    return new NextResponse(null, { status: 404 });
  }
  if (!enabled || !UUID_PATTERN.test(assetId)) return new NextResponse(null, { status: 404 });

  assertDatabaseConfigured();
  const asset = await prisma.asset.findFirst({
    where: {
      id: assetId,
      type: "IMAGE",
      mimeType: "image/webp",
      visibility: "PUBLIC",
      rightsStatus: "CLEARED",
      products: {
        some: { position: 0, product: { status: "PUBLISHED", priceCents: { not: null } } },
      },
    },
    select: {
      storageKey: true,
      storageBackend: true,
      storageProvider: true,
      visibility: true,
      checksumSha256: true,
      sizeBytes: true,
      updatedAt: true,
    },
  });
  if (!asset) return new NextResponse(null, { status: 404 });

  try {
    const bytes = await readCatalogImage(asset);
    if (BigInt(bytes.length) !== asset.sizeBytes) return new NextResponse(null, { status: 404 });
    const etag = asset.checksumSha256 ? `"${asset.checksumSha256}"` : null;
    const headers = {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Last-Modified": asset.updatedAt.toUTCString(),
      ...(etag ? { ETag: etag } : {}),
    };
    if (etag && request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers });
    }
    return new NextResponse(head ? null : new Uint8Array(bytes), { status: 200, headers });
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
