import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { readCatalogCover } from "@/lib/catalog/media-storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return new NextResponse(null, { status: 404 });
  const asset = await prisma.asset.findFirst({
    where: {
      id: assetId, type: "COVER", mimeType: "image/webp",
      projects: { some: { role: "COVER", project: { status: { in: ["PUBLISHED", "IN_DEVELOPMENT"] } } } },
    },
    select: { storageKey: true, updatedAt: true },
  });
  if (!asset) return new NextResponse(null, { status: 404 });
  try {
    const bytes = await readCatalogCover(asset.storageKey);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Last-Modified": asset.updatedAt.toUTCString(),
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
