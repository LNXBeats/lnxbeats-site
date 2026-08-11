import "server-only";

import { RegistrationServiceError } from "@/lib/auth/registration";

export async function readRegistrationJson(request: Request) {
  try {
    return await request.json() as unknown;
  } catch {
    return null;
  }
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
