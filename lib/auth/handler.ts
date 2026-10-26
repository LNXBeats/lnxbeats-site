import "server-only";

import { auth } from "@/lib/auth";
import { handleBoundedAuthRequest } from "@/lib/auth/request-handler";

const authBaseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost:3000";

export function handleAuthRequest(request: Request) {
  return handleBoundedAuthRequest(request, (forwarded) => auth.handler(forwarded), authBaseUrl);
}
