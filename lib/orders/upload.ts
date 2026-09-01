import { createHash } from "node:crypto";

import { orderOffer } from "@/data/order-offer";
import sharp from "@/lib/media/sharp";
import { withMemoryDiagnosticCounter } from "@/lib/memory-diagnostics";
import { sanitizeOriginalFilename } from "@/lib/orders/domain";

export type DetectedImageType = "JPEG" | "PNG" | "WEBP";
export type DetectedOrderAudioType = "MP3" | "WAV" | "FLAC";

export class OrderUploadError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
    this.name = "OrderUploadError";
  }
}

export const ORDER_PHOTO_TRANSFORM_CONCURRENCY = 1;
export const ORDER_PHOTO_TRANSFORM_QUEUE_LIMIT = 1;

type TransformWaiter = {
  resolve: () => void;
  reject: (error: OrderUploadError) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

class OrderPhotoTransformLimiter {
  private active = 0;
  private readonly waiters: TransformWaiter[] = [];

  snapshot() {
    return {
      active: this.active,
      queued: this.waiters.length,
      concurrency: ORDER_PHOTO_TRANSFORM_CONCURRENCY,
      queueLimit: ORDER_PHOTO_TRANSFORM_QUEUE_LIMIT,
    } as const;
  }

  private acquire(signal?: AbortSignal) {
    if (signal?.aborted) {
      return Promise.reject(new OrderUploadError("Le traitement des photos a été interrompu.", "UPLOAD_ABORTED"));
    }
    if (this.active < ORDER_PHOTO_TRANSFORM_CONCURRENCY) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= ORDER_PHOTO_TRANSFORM_QUEUE_LIMIT) {
      return Promise.reject(new OrderUploadError(
        "Le traitement des photos est momentanément saturé. Réessayez dans un instant.",
        "IMAGE_PROCESSING_BUSY",
        503,
      ));
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: TransformWaiter = { resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.abort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new OrderUploadError("Le traitement des photos a été interrompu.", "UPLOAD_ABORTED"));
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  private release() {
    const waiter = this.waiters.shift();
    if (waiter) {
      if (waiter.signal && waiter.abort) waiter.signal.removeEventListener("abort", waiter.abort);
      waiter.resolve();
      return;
    }
    this.active -= 1;
  }

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await operation();
    } finally {
      this.release();
    }
  }
}

const orderPhotoTransformLimiterSymbol = Symbol.for(
  "lnx-studio.orders.photo-transform-limiter.v1",
);
type OrderPhotoTransformGlobal = typeof globalThis & {
  [orderPhotoTransformLimiterSymbol]?: OrderPhotoTransformLimiter;
};

function processOrderPhotoTransformLimiter() {
  // Keep one limiter across Next server entrypoint bundles and development
  // reloads. Each Node process remains independent by design.
  const processGlobal = globalThis as OrderPhotoTransformGlobal;
  processGlobal[orderPhotoTransformLimiterSymbol] ??= new OrderPhotoTransformLimiter();
  return processGlobal[orderPhotoTransformLimiterSymbol];
}

export function getOrderPhotoTransformState() {
  return processOrderPhotoTransformLimiter().snapshot();
}

