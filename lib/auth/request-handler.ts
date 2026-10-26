import {
  isAllowedEmailRequestPayload,
  isAllowedProfilePayload,
  isAllowedResetPayload,
} from "@/lib/auth/input";
import { isSameOriginMutation } from "@/lib/auth/origin";
import { readAuthBody } from "@/lib/auth/request-body";

const GENERIC_LOGIN_ERROR = { code: "INVALID_CREDENTIALS", message: "Identifiants invalides" };
const GENERIC_EMAIL_RESPONSE = {
  status: true,
  message: "Si un compte correspond à cette adresse, un message a été préparé.",
};
const GENERIC_ACTION_ERROR = { code: "REQUEST_REJECTED", message: "Cette demande ne peut pas être traitée." };

const sameOriginMutationPaths = new Set([
  "/api/auth/sign-in/email", "/api/auth/sign-up/email", "/api/auth/send-verification-email",
  "/api/auth/request-password-reset", "/api/auth/reset-password", "/api/auth/change-password",
  "/api/auth/update-user", "/api/auth/sign-out",
]);
// Native registration/verification cannot bypass the project's single-use flow.
// No social provider is configured or used: reject these array-bearing schemas
// before even reading their body, not only after Better Auth has parsed it.
const closedPaths = new Set([
  "/api/auth/verify-email", "/api/auth/sign-up/email",
  "/api/auth/sign-in/social", "/api/auth/link-social",
]);

function jsonResponse(body: object, status: number, source?: Response) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  const retryAfter = source?.headers.get("x-retry-after") ?? source?.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);
  return Response.json(body, { status, headers });
}

async function minimumResponseTime(startedAt: number, minimumMs = 500) {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

/** The production boundary is also exercised with a genuine in-memory auth adapter. */
export async function handleBoundedAuthRequest(
  request: Request,
  handle: (request: Request) => Promise<Response>,
  authBaseUrl: string,
) {
  const startedAt = Date.now();
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  if (closedPaths.has(pathname)) return jsonResponse(GENERIC_ACTION_ERROR, 404);
  if (request.method !== "GET" && sameOriginMutationPaths.has(pathname)
    && !isSameOriginMutation(request, authBaseUrl)) return jsonResponse(GENERIC_ACTION_ERROR, 403);

  let body: unknown = null;
  let forwarded = request;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const parsed = await readAuthBody(request);
    if (!parsed.ok) return jsonResponse(GENERIC_ACTION_ERROR, parsed.status);
    body = parsed.json;
    if (parsed.body !== null) {
      if (request.headers.get("content-type")?.toLowerCase().split(";", 1)[0].trim() === "application/json"
        && (body === null || typeof body !== "object" || Array.isArray(body))) {
        return jsonResponse(GENERIC_ACTION_ERROR, 400);
      }
      // No clone/tee of an unbounded stream, no JSON re-encoding of form data.
      // URL, headers, cookies, method and signal metadata remain unchanged.
      forwarded = new Request(request, { body: new Uint8Array(parsed.body).buffer });
    }
  }
  if (pathname === "/api/auth/update-user" && !isAllowedProfilePayload(body)) {
    return jsonResponse(GENERIC_ACTION_ERROR, 400);
  }
  if (pathname === "/api/auth/send-verification-email" && !isAllowedEmailRequestPayload(body, "/verifier-email")) {
    return jsonResponse(GENERIC_ACTION_ERROR, 400);
  }
  if (pathname === "/api/auth/request-password-reset" && !isAllowedEmailRequestPayload(body, "/reinitialiser-mot-de-passe")) {
    return jsonResponse(GENERIC_ACTION_ERROR, 400);
  }
  if (pathname === "/api/auth/reset-password" && !isAllowedResetPayload(body)) {
    return jsonResponse(GENERIC_ACTION_ERROR, 400);
  }

  const response = await handle(forwarded);
  if (pathname === "/api/auth/sign-in/email" && !response.ok) {
    return jsonResponse(GENERIC_LOGIN_ERROR, response.status === 429 ? 429 : 401, response);
  }
  if (pathname === "/api/auth/send-verification-email" || pathname === "/api/auth/request-password-reset") {
    await minimumResponseTime(startedAt);
    return jsonResponse(GENERIC_EMAIL_RESPONSE, response.status === 429 ? 429 : 200, response);
  }
  if (pathname === "/api/auth/reset-password" && !response.ok) {
    return jsonResponse(GENERIC_ACTION_ERROR, response.status === 429 ? 429 : 400, response);
  }
  return response;
}
