import { createHash } from "node:crypto";

import sharp from "sharp";

import { orderOffer } from "@/data/order-offer";
import { sanitizeOriginalFilename } from "@/lib/orders/domain";

export type DetectedImageType = "JPEG" | "PNG" | "WEBP";
export type DetectedOrderAudioType = "MP3" | "WAV";

export class OrderUploadError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "OrderUploadError";
  }
}
export type NormalizedOrderImage = {
  buffer: Buffer;
  originalFilename: string;
  detectedType: DetectedImageType;
  mimeType: "image/webp";
  extension: "webp";
  width: number;
  height: number;
  sizeBytes: number;
  checksum: string;
};

export type ValidatedOrderAudioIdentity = {
  originalFilename: string;
  detectedType: DetectedOrderAudioType;
  mimeType: "audio/mpeg" | "audio/wav";
  extension: "mp3" | "wav";
};

const acceptedExtensions: Record<DetectedImageType, ReadonlySet<string>> = {
  JPEG: new Set(["jpg", "jpeg"]),
  PNG: new Set(["png"]),
  WEBP: new Set(["webp"]),
};

const acceptedMimeTypes: Record<DetectedImageType, string> = {
  JPEG: "image/jpeg",
  PNG: "image/png",
  WEBP: "image/webp",
};

export function detectImageType(buffer: Uint8Array): DetectedImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "JPEG";
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) return "PNG";
  if (
    buffer.length >= 12
    && Buffer.from(buffer.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(buffer.subarray(8, 12)).toString("ascii") === "WEBP"
  ) return "WEBP";
  return null;
}

export function detectOrderAudioType(buffer: Uint8Array): DetectedOrderAudioType | null {
  if (
    buffer.length >= 3
    && Buffer.from(buffer.subarray(0, 3)).toString("ascii") === "ID3"
  ) return "MP3";
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0) return "MP3";
  if (
    buffer.length >= 12
    && Buffer.from(buffer.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(buffer.subarray(8, 12)).toString("ascii") === "WAVE"
  ) return "WAV";
  return null;
}

export function validateOrderAudioIdentity(input: {
  signature: Uint8Array;
  originalFilename: string;
  declaredMimeType: string;
  sizeBytes: number;
}): ValidatedOrderAudioIdentity {
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new OrderUploadError("Le fichier audio est vide.", "EMPTY_FILE");
  }
  if (input.sizeBytes > orderOffer.maxDeliveryBytes) {
    throw new OrderUploadError("Le fichier de livraison doit peser au maximum 200 Mo.", "FILE_TOO_LARGE");
  }
  const detectedType = detectOrderAudioType(input.signature);
  if (!detectedType) {
    throw new OrderUploadError("Le fichier n’est pas un MP3 ou WAV authentique.", "UNSUPPORTED_SIGNATURE");
  }
  const originalFilename = sanitizeOriginalFilename(input.originalFilename);
  const extension = originalFilename.includes(".") ? originalFilename.split(".").pop()?.toLowerCase() ?? "" : "";
  const expectedExtension = detectedType === "MP3" ? "mp3" : "wav";
  if (extension !== expectedExtension) {
    throw new OrderUploadError("L’extension ne correspond pas au contenu réel du fichier audio.", "EXTENSION_MISMATCH");
  }
  const declaredMimeType = input.declaredMimeType.toLowerCase();
  const acceptedMimeTypes = detectedType === "MP3"
    ? new Set(["audio/mpeg", "audio/mp3", "audio/x-mpeg"])
    : new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]);
  if (!acceptedMimeTypes.has(declaredMimeType)) {
    throw new OrderUploadError("Le type annoncé ne correspond pas au contenu réel du fichier audio.", "MIME_MISMATCH");
  }
  return {
    originalFilename,
    detectedType,
    mimeType: detectedType === "MP3" ? "audio/mpeg" : "audio/wav",
    extension: expectedExtension,
  };
}

export async function normalizeOrderImage(input: {
  buffer: Buffer;
  originalFilename: string;
  declaredMimeType: string;
}): Promise<NormalizedOrderImage> {
  if (input.buffer.length === 0) throw new OrderUploadError("Le fichier est vide.", "EMPTY_FILE");
  if (input.buffer.length > orderOffer.maxPhotoBytes) {
    throw new OrderUploadError("Chaque photo doit peser au maximum 10 Mo.", "FILE_TOO_LARGE");
  }

  const detectedType = detectImageType(input.buffer);
  if (!detectedType) {
    throw new OrderUploadError("Le fichier n’est pas une image JPEG, PNG ou WebP valide.", "UNSUPPORTED_SIGNATURE");
  }

  const originalFilename = sanitizeOriginalFilename(input.originalFilename);
  const extension = originalFilename.includes(".") ? originalFilename.split(".").pop()?.toLowerCase() ?? "" : "";
  if (!acceptedExtensions[detectedType].has(extension)) {
    throw new OrderUploadError("L’extension ne correspond pas au contenu réel de l’image.", "EXTENSION_MISMATCH");
  }
  if (input.declaredMimeType !== acceptedMimeTypes[detectedType]) {
    throw new OrderUploadError("Le type annoncé ne correspond pas au contenu réel de l’image.", "MIME_MISMATCH");
  }

  try {
    const image = sharp(input.buffer, {
      failOn: "warning",
      limitInputPixels: orderOffer.maxImagePixels,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new OrderUploadError("Les dimensions de l’image sont introuvables.", "INVALID_DIMENSIONS");
    }
    if (
      metadata.width > orderOffer.maxImageWidth
      || metadata.height > orderOffer.maxImageHeight
      || metadata.width * metadata.height > orderOffer.maxImagePixels
    ) {
      throw new OrderUploadError("Les dimensions de l’image dépassent les limites autorisées.", "DIMENSIONS_TOO_LARGE");
    }

    const normalized = await image
      .rotate()
      .webp({ quality: 88, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    if (normalized.data.length > orderOffer.maxPhotoBytes) {
      throw new OrderUploadError("L’image normalisée dépasse la limite de 10 Mo.", "NORMALIZED_FILE_TOO_LARGE");
    }

    return {
      buffer: normalized.data,
      originalFilename,
      detectedType,
      mimeType: "image/webp",
      extension: "webp",
      width: normalized.info.width,
      height: normalized.info.height,
      sizeBytes: normalized.data.length,
      checksum: createHash("sha256").update(normalized.data).digest("hex"),
    };
  } catch (error) {
    if (error instanceof OrderUploadError) throw error;
    throw new OrderUploadError("L’image ne peut pas être décodée de façon sûre.", "DECODE_FAILED");
  }
}
