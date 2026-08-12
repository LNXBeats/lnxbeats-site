import "server-only";

import { Readable } from "node:stream";

import { CatalogAudioRangeError, parseCatalogAudioRange } from "@/lib/catalog/audio-range";
import { statCatalogAudioPreview, streamCatalogAudioPreview } from "@/lib/catalog/media-storage";

type AudioAsset = {
  id: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: bigint;
  updatedAt: Date;
};

function commonHeaders(asset: AudioAsset, size: number, cacheControl: string) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    "Content-Type": asset.mimeType,
    "ETag": `"audio-${asset.id}-${size}"`,
    "Last-Modified": asset.updatedAt.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  };
}

export async function catalogAudioResponse(request: Request, asset: AudioAsset, cacheControl: string, head = false) {
  try {
    const metadata = await statCatalogAudioPreview(asset.storageKey);
    const size = metadata.size;
    if (!metadata.isFile() || size <= 0 || BigInt(size) !== asset.sizeBytes) return new Response(null, { status: 404 });
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
      if (head) return new Response(null, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
      const stream = streamCatalogAudioPreview(asset.storageKey);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: { ...headers, "Content-Length": String(size) },
      });
    }

    const length = range.end - range.start + 1;
    const stream = streamCatalogAudioPreview(asset.storageKey, range.start, range.end);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
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
