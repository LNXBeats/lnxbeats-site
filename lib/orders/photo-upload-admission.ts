import "server-only";

import { OrderUploadError } from "@/lib/orders/upload";

export const ORDER_PHOTO_MULTIPART_CONCURRENCY = 1;
export const ORDER_PHOTO_MULTIPART_QUEUE_LIMIT = 1;
export const ORDER_PHOTO_MULTIPART_QUEUE_TIMEOUT_MS = 30_000;

type MultipartWaiter = {
  resolve: () => void;
  reject: (error: OrderUploadError) => void;
  signal?: AbortSignal;
  abort?: () => void;
  timeout?: ReturnType<typeof setTimeout>;
};

class OrderPhotoMultipartAdmissionLimiter {
  private active = 0;
  private readonly waiters: MultipartWaiter[] = [];

  snapshot() {
    return {
      active: this.active,
      queued: this.waiters.length,
      concurrency: ORDER_PHOTO_MULTIPART_CONCURRENCY,
      queueLimit: ORDER_PHOTO_MULTIPART_QUEUE_LIMIT,
    } as const;
  }

  private removeWaiter(waiter: MultipartWaiter) {
    const index = this.waiters.indexOf(waiter);
    if (index < 0) return false;
    this.waiters.splice(index, 1);
    if (waiter.timeout) clearTimeout(waiter.timeout);
    if (waiter.signal && waiter.abort) waiter.signal.removeEventListener("abort", waiter.abort);
    return true;
  }

  private acquire(signal?: AbortSignal, queueTimeoutMs = ORDER_PHOTO_MULTIPART_QUEUE_TIMEOUT_MS) {
    if (signal?.aborted) {
      return Promise.reject(new OrderUploadError(
        "Le traitement des photos a été interrompu.",
        "UPLOAD_ABORTED",
      ));
    }
    if (this.active < ORDER_PHOTO_MULTIPART_CONCURRENCY) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= ORDER_PHOTO_MULTIPART_QUEUE_LIMIT) {
      return Promise.reject(new OrderUploadError(
        "Le traitement des photos est momentanément saturé. Réessayez dans un instant.",
        "IMAGE_PROCESSING_BUSY",
        503,
      ));
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: MultipartWaiter = { resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.abort = () => {
          if (!this.removeWaiter(waiter)) return;
          reject(new OrderUploadError(
            "Le traitement des photos a été interrompu.",
            "UPLOAD_ABORTED",
          ));
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }
      this.waiters.push(waiter);
      const boundedQueueTimeoutMs = Number.isSafeInteger(queueTimeoutMs) && queueTimeoutMs > 0
        ? Math.min(queueTimeoutMs, ORDER_PHOTO_MULTIPART_QUEUE_TIMEOUT_MS)
        : ORDER_PHOTO_MULTIPART_QUEUE_TIMEOUT_MS;
      waiter.timeout = setTimeout(() => {
        if (!this.removeWaiter(waiter)) return;
        reject(new OrderUploadError(
          "Le traitement des photos est momentanément saturé. Réessayez dans un instant.",
          "IMAGE_PROCESSING_BUSY",
          503,
        ));
      }, boundedQueueTimeoutMs);
      waiter.timeout.unref?.();
    });
  }

  private release() {
    const waiter = this.waiters.shift();
    if (waiter) {
      if (waiter.timeout) clearTimeout(waiter.timeout);
      if (waiter.signal && waiter.abort) waiter.signal.removeEventListener("abort", waiter.abort);
      waiter.resolve();
      return;
    }
    this.active -= 1;
  }

  async run<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
    queueTimeoutMs?: number,
  ): Promise<T> {
    await this.acquire(signal, queueTimeoutMs);
    try {
      if (signal?.aborted) {
        throw new OrderUploadError(
          "Le traitement des photos a été interrompu.",
          "UPLOAD_ABORTED",
        );
      }
      return await operation();
    } finally {
      this.release();
    }
  }
}

const orderPhotoMultipartAdmissionSymbol = Symbol.for(
  "lnx-studio.orders.photo-multipart-admission.v1",
);
type OrderPhotoMultipartAdmissionGlobal = typeof globalThis & {
  [orderPhotoMultipartAdmissionSymbol]?: OrderPhotoMultipartAdmissionLimiter;
};

function processOrderPhotoMultipartAdmissionLimiter() {
  const processGlobal = globalThis as OrderPhotoMultipartAdmissionGlobal;
  processGlobal[orderPhotoMultipartAdmissionSymbol] ??= new OrderPhotoMultipartAdmissionLimiter();
  return processGlobal[orderPhotoMultipartAdmissionSymbol];
}

export function getOrderPhotoMultipartAdmissionState() {
  return processOrderPhotoMultipartAdmissionLimiter().snapshot();
}

export function withOrderPhotoMultipartAdmission<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
  queueTimeoutMs?: number,
) {
  return processOrderPhotoMultipartAdmissionLimiter().run(operation, signal, queueTimeoutMs);
}
