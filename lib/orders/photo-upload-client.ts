import { orderOffer } from "@/data/order-offer";
import type { SerializedOrder } from "@/lib/orders/types";

export type PhotoUploadStage = "waiting" | "uploading" | "processing" | "saved" | "failed";
export type PhotoUploadProgress = { sent: number; total: number };
export type PhotoUploadState = { stage: PhotoUploadStage; error?: string; progress?: PhotoUploadProgress };

export function photoSelectionError(file: Pick<File, "size" | "type">): string | null {
  if (file.size > orderOffer.maxPhotoBytes) return "Cette photo dépasse 10 Mio (10 485 760 octets).";
  if (!file.size) return "Cette photo est vide ou illisible.";
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "Format non pris en charge. Choisissez une image JPEG, PNG ou WebP.";
  }
  return null;
}

// XHR distinguishes bytes sent from server-side processing. It never calls a
// file saved until the server has confirmed the committed order inventory.
export function uploadOrderPhoto(
  orderNumber: string,
  file: File,
  onStage: (stage: "uploading" | "processing", progress?: PhotoUploadProgress) => void,
): Promise<SerializedOrder> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/orders/${encodeURIComponent(orderNumber)}/photos`);
    request.timeout = 120_000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onStage("uploading", { sent: Math.min(event.loaded, event.total), total: event.total });
      }
    };
    request.upload.onload = () => onStage("processing");
    request.onerror = request.ontimeout = request.onabort = () => reject(new Error(
      "Envoi ou confirmation interrompu. Réessayez cette photo : une photo déjà enregistrée ne sera pas dupliquée.",
    ));
    request.onload = () => {
      let payload: { order?: SerializedOrder; error?: string } = {};
      try {
        const parsed: unknown = JSON.parse(request.responseText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed;
      } catch { /* Generic, non-sensitive error below. */ }
      if (request.status >= 200 && request.status < 300 && payload.order) resolve(payload.order);
      else reject(new Error(typeof payload.error === "string" ? payload.error : "La photo n’a pas pu être enregistrée. Réessayez."));
    };
    const body = new FormData();
    body.append("files", file);
    body.set("rightsConfirmed", "true");
    onStage("uploading");
    request.send(body);
  });
}

export async function uploadPhotoQueue(
  files: readonly File[],
  dependencies: {
    upload(file: File, onStage: (stage: "uploading" | "processing", progress?: PhotoUploadProgress) => void): Promise<SerializedOrder>;
    reconcile(): Promise<SerializedOrder | null>;
    onOrder(order: SerializedOrder): void;
    onState(file: File, state: PhotoUploadState): void;
    onSaved(file: File): void;
  },
) {
  const failed: File[] = [];
  for (const file of files) {
    const invalid = photoSelectionError(file);
    if (invalid) {
      failed.push(file);
      dependencies.onState(file, { stage: "failed", error: invalid });
      continue;
    }
    try {
      const order = await dependencies.upload(file, (stage, progress) => dependencies.onState(file, { stage, ...(progress ? { progress } : {}) }));
      dependencies.onOrder(order);
      dependencies.onState(file, { stage: "saved" });
      dependencies.onSaved(file);
    } catch (error) {
      failed.push(file);
      dependencies.onState(file, { stage: "failed", error: error instanceof Error ? error.message : "Envoi interrompu. Réessayez cette photo." });
      // A response can be lost AFTER commit. Re-read the authoritative inventory
      // but retain the local file until a successful retry confirms its outcome.
      const order = await dependencies.reconcile().catch(() => null);
      if (order) dependencies.onOrder(order);
    }
  }
  return { failed, complete: failed.length === 0 };
}
