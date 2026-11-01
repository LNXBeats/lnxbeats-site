import { handleReleaseAlertDispatchPost } from "@/lib/release-notifications/dispatch-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleReleaseAlertDispatchPost(request);
}
