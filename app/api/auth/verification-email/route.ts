import { consumeEmailVerification } from "@/lib/auth/email-verification-consume";
import { isSameOriginMutation } from "@/lib/auth/origin";

export const dynamic = "force-dynamic";

const authBaseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost:3000";

function response(verified: boolean, status = 200) {
  return Response.json(
    { verified },
    { status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request, authBaseUrl)) return response(false, 403);

  let token = "";
  try {
    const body = await request.json() as { token?: unknown };
    token = typeof body.token === "string" ? body.token : "";
  } catch {
    return response(false);
  }

  return response(await consumeEmailVerification(token));
}
