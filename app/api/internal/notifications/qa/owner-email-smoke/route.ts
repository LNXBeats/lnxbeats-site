import { handleOwnerEmailSmokeCreate, handleOwnerEmailSmokeRead } from "@/lib/notifications/owner-email-smoke-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleOwnerEmailSmokeCreate(request);
}

export async function GET(request: Request) {
  return handleOwnerEmailSmokeRead(request);
}
