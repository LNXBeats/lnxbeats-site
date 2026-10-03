import type { NextRequest } from "next/server";
import { SUPPORT_COOKIE, supportHttpError, supportJson, supportMutation, supportOwnerToken } from "@/lib/support/http";
export const runtime = "nodejs";
// Establish possession before any provider call. The client must await this
// response; lost responses cannot create an unreachable financial operation.
export async function POST(request: NextRequest) {
  try {
    if (!await supportMutation(request)) return supportJson({ error: "Origine refusée." }, 403);
    const response = supportJson({ ready: true });
    response.cookies.set(SUPPORT_COOKIE, supportOwnerToken(request, true), {
      httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/support", maxAge: 86400,
    });
    return response;
  } catch (error) { return supportHttpError(error); }
}
