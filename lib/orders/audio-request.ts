import "server-only";

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import Busboy from "busboy";
import sharp from "sharp";

import { orderOffer } from "@/data/order-offer";
import { validateCompleteAudioSource } from "@/lib/catalog/ffmpeg";
import { sanitizeOriginalFilename } from "@/lib/orders/domain";
import { detectImageType, detectOrderAudioType, OrderUploadError, validateOrderAudioIdentity } from "@/lib/orders/upload";

export const ORDER_DELIVERY_TRANSPORT_MAXIMUM_BYTES = orderOffer.maxDeliveryBytes + 1024 * 1024;

export type OrderDeliveryUpload = {
  path: string;
  originalFilename: string;
  assetType: "AUDIO" | "DOCUMENT" | "IMAGE";
  mimeType: "audio/mpeg" | "audio/wav" | "audio/flac" | "application/zip" | "application/pdf" | "image/jpeg" | "image/png";
  extension: "mp3" | "wav" | "flac" | "zip" | "pdf" | "jpg" | "png";
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  checksumSha256: string;
  cleanup(): Promise<void>;
};

export const ORDER_DELIVERY_MIME_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/flac",
  "application/zip",
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

type PendingAudioFile = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
};

async function signature(target: string) {
  const handle = await open(target, "r");
  try {
    const bytes = Buffer.alloc(16);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

type DeliveryIdentity = Pick<OrderDeliveryUpload, "assetType" | "originalFilename" | "mimeType" | "extension">;

function documentIdentity(input: {
  bytes: Uint8Array;
  originalFilename: string;
  declaredMimeType: string;
}): DeliveryIdentity | null {
  const originalFilename = sanitizeOriginalFilename(input.originalFilename);
  const extension = originalFilename.includes(".") ? originalFilename.split(".").pop()?.toLowerCase() ?? "" : "";
  const mimeType = input.declaredMimeType.toLowerCase();
  const header = Buffer.from(input.bytes);
  const pdf = header.subarray(0, 5).toString("ascii") === "%PDF-";
  const zip = header.length >= 4
    && header[0] === 0x50
    && header[1] === 0x4b
    && [0x03, 0x05, 0x07].includes(header[2] ?? -1)
    && [0x04, 0x06, 0x08].includes(header[3] ?? -1);
  if (pdf && extension === "pdf" && mimeType === "application/pdf") {
    return { assetType: "DOCUMENT", originalFilename, mimeType: "application/pdf", extension: "pdf" };
  }
  if (zip && extension === "zip" && mimeType === "application/zip") {
    return { assetType: "DOCUMENT", originalFilename, mimeType: "application/zip", extension: "zip" };
  }
  return null;
}

function imageIdentity(input: {
  bytes: Uint8Array;
  originalFilename: string;
  declaredMimeType: string;
}): DeliveryIdentity | null {
  const detected = detectImageType(input.bytes);
  if (detected !== "JPEG" && detected !== "PNG") return null;
  const originalFilename = sanitizeOriginalFilename(input.originalFilename);
  const extension = originalFilename.includes(".") ? originalFilename.split(".").pop()?.toLowerCase() ?? "" : "";
  const mimeType = input.declaredMimeType.toLowerCase();
  if (detected === "JPEG" && ["jpg", "jpeg"].includes(extension) && mimeType === "image/jpeg") {
    return { assetType: "IMAGE", originalFilename, mimeType: "image/jpeg", extension: "jpg" };
  }
  if (detected === "PNG" && extension === "png" && mimeType === "image/png") {
    return { assetType: "IMAGE", originalFilename, mimeType: "image/png", extension: "png" };
  }
  return null;
}

export async function readOrderDeliveryUpload(request: Request): Promise<OrderDeliveryUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !/boundary\s*=/i.test(contentType)) {
    throw new OrderUploadError("La demande de livrable est invalide.", "INVALID_MULTIPART");
  }
  const declaredLength = request.headers.get("content-length");
  if (!declaredLength) throw new OrderUploadError("La taille du livrable doit être annoncée.", "LENGTH_REQUIRED");
  const parsedLength = Number(declaredLength);
  if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
    throw new OrderUploadError("La taille du livrable est invalide.", "INVALID_MULTIPART");
  }
  if (parsedLength > ORDER_DELIVERY_TRANSPORT_MAXIMUM_BYTES) {
    throw new OrderUploadError("Le fichier de livraison dépasse la limite de 200 Mo.", "FILE_TOO_LARGE");
  }
  if (!request.body) throw new OrderUploadError("La demande de livrable est invalide.", "INVALID_MULTIPART");

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "lnx-order-delivery-"));
  const target = path.join(temporaryDirectory, "source");
  let receivedFile = false;
  let fileInfo: PendingAudioFile | null = null;
  let filePromise: Promise<void> | null = null;
  let parserError: OrderUploadError | null = null;
  const parser = Busboy({
    headers: { "content-type": contentType },
    limits: {
      files: 1,
      fields: 0,
      // Busboy emits partsLimit as soon as the configured boundary is reached,
      // including the one valid file. A limit of 2 plus the explicit handlers
      // below accepts exactly one file and rejects every additional part.
      parts: 2,
      fileSize: orderOffer.maxDeliveryBytes,
    },
  });

  parser.on("file", (name, file, info) => {
    if (name !== "delivery" || receivedFile || filePromise) {
      parserError = new OrderUploadError("La demande de livrable est invalide.", "INVALID_MULTIPART");
      file.resume();
      return;
    }
    receivedFile = true;
    filePromise = (async () => {
      const hash = createHash("sha256");
      let sizeBytes = 0;
      file.on("data", (chunk: Buffer) => {
        sizeBytes += chunk.length;
        hash.update(chunk);
      });
      file.once("limit", () => {
        parserError = new OrderUploadError("Le fichier de livraison dépasse la limite de 200 Mo.", "FILE_TOO_LARGE");
      });
      await pipeline(file, createWriteStream(target, { flags: "wx", mode: 0o600 }));
      fileInfo = {
        filename: info.filename,
        mimeType: info.mimeType,
        sizeBytes,
        checksumSha256: hash.digest("hex"),
      };
    })();
  });
  const invalidMultipart = () => {
    parserError = new OrderUploadError("La demande de livrable est invalide.", "INVALID_MULTIPART");
  };
  parser.on("field", invalidMultipart);
  parser.once("filesLimit", invalidMultipart);
  parser.once("fieldsLimit", invalidMultipart);
  parser.once("partsLimit", invalidMultipart);

  let receivedBytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > ORDER_DELIVERY_TRANSPORT_MAXIMUM_BYTES) {
        callback(new OrderUploadError("Le fichier de livraison dépasse la limite de 200 Mo.", "FILE_TOO_LARGE"));
      } else callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(request.body as never), counter, parser);
    if (filePromise) await filePromise;
    if (parserError) throw parserError;
    if (!fileInfo) throw new OrderUploadError("Sélectionnez un livrable.", "EMPTY_FILE");
    const completedFile = fileInfo as PendingAudioFile;
    const detectedSignature = await signature(target);
    const detectedAudio = detectOrderAudioType(detectedSignature);
    let identity: DeliveryIdentity;
    let durationMs: number | null = null;
    let width: number | null = null;
    let height: number | null = null;
    if (detectedAudio) {
      identity = { assetType: "AUDIO", ...validateOrderAudioIdentity({
        signature: detectedSignature,
        originalFilename: completedFile.filename,
        declaredMimeType: completedFile.mimeType,
        sizeBytes: completedFile.sizeBytes,
      }) };
      try {
        durationMs = (await validateCompleteAudioSource(target)).durationMs;
      } catch {
        throw new OrderUploadError("Le fichier audio ne peut pas être analysé de façon sûre.", "DECODE_FAILED");
      }
    } else {
      identity = documentIdentity({
        bytes: detectedSignature,
        originalFilename: completedFile.filename,
        declaredMimeType: completedFile.mimeType,
      }) ?? imageIdentity({
        bytes: detectedSignature,
        originalFilename: completedFile.filename,
        declaredMimeType: completedFile.mimeType,
      }) ?? (() => { throw new OrderUploadError("Le format du livrable n’est pas autorisé.", "UNSUPPORTED_SIGNATURE"); })();
      if (identity.assetType === "IMAGE") {
        try {
          const metadata = await sharp(target, {
            failOn: "warning",
            limitInputPixels: orderOffer.maxImagePixels,
            sequentialRead: true,
          }).metadata();
          if (!metadata.width || !metadata.height
            || metadata.width > orderOffer.maxImageWidth
            || metadata.height > orderOffer.maxImageHeight
            || metadata.width * metadata.height > orderOffer.maxImagePixels) {
            throw new Error("invalid image dimensions");
          }
          width = metadata.width;
          height = metadata.height;
        } catch {
          throw new OrderUploadError("L’image ne peut pas être décodée de façon sûre.", "DECODE_FAILED");
        }
      }
    }
    return {
      path: target,
      assetType: identity.assetType,
      originalFilename: identity.originalFilename,
      mimeType: identity.mimeType,
      extension: identity.extension,
      sizeBytes: completedFile.sizeBytes,
      durationMs,
      width,
      height,
      checksumSha256: completedFile.checksumSha256,
      cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof OrderUploadError) throw error;
    throw new OrderUploadError("La demande de livrable est invalide.", "INVALID_MULTIPART");
  }
}
