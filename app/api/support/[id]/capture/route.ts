import type { NextRequest } from "next/server";
import { captureSupportContribution } from "@/lib/support/service";
import { supportHttpError, supportJson, supportMutation, supportOwnerToken } from "@/lib/support/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (!await supportMutation(request)) return supportJson({ error: "Origine refusée." }, 403);
    return supportJson(await captureSupportContribution((await context.params).id, supportOwnerToken(request)));
  } catch (error) { return supportHttpError(error); }
}
