import "server-only";

import { BoundedMultipartRequestError, readBoundedMultipartFormData } from "@/lib/media/multipart-request";

export const CATALOG_COVER_TRANSPORT_MAXIMUM_BYTES = 10 * 1024 * 1024 + 256 * 1024;

export class CatalogCoverRequestError extends Error {
  constructor(readonly code: "INVALID_MULTIPART" | "TRANSPORT_TOO_LARGE") {
    super(code);
    this.name = "CatalogCoverRequestError";
  }
}

export async function readCatalogCoverFormData(request: Request) {
  try {
    return await readBoundedMultipartFormData(request, CATALOG_COVER_TRANSPORT_MAXIMUM_BYTES);
  } catch (error) {
    if (error instanceof BoundedMultipartRequestError) throw new CatalogCoverRequestError(error.code);
    throw new CatalogCoverRequestError("INVALID_MULTIPART");
  }
}
