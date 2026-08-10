import "server-only";

import { auth } from "@/lib/auth";
import {
  isAllowedEmailRequestPayload,
  isAllowedProfilePayload,
  isAllowedPublicRegistrationPayload,
  isAllowedResetPayload,
} from "@/lib/auth/input";
import { isSameOriginMutation } from "@/lib/auth/origin";

const GENERIC_LOGIN_ERROR = {
  code: "INVALID_CREDENTIALS",
  message: "Identifiants invalides",
};

const GENERIC_REGISTRATION_RESPONSE = {
  status: true,
  message: "Si cette inscription peut être créée, un message de confirmation a été préparé.",
};

const GENERIC_EMAIL_RESPONSE = {
  status: true,
  message: "Si un compte correspond à cette adresse, un message a été préparé.",
};

const GENERIC_ACTION_ERROR = {
  code: "REQUEST_REJECTED",
  message: "Cette demande ne peut pas être traitée.",
};

const authBaseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost:3000";
const sameOriginMutationPaths = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/sign-up/email",
  "/api/auth/send-verification-email",
  "/api/auth/request-password-reset",
  "/api/auth/reset-password",
  "/api/auth/change-password",
  "/api/auth/update-user",
  "/api/auth/sign-out",
]);

async function requestBody(request: Request) {
  try {
    return await request.clone().json() as unknown;
  } catch {
    return null;
  }
}

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

export async function handleAuthRequest(request: Request) {
  const startedAt = Date.now();
  const pathname = new URL(request.url).pathname;

  // Verification links are consumed only through the single-use project
  // route. The native public endpoint is unreachable to prevent replay.
  if (pathname === "/api/auth/verify-email") {
    return jsonResponse(GENERIC_ACTION_ERROR, 404);
  }

  if (request.method !== "GET" && sameOriginMutationPaths.has(pathname) && !isSameOriginMutation(request, authBaseUrl)) {
    return jsonResponse(GENERIC_ACTION_ERROR, 403);
  }

  const body = request.method === "GET" ? null : await requestBody(request);
  if (pathname === "/api/auth/sign-up/email" && !isAllowedPublicRegistrationPayload(body)) {
    return jsonResponse(GENERIC_ACTION_ERROR, 400);
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

  const response = await auth.handler(request);

  if (pathname === "/api/auth/sign-in/email" && !response.ok) {
    return jsonResponse(GENERIC_LOGIN_ERROR, response.status === 429 ? 429 : 401, response);
  }

  if (pathname === "/api/auth/sign-up/email") {
    await minimumResponseTime(startedAt);
    return jsonResponse(GENERIC_REGISTRATION_RESPONSE, response.status === 429 ? 429 : 200, response);
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
