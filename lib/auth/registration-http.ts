import "server-only";

import { RegistrationServiceError } from "@/lib/auth/registration";
import { readAuthBody } from "@/lib/auth/request-body";

export async function readRegistrationJson(request: Request) {
  const parsed = await readAuthBody(request);
  return parsed.ok ? parsed.json : null;
}

export function registrationJson(body: object, status = 200, cookie?: string) {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json",
    "referrer-policy": "no-referrer",
  });
  if (cookie) headers.append("set-cookie", cookie);
  return Response.json(body, { status, headers });
}

export function registrationError(error: unknown) {
  if (error instanceof RegistrationServiceError) {
    return registrationJson({ error: error.message, code: error.code }, error.status);
  }
  return registrationJson({ error: "Cette demande ne peut pas être traitée." }, 500);
}
