import { requireAdmin } from "@/lib/auth/session";
import { createSupportExport } from "@/lib/support/export";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  await requireAdmin();
  return createSupportExport(new URL(request.url).searchParams.get("mode"));
}
