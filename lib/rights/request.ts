import "server-only";

import { isAllowedOrderMutation, orderActorFromHeaders } from "@/lib/orders/request";

export const MAX_RIGHTS_JSON_BYTES = 256 * 1024;

export class RightsRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "RightsRequestError";
  }
}

export async function readRightsJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new RightsRequestError(415, "UNSUPPORTED_MEDIA_TYPE", "Le formulaire transmis est invalide.");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_RIGHTS_JSON_BYTES) throw new RightsRequestError(413, "PAYLOAD_TOO_LARGE", "Le formulaire est trop volumineux.");
  if (!request.body) throw new RightsRequestError(400, "INVALID_JSON", "Le formulaire transmis est invalide.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RIGHTS_JSON_BYTES) {
      await reader.cancel();
      throw new RightsRequestError(413, "PAYLOAD_TOO_LARGE", "Le formulaire est trop volumineux.");
    }
    chunks.push(value);
  }
  try {
    const body = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new RightsRequestError(400, "INVALID_JSON", "Le formulaire transmis est invalide.");
  }
}

export const rightsRequestDependencies = {
  isAllowed: isAllowedOrderMutation,
  actor: orderActorFromHeaders,
};
