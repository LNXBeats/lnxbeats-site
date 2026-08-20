import "server-only";

import { orderJson } from "@/lib/orders/http";
import { RightsInputError } from "@/lib/rights/input";
import { RightsRequestError } from "@/lib/rights/request";
import { RightsServiceError } from "@/lib/rights/service";

export function rightsErrorResponse(error: unknown) {
  if (error instanceof RightsInputError) return orderJson({ error: error.message, code: error.code, field: error.field }, 400);
  if (error instanceof RightsRequestError) return orderJson({ error: error.message, code: error.code }, error.status);
  if (error instanceof RightsServiceError) return orderJson({ error: error.message, code: error.code }, error.status);
  return orderJson({ error: "La demande de droits ne peut pas être traitée.", code: "RIGHTS_REQUEST_FAILED" }, 500);
}
