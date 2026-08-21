import { handleResendQaHarnessGet, handleResendQaHarnessPost } from "@/lib/notifications/resend-qa-harness-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleResendQaHarnessPost(request);
}

export async function GET(request: Request) {
  return handleResendQaHarnessGet(request);
}
