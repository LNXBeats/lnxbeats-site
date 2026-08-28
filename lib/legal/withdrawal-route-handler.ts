import "server-only";

import { shouldUseSecureAuthCookies } from "@/lib/auth/environment";
import { isSameOriginMutation } from "@/lib/auth/origin";
import {
  parseWithdrawalSubmission,
  submitWithdrawalRequest,
  WithdrawalServiceError,
} from "@/lib/legal/withdrawal";

const trustedBaseUrl = () => process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost:3000";
const genericError = { ok: false, message: "La demande ne peut pas être traitée." } as const;

export type WithdrawalRouteDependencies = Readonly<{
  sameOrigin: typeof isSameOriginMutation;
  submit: typeof submitWithdrawalRequest;
}>;

const defaultDependencies: WithdrawalRouteDependencies = { sameOrigin: isSameOriginMutation, submit: submitWithdrawalRequest };

function json(body: object, status: number, cookie?: string) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

export async function handleWithdrawalSubmission(request: Request, dependencies: WithdrawalRouteDependencies = defaultDependencies) {
  if (!dependencies.sameOrigin(request, trustedBaseUrl())) return json(genericError, 403);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return json(genericError, 415);
  try {
    const parsed = parseWithdrawalSubmission(await request.json());
    const result = await dependencies.submit(parsed, clientAddress(request));
    const secure = shouldUseSecureAuthCookies(process.env.NODE_ENV === "production");
    const cookie = [
      `lnx-withdrawal-receipt=${result.receiptToken}`,
      "HttpOnly",
      "SameSite=Lax",
      "Path=/retractation/confirmation",
      "Max-Age=86400",
      secure ? "Secure" : "",
    ].filter(Boolean).join("; ");
    return json({ ok: true, next: "/retractation/confirmation" }, 202, cookie);
  } catch (error) {
    if (error instanceof WithdrawalServiceError) return json(genericError, error.status);
    return json(genericError, 503);
  }
}
