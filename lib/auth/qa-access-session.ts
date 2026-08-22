import "server-only";

import { handleAuthRequest } from "@/lib/auth/handler";
import {
  deriveQaCredential,
  QA_ACCESS_PROFILES,
  type QaAccessProfile,
} from "@/lib/auth/qa-access";

export type QaAccessAuthHandler = (request: Request) => Promise<Response>;

type HeadersWithSetCookie = Headers & { getSetCookie?: () => string[] };

function responseSetCookies(response: Response) {
  const cookies = (response.headers as HeadersWithSetCookie).getSetCookie?.();
  if (cookies?.length) return cookies;
  const cookie = response.headers.get("set-cookie");
  return cookie ? [cookie] : [];
}

function assertSecureSessionCookie(cookies: readonly string[]) {
  const sessionCookie = cookies.find((cookie) => /^(?:__Secure-)?lnx-studio\.session_token=/.test(cookie));
  if (
    !sessionCookie
    || !/;\s*HttpOnly(?:;|$)/i.test(sessionCookie)
    || !/;\s*Secure(?:;|$)/i.test(sessionCookie)
    || !/;\s*SameSite=Lax(?:;|$)/i.test(sessionCookie)
    || !/;\s*Path=\/(?:;|$)/i.test(sessionCookie)
  ) throw new Error("The QA session cookie is unavailable.");
}

async function authMutation(
  baseUrl: string,
  pathname: string,
  body: object,
  request: Request,
  authHandler: QaAccessAuthHandler,
) {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    origin: baseUrl,
  });
  const cookie = request.headers.get("cookie");
  const userAgent = request.headers.get("user-agent");
  if (cookie) headers.set("cookie", cookie);
  if (userAgent) headers.set("user-agent", userAgent.slice(0, 500));
  return authHandler(new Request(`${baseUrl}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }));
}

export async function createQaAccessSession(
  request: Request,
  configuration: Readonly<{ baseUrl: string; secret: string }>,
  profile: QaAccessProfile,
  authHandler: QaAccessAuthHandler = handleAuthRequest,
) {
  if (request.headers.get("cookie")) {
    const signedOut = await authMutation(configuration.baseUrl, "/api/auth/sign-out", {}, request, authHandler);
    if (!signedOut.ok) throw new Error("The previous session could not be revoked.");
  }

  const definition = QA_ACCESS_PROFILES[profile];
  const response = await authMutation(
    configuration.baseUrl,
    "/api/auth/sign-in/email",
    {
      email: definition.email,
      password: deriveQaCredential(configuration.secret, profile),
      rememberMe: false,
    },
    request,
    authHandler,
  );
  if (!response.ok) throw new Error("The QA session could not be created.");
  const cookies = responseSetCookies(response);
  assertSecureSessionCookie(cookies);
  return cookies;
}
