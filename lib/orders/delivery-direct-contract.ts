import { orderOffer } from "@/data/order-offer";
import { validateDeliveryFileSelection } from "@/lib/orders/delivery-file-selection";

export const DELIVERY_PART_BYTES = 8 * 1024 * 1024;
export const DELIVERY_URL_SECONDS = 300;
export const DELIVERY_SESSION_MS = 60 * 60 * 1000;
export const DELIVERY_MAX_BYTES = orderOffer.maxDeliveryBytes;
export type DeliveryUploadState = "PREPARING" | "UPLOADING" | "COMPLETING" | "QUARANTINE" | "VALIDATING" | "READY" | "REJECTED" | "ABORTED" | "EXPIRED";
export type DeliveryUploadProgress = { phase: string; uploadedBytes: number; totalBytes: number; percent: number };
export type DeliveryUploadStatus = {
  sessionToken: string; status: DeliveryUploadState; expiresAt: string;
  partSizeBytes: number; partCount: number;
  completedParts: Array<{ partNumber: number; etag: string; sizeBytes: number }>;
  error: string | null; assetId: string | null;
};
const mimeForExtension: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", zip: "application/zip",
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
};
export function deliveryUploadMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Métadonnées de transfert invalides.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["filename", "sizeBytes", "mimeType"].includes(key))
    || typeof input.filename !== "string" || input.filename.length > 255 || !input.filename.trim()
    || typeof input.mimeType !== "string") throw new Error("Métadonnées de transfert invalides.");
  const sizeBytes = Number(input.sizeBytes);
  if (typeof input.sizeBytes !== "number") throw new Error("La taille du fichier est invalide.");
  // File.type is advisory. In particular WebKit may return octet-stream or no
  // MIME; the worker always verifies the signature AND fully decodes audio.
  const validation = validateDeliveryFileSelection({ name: input.filename, size: sizeBytes, type: "" });
  if (!validation.ok) throw new Error(validation.message);
  const extension = input.filename.split(".").pop()!.toLowerCase();
  return { filename: input.filename, sizeBytes, mimeType: mimeForExtension[extension]!, partCount: Math.ceil(sizeBytes / DELIVERY_PART_BYTES) };
}
export function verifyDeliveryParts(sizeBytes: number, parts: Array<{partNumber: number; sizeBytes: number; etag: string}>) {
  const count = Math.ceil(sizeBytes / DELIVERY_PART_BYTES);
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  if (sorted.length !== count || sorted.some((part, index) => part.partNumber !== index + 1
    || part.sizeBytes !== Math.min(DELIVERY_PART_BYTES, sizeBytes - index * DELIVERY_PART_BYTES)
    || !part.etag || part.etag.length > 256 || /[\r\n]/.test(part.etag))) throw new Error("Le transfert est incomplet. Réessayez les parties manquantes.");
  return sorted;
}
