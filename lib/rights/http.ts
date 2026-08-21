import "server-only";

import { orderJson } from "@/lib/orders/http";
import { RightsInputError } from "@/lib/rights/input";
import { RightsRequestError } from "@/lib/rights/request";
import { RightsServiceError } from "@/lib/rights/service";

const storageCodes = new Set(["CONFIGURATION", "INVALID_KEY", "NOT_FOUND", "INTEGRITY", "PROVIDER"]);

export function rightsFailureDiagnostic(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "UnknownError";
  const rawCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  if (
    rawCode === "ENOENT"
    && /pdfkit[\\/]js[\\/]data[\\/][A-Za-z-]+\.afm(?:'|\"|$)/.test(message)
  ) {
    return {
      category: "document-generation",
      code: "PDFKIT_STANDARD_FONT_MISSING",
      exception: name,
      phase: "PDF_RENDER",
      message: "PDFKit standard font resource is unavailable.",
    } as const;
  }
  if (name === "MediaStorageError" && storageCodes.has(rawCode)) return { category: "private-storage", code: rawCode, exception: name } as const;
  if (/^P\d{4}$/.test(rawCode) || /^[0-9A-Z]{5}$/.test(rawCode)) return { category: "database", code: rawCode, exception: name } as const;
  if (name === "TypeError") {
    const code = message === "PDF paragraphs are invalid."
      ? "PDF_PARAGRAPHS_INVALID"
      : message.endsWith(" is invalid.")
        ? "INVALID_DOCUMENT_INPUT"
        : "DOCUMENT_TYPE_ERROR";
    return { category: "document-generation", code, exception: name, phase: "PDF_INPUT" } as const;
  }
  if (message === "Generated contract PDF is invalid.") return { category: "document-generation", code: "PDF_OUTPUT_INVALID", exception: name, phase: "PDF_OUTPUT" } as const;
  return { category: "internal", code: "UNCLASSIFIED_FAILURE", exception: name } as const;
}

export function rightsErrorResponse(error: unknown) {
  if (error instanceof RightsInputError) return orderJson({ error: error.message, code: error.code, field: error.field }, 400);
  if (error instanceof RightsRequestError) return orderJson({ error: error.message, code: error.code }, error.status);
  if (error instanceof RightsServiceError) return orderJson({ error: error.message, code: error.code }, error.status);
  console.error("rights.request.failed", rightsFailureDiagnostic(error));
  return orderJson({ error: "La demande de droits ne peut pas être traitée.", code: "RIGHTS_REQUEST_FAILED" }, 500);
}
