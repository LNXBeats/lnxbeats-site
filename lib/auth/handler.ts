import "server-only";

import { auth } from "@/lib/auth";

const GENERIC_LOGIN_ERROR = {
  code: "INVALID_CREDENTIALS",
  message: "Identifiants invalides",
};

export async function handleAuthRequest(request: Request) {
  const response = await auth.handler(request);
  const pathname = new URL(request.url).pathname;

  if (pathname === "/api/auth/sign-in/email" && !response.ok) {
    const status = response.status === 429 ? 429 : 401;
    const headers = new Headers({ "content-type": "application/json" });
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) headers.set("retry-after", retryAfter);

    return Response.json(GENERIC_LOGIN_ERROR, { status, headers });
  }

  return response;
}
