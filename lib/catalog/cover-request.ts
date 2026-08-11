import "server-only";

export const CATALOG_COVER_TRANSPORT_MAXIMUM_BYTES = 10 * 1024 * 1024 + 256 * 1024;

export class CatalogCoverRequestError extends Error {
  constructor(readonly code: "INVALID_MULTIPART" | "TRANSPORT_TOO_LARGE") {
    super(code);
    this.name = "CatalogCoverRequestError";
  }
}

export async function readCatalogCoverFormData(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const [mediaType, ...parameters] = contentType.split(";");
  const hasBoundary = parameters.some((parameter) => /^\s*boundary\s*=\s*(?:"[^"]+"|[^\s;]+)\s*$/i.test(parameter));
  if (mediaType.trim().toLowerCase() !== "multipart/form-data" || !hasBoundary) throw new CatalogCoverRequestError("INVALID_MULTIPART");

  const declaredLength = request.headers.get("content-length");
  let parsedDeclaredLength: number | null = null;
  if (declaredLength !== null) {
    parsedDeclaredLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedDeclaredLength) || parsedDeclaredLength < 0) throw new CatalogCoverRequestError("INVALID_MULTIPART");
    if (parsedDeclaredLength > CATALOG_COVER_TRANSPORT_MAXIMUM_BYTES) throw new CatalogCoverRequestError("TRANSPORT_TOO_LARGE");
  }
  if (!request.body) throw new CatalogCoverRequestError("INVALID_MULTIPART");

  // A native browser multipart should be parsed from the original request.
  // Reconstructing it from bytes made Safari's WebKit payload fail even though
  // the same endpoint accepted undici's FormData payload in HTTP QA.
  if (parsedDeclaredLength !== null && parsedDeclaredLength > 0) {
    try {
      return await request.formData();
    } catch {
      throw new CatalogCoverRequestError("INVALID_MULTIPART");
    }
  }

  // A missing or zero Content-Length is not proof of an empty multipart.
  // Safari can expose a streamed FormData request with Content-Length: 0.
  // Read that stream through the bounded fallback instead of asking the
  // original parser to trust the contradictory header.
  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > CATALOG_COVER_TRANSPORT_MAXIMUM_BYTES) {
        await reader.cancel();
        throw new CatalogCoverRequestError("TRANSPORT_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof CatalogCoverRequestError) throw error;
    throw new CatalogCoverRequestError("INVALID_MULTIPART");
  }

  try {
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return await new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    }).formData();
  } catch {
    throw new CatalogCoverRequestError("INVALID_MULTIPART");
  }
}
