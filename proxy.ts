import { type NextRequest, NextResponse } from "next/server";
import { resolvePublicOriginPolicy } from "@/lib/seo/canonical";
import { randomBytes } from "node:crypto";
import { nonceCspEnabled } from "@/lib/ads/policy";
import { contentSecurityPolicy } from "@/lib/security/content-security-policy";
import { CSP_NONCE_HEADER } from "@/lib/security/csp-nonce";

// This one streaming upload already enforces Admin/origin and 80 MiB limits.
// Canonical policy returns "none" for it; do not clone/truncate its multipart
// body at the photo cap. All other routes retain their existing proxy behavior.
export const config = {
  matcher: ["/((?!api/admin/catalogue/audio/?$).*)"],
};

export function proxy(request: NextRequest) {
  const policy = resolvePublicOriginPolicy({
    method: request.method,
    host: request.headers.get("host") ?? request.nextUrl.host,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
  });
  if (policy.action === "redirect") return NextResponse.redirect(policy.location, policy.status);
  // Never trust client-supplied nonce/CSP headers: Next reads request CSP to
  // nonce its framework scripts. Only this proxy may supply that policy.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(CSP_NONCE_HEADER);
  requestHeaders.delete("content-security-policy");
  requestHeaders.delete("content-security-policy-report-only");
  const nonce = ["GET", "HEAD"].includes(request.method) && nonceCspEnabled(request.nextUrl.pathname, process.env)
    ? randomBytes(32).toString("base64") : undefined;
  const csp = nonce ? contentSecurityPolicy(process.env, nonce) : undefined;
  if (nonce && csp) {
    requestHeaders.set(CSP_NONCE_HEADER, nonce);
    requestHeaders.set("Content-Security-Policy", csp);
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (csp) {
    response.headers.set("Content-Security-Policy", csp);
    // A nonce belongs to this rendered response, never a reusable CDN document.
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  }
  if (policy.action === "noindex") response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
