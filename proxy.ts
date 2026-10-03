import { type NextRequest, NextResponse } from "next/server";
import { resolvePublicOriginPolicy } from "@/lib/seo/canonical";

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
  const response = NextResponse.next();
  if (policy.action === "noindex") response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
