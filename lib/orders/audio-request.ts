import "server-only";

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import Busboy from "busboy";

import { orderOffer } from "@/data/order-offer";
import { validateCompleteAudioSource } from "@/lib/catalog/ffmpeg";
import { OrderUploadError, validateOrderAudioIdentity } from "@/lib/orders/upload";

export const ORDER_DELIVERY_TRANSPORT_MAXIMUM_BYTES = orderOffer.maxDeliveryBytes + 1024 * 1024;

export type OrderDeliveryUpload = {
  path: string;
  originalFilename: string;
  mimeType: "audio/mpeg" | "audio/wav";
  extension: "mp3" | "wav";
  sizeBytes: number;
  durationMs: number;
  checksumSha256: string;
  cleanup(): Promise<void>;
};

type PendingAudioFile = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
};

async function signature(target: string) {
  const handle = await open(target, "r");
  try {
    const bytes = Buffer.alloc(12);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

export async function readOrderDeliveryUpload(request: Request): Promise<OrderDeliveryUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !/boundary\s*=/i.test(contentType)) {
    throw new OrderUploadError("La demande audio est invalide.", "INVALID_MULTIPART");
  }
  const declaredLength = request.headers.get("content-length");
  if (!declaredLength) throw new OrderUploadError("La taille du fichier audio doit être annoncée.", "LENGTH_REQUIRED");
  const parsedLength = Number(declaredLength);
  if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
    throw new OrderUploadError("La taille du fichier audio est invalide.", "INVALID_MULTIPART");
  }
  if (parsedLength > ORDER_DELIVERY_TRANSPORT_MAXIMUM_BYTES) {
    throw new OrderUploadError("Le fichier de livraison dépasse la limite de 200 Mo.", "FILE_TOO_LARGE");
  }
  if (!request.body) throw new OrderUploadError("La demande audio est invalide.", "INVALID_MULTIPART");

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
      parserError = new OrderUploadError("La demande audio est invalide.", "INVALID_MULTIPART");
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
    parserError = new OrderUploadError("La demande audio est invalide.", "INVALID_MULTIPART");
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
    if (!fileInfo) throw new OrderUploadError("Sélectionnez un fichier audio.", "EMPTY_FILE");
    const completedFile = fileInfo as PendingAudioFile;
    const identity = validateOrderAudioIdentity({
      signature: await signature(target),
      originalFilename: completedFile.filename,
      declaredMimeType: completedFile.mimeType,
      sizeBytes: completedFile.sizeBytes,
    });
    let durationMs: number;
    try {
      durationMs = (await validateCompleteAudioSource(target)).durationMs;
    } catch {
      throw new OrderUploadError("Le fichier audio ne peut pas être analysé de façon sûre.", "DECODE_FAILED");
    }
    return {
      path: target,
      originalFilename: identity.originalFilename,
      mimeType: identity.mimeType,
      extension: identity.extension,
      sizeBytes: completedFile.sizeBytes,
      durationMs,
      checksumSha256: completedFile.checksumSha256,
      cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof OrderUploadError) throw error;
    throw new OrderUploadError("La demande audio est invalide.", "INVALID_MULTIPART");
  }
}
