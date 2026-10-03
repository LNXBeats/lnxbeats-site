import type { NextRequest } from "next/server";
import { getSupportStatus } from "@/lib/support/service";
import { supportHttpError, supportJson, supportOwnerToken } from "@/lib/support/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { return supportJson(await getSupportStatus((await context.params).id, supportOwnerToken(request))); }
  catch (error) { return supportHttpError(error); }
}
