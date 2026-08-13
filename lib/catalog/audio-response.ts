import "server-only";

import { CatalogAudioRangeError, parseCatalogAudioRange } from "@/lib/catalog/audio-range";
import { statCatalogAudioPreview, streamCatalogAudioPreview } from "@/lib/catalog/media-storage";

export type CatalogAudioAsset = {
  id: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: bigint;
  updatedAt: Date;
  checksumSha256: string | null;
  storageBackend: "LOCAL" | "OBJECT";
  storageProvider: string;
  visibility: "PUBLIC" | "PRIVATE";
};

function commonHeaders(asset: CatalogAudioAsset, size: number, cacheControl: string) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    "Content-Type": asset.mimeType,
    "ETag": `"${asset.checksumSha256 ?? `audio-${asset.id}-${size}`}"`,
    "Last-Modified": asset.updatedAt.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  };
}

export async function catalogAudioResponse(request: Request, asset: CatalogAudioAsset, cacheControl: string, head = false) {
  try {
    const size = Number(asset.sizeBytes);
    if (!Number.isSafeInteger(size) || size <= 0) return new Response(null, { status: 404 });
    const headers = commonHeaders(asset, size, cacheControl);

    if (!request.headers.get("range") && request.headers.get("if-none-match") === headers.ETag) {
      return new Response(null, { status: 304, headers });
    }

    let range;
    try {
      range = head ? null : parseCatalogAudioRange(request.headers.get("range"), size);
    } catch (error) {
      if (!(error instanceof CatalogAudioRangeError)) throw error;
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}`, "Content-Length": "0" },
      });
    }

    if (!range) {
      if (head) {
        const metadata = await statCatalogAudioPreview(asset);
        if (metadata.contentLength !== size) return new Response(null, { status: 404 });
        return new Response(null, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
      }
      const object = await streamCatalogAudioPreview(asset);
      if (object.contentLength !== size) return new Response(null, { status: 404 });
      return new Response(object.body, {
        status: 200,
        headers: { ...headers, "Content-Length": String(size) },
      });
    }

    const length = range.end - range.start + 1;
    const object = await streamCatalogAudioPreview(asset, range.start, range.end);
    if (object.contentLength !== length) return new Response(null, { status: 404 });
    return new Response(object.body, {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(length),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
