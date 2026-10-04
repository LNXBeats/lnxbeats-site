import type { NextRequest } from "next/server";
import { createSupportCheckout } from "@/lib/support/service";
import { boundedSupportText, supportHttpError, supportJson, supportMutation, supportOwnerToken } from "@/lib/support/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    if (!await supportMutation(request)) return supportJson({ error: "Origine refusée." }, 403);
    const ownerToken = supportOwnerToken(request);
    const body = JSON.parse(await boundedSupportText(request));
    const { getAuthSession } = await import("@/lib/auth/session");
    const session = await getAuthSession();
    return supportJson(await createSupportCheckout({ provider: body.provider, amountCents: body.amountCents,
      idempotencyKey: body.idempotencyKey, ownerToken, userId: session?.user.id, newContribution: body.newContribution === true }));
  } catch (error) { return supportHttpError(error); }
}
