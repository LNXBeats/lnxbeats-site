import "server-only";

import { BoundedMultipartRequestError, readBoundedMultipartFormData } from "@/lib/media/multipart-request";

export const PRODUCT_IMAGE_TRANSPORT_MAXIMUM_BYTES = 10 * 1024 * 1024 + 256 * 1024;

export class ProductImageRequestError extends Error {
  constructor(readonly code: "INVALID_MULTIPART" | "TRANSPORT_TOO_LARGE" | "INVALID_JSON") {
    super(code);
    this.name = "ProductImageRequestError";
  }
}

export async function readProductImageFormData(request: Request) {
  try {
    return await readBoundedMultipartFormData(request, PRODUCT_IMAGE_TRANSPORT_MAXIMUM_BYTES);
  } catch (error) {
    if (error instanceof BoundedMultipartRequestError) throw new ProductImageRequestError(error.code);
    throw new ProductImageRequestError("INVALID_MULTIPART");
  }
}

export async function readProductImageJson(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new ProductImageRequestError("INVALID_JSON");
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > 2_048) {
      throw new ProductImageRequestError("INVALID_JSON");
    }
  }
  if (!request.body) throw new ProductImageRequestError("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > 2_048) {
      await reader.cancel();
      throw new ProductImageRequestError("INVALID_JSON");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, received).toString("utf8")) as unknown;
  } catch {
    throw new ProductImageRequestError("INVALID_JSON");
  }
}