export function withOrderPhotoTransformSlot<T>(operation: () => Promise<T>, signal?: AbortSignal) {
  return processOrderPhotoTransformLimiter().run(operation, signal);
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

export type OrderImageSource = {
  buffer: Buffer | (() => Promise<Buffer>);
  originalFilename: string;
  declaredMimeType: string;
  signal?: AbortSignal;
};

export type PersistedOrderImage<TStored extends object> = Omit<NormalizedOrderImage, "buffer"> & TStored;

type OrderImageBatchDependencies<TStored extends object> = {
  persist(normalized: NormalizedOrderImage, index: number): Promise<TStored>;
  cleanup(persisted: PersistedOrderImage<TStored>, index: number): Promise<void>;
  reportCleanupFailure?(diagnostic: OrderPhotoCleanupDiagnostic): void;
};

export type OrderPhotoCleanupDiagnostic = Readonly<{
  event: "order.photo.cleanup.failed";
  cleanupOutcome: "failed";
  attemptedObjectCount: number;
  failedObjectCount: number;
}>;

export function orderPhotoCleanupDiagnostic(
  attemptedObjectCount: number,
  failedObjectCount: number,
): OrderPhotoCleanupDiagnostic {
  return {
    event: "order.photo.cleanup.failed",
    cleanupOutcome: "failed",
    attemptedObjectCount,
    failedObjectCount,
  };
}

function logOrderPhotoCleanupFailure(diagnostic: OrderPhotoCleanupDiagnostic) {
  console.error(JSON.stringify(diagnostic));
}

export async function cleanupPersistedOrderImages<TStored extends object>(
  persisted: readonly PersistedOrderImage<TStored>[],
  cleanup: (item: PersistedOrderImage<TStored>, index: number) => Promise<void>,
  reportCleanupFailure?: (diagnostic: OrderPhotoCleanupDiagnostic) => void,
) {
  const outcomes = await Promise.allSettled(
    persisted.map((item, index) => cleanup(item, index)),
  );
  const failedObjectCount = outcomes.filter(({ status }) => status === "rejected").length;
  if (failedObjectCount > 0) {
    // Keep the primary upload/DB error authoritative. The fixed diagnostic is
    // deliberately free of object keys, filenames, users and order identity.
    try {
      (reportCleanupFailure ?? logOrderPhotoCleanupFailure)(
        orderPhotoCleanupDiagnostic(persisted.length, failedObjectCount),
      );
    } catch {
      // Auxiliary observability must never mask the business failure.
    }
  }
  return { attemptedObjectCount: persisted.length, failedObjectCount } as const;
}

export type ValidatedOrderAudioIdentity = {
  originalFilename: string;
  detectedType: DetectedOrderAudioType;
  mimeType: "audio/mpeg" | "audio/wav" | "audio/flac";
  extension: "mp3" | "wav" | "flac";
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
  if (
    buffer.length >= 4
    && Buffer.from(buffer.subarray(0, 4)).toString("ascii") === "fLaC"
  ) return "FLAC";
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
    throw new OrderUploadError("Le fichier n’est pas un MP3, WAV ou FLAC authentique.", "UNSUPPORTED_SIGNATURE");
  }
  const originalFilename = sanitizeOriginalFilename(input.originalFilename);
  const extension = originalFilename.includes(".") ? originalFilename.split(".").pop()?.toLowerCase() ?? "" : "";
  const expectedExtension = detectedType === "MP3" ? "mp3" : detectedType === "WAV" ? "wav" : "flac";
  if (extension !== expectedExtension) {
    throw new OrderUploadError("L’extension ne correspond pas au contenu réel du fichier audio.", "EXTENSION_MISMATCH");
  }
  const declaredMimeType = input.declaredMimeType.toLowerCase();
  const acceptedMimeTypes = detectedType === "MP3"
    ? new Set(["audio/mpeg", "audio/mp3", "audio/x-mpeg"])
    : detectedType === "WAV"
      ? new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"])
      : new Set(["audio/flac", "audio/x-flac"]);
  if (!acceptedMimeTypes.has(declaredMimeType)) {
    throw new OrderUploadError("Le type annoncé ne correspond pas au contenu réel du fichier audio.", "MIME_MISMATCH");
  }
  return {
    originalFilename,
    detectedType,
    mimeType: detectedType === "MP3" ? "audio/mpeg" : detectedType === "WAV" ? "audio/wav" : "audio/flac",
    extension: expectedExtension,
  };
}

async function normalizeOrderImageWithoutConcurrencyLimit(input: {
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

export function normalizeOrderImage(input: {
  buffer: Buffer;
  originalFilename: string;
  declaredMimeType: string;
  signal?: AbortSignal;
}): Promise<NormalizedOrderImage> {
  // Decoded image memory can greatly exceed the compressed input size.
  return withOrderPhotoTransformSlot(
    () => withMemoryDiagnosticCounter(
      "imageTransform",
      () => normalizeOrderImageWithoutConcurrencyLimit(input),
    ),
    input.signal,
  );
}

async function normalizeOrderImageSource(input: OrderImageSource): Promise<NormalizedOrderImage> {
  // Acquire before materializing a lazy File buffer and before Sharp decodes it.
  return withOrderPhotoTransformSlot(async () => {
    return withMemoryDiagnosticCounter("imageTransform", async () => {
      const buffer = typeof input.buffer === "function" ? await input.buffer() : input.buffer;
      return normalizeOrderImageWithoutConcurrencyLimit({
        buffer,
        originalFilename: input.originalFilename,
        declaredMimeType: input.declaredMimeType,
      });
    });
  }, input.signal);
}

export async function processOrderImageBatch<TStored extends object>(
  inputs: readonly OrderImageSource[],
  dependencies: OrderImageBatchDependencies<TStored>,
): Promise<Array<PersistedOrderImage<TStored>>> {
  const persisted: Array<PersistedOrderImage<TStored>> = [];
  try {
    for (const [index, input] of inputs.entries()) {
      const normalized = await normalizeOrderImageSource(input);
      const stored = await dependencies.persist(normalized, index);
      const metadata: Omit<NormalizedOrderImage, "buffer"> = {
        originalFilename: normalized.originalFilename,
        detectedType: normalized.detectedType,
        mimeType: normalized.mimeType,
        extension: normalized.extension,
        width: normalized.width,
        height: normalized.height,
        sizeBytes: normalized.sizeBytes,
        checksum: normalized.checksum,
      };
      persisted.push({ ...metadata, ...stored });
    }
    return persisted;
  } catch (error) {
    await cleanupPersistedOrderImages(
      persisted,
      dependencies.cleanup,
      dependencies.reportCleanupFailure,
    );
    throw error;
  }
}
