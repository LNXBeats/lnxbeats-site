import "server-only";

import { CatalogAudioRangeError, parseCatalogAudioRange } from "@/lib/catalog/audio-range";
import { safeContentDisposition } from "@/lib/media/storage/policy";
import { createPrivateOrderDownloadUrl, statPrivateOrderFile, streamPrivateOrderFile } from "@/lib/orders/storage";

export const ORDER_DELIVERY_SIGNED_URL_SECONDS = 600;

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

type OrderDeliveryResponseDependencies = {
  sign?: typeof createPrivateOrderDownloadUrl;
  stat: typeof statPrivateOrderFile;
  stream: typeof streamPrivateOrderFile;
};

export async function orderDeliveryResponse(
  request: Request,
  asset: PrivateOrderDeliveryAsset,
  { head = false, download = true } = {},
  dependencies: OrderDeliveryResponseDependencies = {
    sign: createPrivateOrderDownloadUrl,
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
    if (asset.storageBackend === "OBJECT" && "sign" in dependencies && dependencies.sign) {
      const signedUrl = await dependencies.sign(asset, {
        expiresInSeconds: ORDER_DELIVERY_SIGNED_URL_SECONDS,
        ...(download ? { downloadFilename: asset.filename } : {}),
      });
      if (signedUrl) {
        const target = new URL(signedUrl);
        if (target.protocol !== "https:") return new Response(null, { status: 404 });
        return new Response(null, {
          status: 307,
          headers: {
            "cache-control": "private, no-store",
            location: target.toString(),
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
          },
        });
      }
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
