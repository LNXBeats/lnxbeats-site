import { handleOwnerEmailSmokeDispatch } from "@/lib/notifications/owner-email-smoke-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleOwnerEmailSmokeDispatch(request);
}
