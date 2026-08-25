import { handleProductionOwnerEmailSmokeDispatch } from "@/lib/notifications/production-owner-email-smoke-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleProductionOwnerEmailSmokeDispatch(request);
}
