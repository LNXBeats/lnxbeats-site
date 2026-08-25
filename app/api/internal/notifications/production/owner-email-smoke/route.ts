import {
  handleProductionOwnerEmailSmokeCreate,
  handleProductionOwnerEmailSmokeRead,
} from "@/lib/notifications/production-owner-email-smoke-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleProductionOwnerEmailSmokeCreate(request);
}

export async function GET(request: Request) {
  return handleProductionOwnerEmailSmokeRead(request);
}
