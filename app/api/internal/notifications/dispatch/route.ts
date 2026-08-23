import { handleNotificationDispatchPost } from "@/lib/notifications/dispatch-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleNotificationDispatchPost(request);
}
