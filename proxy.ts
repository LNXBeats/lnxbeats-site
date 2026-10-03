import { type NextRequest, NextResponse } from "next/server";
import { resolvePublicOriginPolicy } from "@/lib/seo/canonical";

// This proxy only implements public-page canonical/noindex policy. API routes
// already return policy "none" and enforce their own authentication, origin and
// streaming size limits. Do not clone/cap their multipart bodies in the proxy.
export const config = {
  matcher: ["/((?!api(?:/|$)).*)"],
};

export function proxy(request: NextRequest) {
  const policy = resolvePublicOriginPolicy({
    method: request.method,
    host: request.headers.get("host") ?? request.nextUrl.host,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
  });
  if (policy.action === "redirect") return NextResponse.redirect(policy.location, policy.status);
  const response = NextResponse.next();
  if (policy.action === "noindex") response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
