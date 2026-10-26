import { consumeEmailVerification } from "@/lib/auth/email-verification-consume";
import { isSameOriginMutation } from "@/lib/auth/origin";
import { readAuthBody } from "@/lib/auth/request-body";

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

  const parsed = await readAuthBody(request);
  if (!parsed.ok) return response(false, parsed.status);
  const body = parsed.json as { token?: unknown } | null;
  const token = body && typeof body.token === "string" ? body.token : "";

  return response(await consumeEmailVerification(token));
}
