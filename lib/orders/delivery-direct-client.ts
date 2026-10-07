"use client";
import { isUploadAbort, multipartFileSignature, runDirectMultipartUpload, uploadPartWithProgress, waitUntilVisible,
  type MultipartDependencies, type MultipartProgress, type MultipartStatusResponse } from "@/lib/creations/direct-multipart-upload";
import type { DeliveryUploadStatus } from "@/lib/orders/delivery-direct-contract";

type Init = { filename: string; mimeType: string; sizeBytes: number };
function storageKey(orderNumber: string) { return `lnx:delivery-upload:v1:${orderNumber}`; }
export function clearDeliverySession(orderNumber: string) { try { localStorage.removeItem(storageKey(orderNumber)); } catch { /* optional */ } }
function resumeToken(orderNumber: string, file: File) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(orderNumber)) ?? "null");
    return saved?.signature === multipartFileSignature(file) && Date.parse(saved.expiresAt) > Date.now() && typeof saved.token === "string" ? saved.token as string : undefined;
  } catch { return undefined; }
}
export async function deliveryRequest<T>(orderNumber: string, operation: string, body: unknown, signal: AbortSignal): Promise<T> {
  let response;
  try {
    response = await fetch(`/api/admin/orders/${encodeURIComponent(orderNumber)}/delivery/multipart/${operation}`, {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
    });
  } catch (error) {
    if (isUploadAbort(error) || signal.aborted) throw error;
    throw new Error("Le transfert a été interrompu. Vous pouvez réessayer avec le même fichier.");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    if ([404, 410].includes(response.status)) clearDeliverySession(orderNumber);
    throw new Error(payload?.error ?? "Le transfert est momentanément indisponible. Réessayez.");
  }
  return payload as T;
}
function transportStatus(value: DeliveryUploadStatus): MultipartStatusResponse {
  return { ...value, ok: true, state: "media-upload", status: ["COMPLETING", "PREPARING"].includes(value.status) ? "VALIDATING" : value.status as MultipartStatusResponse["status"] };
}
export async function uploadOrderDeliveryDirect(input: {
  orderNumber: string; file: File; signal: AbortSignal;
  onToken(token: string): void; onProgress(progress: MultipartProgress): void;
  dependencies?: Partial<MultipartDependencies<Init>>;
}) {
  const api = <T>(operation: string, body: unknown, signal: AbortSignal) => deliveryRequest<T>(input.orderNumber, operation, body, signal);
  const dependencies: MultipartDependencies<Init> = {
    init: (body, signal) => api("init", body, signal),
    partUrl: (sessionToken, partNumber, signal) => api("part-url", { sessionToken, partNumber }, signal),
    status: async (sessionToken, signal) => transportStatus(await api("status", { sessionToken }, signal)),
    complete: async (sessionToken, _parts, signal) => transportStatus(await api("complete", { sessionToken }, signal)),
    uploadPart: uploadPartWithProgress,
    wait: async (ms, signal) => {
      if (signal.aborted) throw new DOMException("Transfert interrompu", "AbortError");
      await new Promise<void>((resolve, reject) => {
        const done = () => { signal.removeEventListener("abort", abort); resolve(); };
        const timer = setTimeout(done, ms);
        const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("Transfert interrompu", "AbortError")); };
        signal.addEventListener("abort", abort, { once: true });
      });
    },
    waitUntilVisible,
    ...input.dependencies,
  };
  const result = await runDirectMultipartUpload({ file: input.file, init: { filename: input.file.name, mimeType: input.file.type, sizeBytes: input.file.size },
    signal: input.signal, resumeSessionToken: resumeToken(input.orderNumber, input.file), dependencies,
    onSession(session) {
      input.onToken(session.sessionToken);
      try { localStorage.setItem(storageKey(input.orderNumber), JSON.stringify({ token: session.sessionToken, expiresAt: session.expiresAt, signature: multipartFileSignature(input.file) })); } catch { /* optional */ }
    }, onProgress: input.onProgress });
  clearDeliverySession(input.orderNumber);
  return result;
}
