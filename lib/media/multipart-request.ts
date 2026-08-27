import "server-only";

export class BoundedMultipartRequestError extends Error {
  constructor(readonly code: "INVALID_MULTIPART" | "TRANSPORT_TOO_LARGE") {
    super(code);
    this.name = "BoundedMultipartRequestError";
  }
}

export async function readBoundedMultipartFormData(request: Request, maximumBytes: number) {
  const contentType = request.headers.get("content-type") ?? "";
  const [mediaType, ...parameters] = contentType.split(";");
  const hasBoundary = parameters.some((parameter) => /^\s*boundary\s*=\s*(?:"[^"]+"|[^\s;]+)\s*$/i.test(parameter));
  if (mediaType.trim().toLowerCase() !== "multipart/form-data" || !hasBoundary) {
    throw new BoundedMultipartRequestError("INVALID_MULTIPART");
  }

  const declaredLength = request.headers.get("content-length");
  let parsedDeclaredLength: number | null = null;
  if (declaredLength !== null) {
    parsedDeclaredLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedDeclaredLength) || parsedDeclaredLength < 0) {
      throw new BoundedMultipartRequestError("INVALID_MULTIPART");
    }
    if (parsedDeclaredLength > maximumBytes) throw new BoundedMultipartRequestError("TRANSPORT_TOO_LARGE");
  }
  if (!request.body) throw new BoundedMultipartRequestError("INVALID_MULTIPART");

  // Bound every request from the bytes actually received. Content-Length is a
  // useful early rejection, but it is not trusted as the only size control.
  // The same reconstruction also supports Safari requests that arrive with a
  // real multipart stream and Content-Length: 0.
  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel();
        throw new BoundedMultipartRequestError("TRANSPORT_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BoundedMultipartRequestError) throw error;
    throw new BoundedMultipartRequestError("INVALID_MULTIPART");
  }

  if (parsedDeclaredLength !== null && parsedDeclaredLength > 0 && received !== parsedDeclaredLength) {
    throw new BoundedMultipartRequestError("INVALID_MULTIPART");
  }

  try {
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return await new Request(request.url, {
      method: request.method,
      headers: { "content-type": contentType },
      body,
    }).formData();
  } catch {
    throw new BoundedMultipartRequestError("INVALID_MULTIPART");
  }
}
