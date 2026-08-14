import "server-only";

import { CatalogAudioRangeError, parseCatalogAudioRange } from "@/lib/catalog/audio-range";
import { safeContentDisposition } from "@/lib/media/storage/policy";
import { statPrivateOrderFile, streamPrivateOrderFile } from "@/lib/orders/storage";

type PrivateOrderDeliveryAsset = {
  id: string;
  storageKey: string;
  storageBackend: "LOCAL" | "OBJECT";
  storageProvider: string;
  visibility: "PUBLIC" | "PRIVATE";
  checksumSha256: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  updatedAt: Date;
};

function headersFor(asset: PrivateOrderDeliveryAsset, size: number, download: boolean) {
  return {
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "content-disposition": safeContentDisposition(download ? "attachment" : "inline", asset.filename),
    "content-type": asset.mimeType,
    "etag": `"${asset.checksumSha256 ?? `order-delivery-${asset.id}-${size}`}"`,
    "last-modified": asset.updatedAt.toUTCString(),
    "x-content-type-options": "nosniff",
  };
}

export async function orderDeliveryResponse(
  request: Request,
  asset: PrivateOrderDeliveryAsset,
  { head = false, download = true } = {},
  dependencies = {
    stat: statPrivateOrderFile,
    stream: streamPrivateOrderFile,
  },
) {
  try {
    const size = Number(asset.sizeBytes);
    if (!Number.isSafeInteger(size) || size <= 0 || asset.visibility !== "PRIVATE") {
      return new Response(null, { status: 404 });
    }
    const headers = headersFor(asset, size, download);
    if (!request.headers.get("range") && request.headers.get("if-none-match") === headers.etag) {
      return new Response(null, { status: 304, headers });
    }

    let range;
    try {
      range = head ? null : parseCatalogAudioRange(request.headers.get("range"), size);
    } catch (error) {
      if (!(error instanceof CatalogAudioRangeError)) throw error;
      return new Response(null, {
        status: 416,
        headers: { ...headers, "content-length": "0", "content-range": `bytes */${size}` },
      });
    }

    if (head) {
      const metadata = await dependencies.stat(asset);
      if (metadata.contentLength !== size || metadata.contentType && metadata.contentType !== asset.mimeType) {
        return new Response(null, { status: 404 });
      }
      return new Response(null, { status: 200, headers: { ...headers, "content-length": String(size) } });
    }
    const object = await dependencies.stream(asset, range ?? undefined);
    const expectedLength = range ? range.end - range.start + 1 : size;
    if (object.contentLength !== expectedLength || object.contentType && object.contentType !== asset.mimeType) {
      return new Response(null, { status: 404 });
    }
    return new Response(object.body, {
      status: range ? 206 : 200,
      headers: {
        ...headers,
        "content-length": String(expectedLength),
        ...(range ? { "content-range": `bytes ${range.start}-${range.end}/${size}` } : {}),
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
