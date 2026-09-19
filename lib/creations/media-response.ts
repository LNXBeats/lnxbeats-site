import "server-only";

import { parseCatalogAudioRange, CatalogAudioRangeError } from "@/lib/catalog/audio-range";
import {
  createPublicMediaSignedUrl,
  getMediaObject,
  headMediaObject,
  type MediaStorageReference,
} from "@/lib/media/storage";

export type CreationMediaAsset = MediaStorageReference & {
  id: string;
  mimeType: string;
  sizeBytes: bigint;
  checksumSha256: string | null;
  updatedAt: Date;
};

const DEFAULT_PUBLIC_MEDIA_SIGNED_URL_TTL_SECONDS = 3_600;

export function publicMediaSignedUrlTtlSeconds(
  environment: Record<string, string | undefined> = process.env,
) {
  const raw = environment.CREATION_MEDIA_SIGNED_URL_TTL_SECONDS?.trim();
  if (!raw) return DEFAULT_PUBLIC_MEDIA_SIGNED_URL_TTL_SECONDS;

  const deployment = environment.MEDIA_DEPLOYMENT_ENV?.trim();
  const seconds = Number(raw);
  if (deployment !== "preview" || !Number.isSafeInteger(seconds) || seconds < 30 || seconds > 60) {
    return DEFAULT_PUBLIC_MEDIA_SIGNED_URL_TTL_SECONDS;
  }
  return seconds;
}

function mediaHeaders(asset: CreationMediaAsset, size: number, privatePreview: boolean) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": privatePreview ? "private, no-store" : "public, max-age=31536000, immutable",
    "Content-Type": asset.mimeType,
    "Cross-Origin-Resource-Policy": privatePreview ? "same-origin" : "cross-origin",
    "ETag": `"${asset.checksumSha256 ?? `creation-${asset.id}-${size}`}"`,
    "Last-Modified": asset.updatedAt.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  };
}

export async function creationMediaResponse(
  request: Request,
  asset: CreationMediaAsset,
  head = false,
  privatePreview = false,
) {
  try {
    const size = Number(asset.sizeBytes);
    if (!Number.isSafeInteger(size) || size <= 0) return new Response(null, { status: 404 });
    const headers = mediaHeaders(asset, size, privatePreview);
    if (!request.headers.get("range") && request.headers.get("if-none-match") === headers.ETag) {
      return new Response(null, { status: 304, headers });
    }

    if (head) {
      const stored = await headMediaObject(asset);
      if (stored.contentLength !== size) return new Response(null, { status: 404 });
      return new Response(null, {
        status: 200,
        headers: { ...headers, "Content-Length": String(size) },
      });
    }

    if (asset.storageBackend === "OBJECT" && !privatePreview) {
      const location = await createPublicMediaSignedUrl(asset, {
        expiresInSeconds: publicMediaSignedUrlTtlSeconds(),
      });
      if (location) {
        return new Response(null, {
          status: 307,
          headers: {
            "Cache-Control": "private, no-store",
            Location: location,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
    }

    let range: { start: number; end: number } | null;
    try {
      range = parseCatalogAudioRange(request.headers.get("range"), size);
    } catch (error) {
      if (!(error instanceof CatalogAudioRangeError)) throw error;
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}`, "Content-Length": "0" },
      });
    }
    const object = await getMediaObject(asset, range ?? undefined);
    const expectedLength = range ? range.end - range.start + 1 : size;
    if (object.contentLength !== expectedLength) return new Response(null, { status: 404 });
    return new Response(object.body, {
      status: range ? 206 : 200,
      headers: {
        ...headers,
        "Content-Length": String(expectedLength),
        ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}),
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
